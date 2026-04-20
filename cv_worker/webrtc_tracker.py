import asyncio
import json
import cv2
import requests
import threading
import time
import numpy as np
from aiohttp import web
from aiortc import RTCPeerConnection, RTCSessionDescription, VideoStreamTrack
from av import VideoFrame
from ultralytics import YOLO

print("Loading YOLO model...")
model = YOLO('yolov8n.pt')
VEHICLE_CLASSES = [2, 3, 5, 7]
NODE_SERVER_URL = "http://localhost:4000/api/update-traffic"

CAMERAS = {
    "North": "north.mp4", 
    "South": "south.mp4",
    "East": "east.mp4",
    "West": "west.mp4"
}

# 1. GLOBAL STATE: Store the latest processed frame for WebRTC to grab
latest_frames = {dir: None for dir in CAMERAS}

# 2. BACKGROUND WORKER: Runs 24/7 regardless of WebRTC connections
def camera_worker(direction, source):
    print(f"Started continuous AI tracking for {direction}...")
    cap = cv2.VideoCapture(source)
    frame_skip = 5
    frame_count = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0) # Loop video if it ends
            continue

        frame_count += 1
        if frame_count % frame_skip == 0:
            # Run YOLO AI
            results = model.predict(frame, classes=VEHICLE_CLASSES, conf=0.3, verbose=False)
            vehicle_count = len(results[0].boxes)
            
            # Save the annotated frame to global state
            latest_frames[direction] = results[0].plot()

            # FIRE TELEMETRY 24/7
            try:
                requests.post(NODE_SERVER_URL, json={"direction": direction, "count": vehicle_count}, timeout=1)
            except requests.exceptions.RequestException:
                pass
        
        # Small sleep to prevent maxing out CPU if reading from local MP4 files
        time.sleep(0.01)

# Start a background thread for each camera
for dir_name, src in CAMERAS.items():
    t = threading.Thread(target=camera_worker, args=(dir_name, src), daemon=True)
    t.start()


# 3. WEBRTC VIDEO TRACK: Only streams when a user clicks "View Camera"
class StreamTrack(VideoStreamTrack):
    def __init__(self, direction):
        super().__init__()
        self.direction = direction

    async def recv(self):
        pts, time_base = await self.next_timestamp()

        # Grab the latest frame processed by the background thread
        frame = latest_frames[self.direction]
        
        if frame is None:
            # If camera hasn't loaded yet, send a blank black frame
            frame = np.zeros((480, 640, 3), dtype=np.uint8)

        # Convert OpenCV BGR to RGB for WebRTC
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        new_frame = VideoFrame.from_ndarray(rgb_frame, format="rgb24")
        new_frame.pts = pts
        new_frame.time_base = time_base
        
        return new_frame

# --- HTTP ENDPOINTS FOR WEBRTC HANDSHAKE ---
async def offer(request):
    params = await request.json()
    offer = RTCSessionDescription(sdp=params["sdp"], type=params["type"])
    direction = request.match_info.get('direction')

    if direction not in CAMERAS:
        return web.Response(status=404, text="Camera not found")

    pc = RTCPeerConnection()
    
    # Attach our lightweight StreamTrack
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
    headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
    }
    return web.Response(headers=headers)

if __name__ == "__main__":
    app = web.Application()
    app.router.add_post("/offer/{direction}", offer)
    app.router.add_options("/offer/{direction}", options_handler)
    
    print("Starting WebRTC Signaling Server on port 5000...")
    web.run_app(app, port=5000)