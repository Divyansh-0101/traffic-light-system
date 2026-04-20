import asyncio
import json
import cv2
import requests
import threading
import time
import numpy as np
from concurrent.futures import ThreadPoolExecutor
from aiohttp import web
from aiortc import RTCPeerConnection, RTCSessionDescription, VideoStreamTrack
from av import VideoFrame
from ultralytics import YOLO

VEHICLE_CLASSES = [2, 3, 5, 7]
NODE_SERVER_URL = "http://localhost:4000/api/update-traffic"
CAMERAS = {
    "North": "north.mp4", 
    "South": "south.mp4",
    "East": "east.mp4",
    "West": "west.mp4"
}

# GLOBAL STATES
latest_frames = {dir: None for dir in CAMERAS}
pcs = set() 

# [OPTIMIZATION] Fixed thread pool prevents spawning thousands of threads
telemetry_pool = ThreadPoolExecutor(max_workers=4)

def send_telemetry(direction, count):
    """Synchronous network call executed safely inside the thread pool."""
    try:
        requests.post(NODE_SERVER_URL, json={"direction": direction, "count": count}, timeout=1)
    except requests.exceptions.RequestException:
        pass 

def camera_worker(direction, source):
    print(f"Loading AI and starting track for {direction}...")
    local_model = YOLO('yolov8n.pt') 
    cap = cv2.VideoCapture(source)
    frame_skip = 5
    frame_count = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            time.sleep(0.1) 
            continue

        frame_count += 1
        if frame_count % frame_skip == 0:
            results = local_model.predict(frame, classes=VEHICLE_CLASSES, conf=0.3, verbose=False)
            vehicle_count = len(results[0].boxes)
            
            latest_frames[direction] = results[0].plot()

            # [OPTIMIZATION] Submit to pool instead of spawning new thread
            telemetry_pool.submit(send_telemetry, direction, vehicle_count)
        
        time.sleep(0.01)

# Initialize Camera Threads
for dir_name, src in CAMERAS.items():
    threading.Thread(target=camera_worker, args=(dir_name, src), daemon=True).start()

class StreamTrack(VideoStreamTrack):
    def __init__(self, direction):
        super().__init__()
        self.direction = direction

    async def recv(self):
        pts, time_base = await self.next_timestamp()
        frame = latest_frames[self.direction]
        
        if frame is None:
            frame = np.zeros((480, 640, 3), dtype=np.uint8)

        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        new_frame = VideoFrame.from_ndarray(rgb_frame, format="rgb24")
        new_frame.pts = pts
        new_frame.time_base = time_base
        
        return new_frame

# --- HTTP ENDPOINTS ---
async def offer(request):
    params = await request.json()
    offer = RTCSessionDescription(sdp=params["sdp"], type=params["type"])
    direction = request.match_info.get('direction')

    if direction not in CAMERAS:
        return web.Response(status=404, text="Camera not found")

    pc = RTCPeerConnection()
    pcs.add(pc)

    @pc.on("connectionstatechange")
    async def on_connectionstatechange():
        if pc.connectionState in ["failed", "closed", "disconnected"]:
            pcs.discard(pc)

    pc.addTrack(StreamTrack(direction))
    await pc.setRemoteDescription(offer)
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    return web.Response(
        content_type="application/json",
        text=json.dumps({"sdp": pc.localDescription.sdp, "type": pc.localDescription.type}),
        headers={"Access-Control-Allow-Origin": "*"}
    )

async def options_handler(request):
    return web.Response(headers={
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
    })

async def on_shutdown(app):
    coros = [pc.close() for pc in pcs]
    await asyncio.gather(*coros)
    pcs.clear()
    telemetry_pool.shutdown(wait=False) # Free resources on exit

if __name__ == "__main__":
    app = web.Application()
    app.on_shutdown.append(on_shutdown)
    app.router.add_post("/offer/{direction}", offer)
    app.router.add_options("/offer/{direction}", options_handler)
    web.run_app(app, port=5000)