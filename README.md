# 🚦 AI-Driven Dynamic Traffic Light Management System

An enterprise-grade, full-stack traffic management dashboard that uses real-time Computer Vision (YOLOv8) to dynamically route traffic based on vehicle density. It features a Fairness/Anti-Starvation algorithm to balance wait times and utilizes WebRTC for sub-second latency video streaming.

## ✨ Key Features
* **Real-Time AI Vehicle Detection:** Uses YOLOv8 nano to continuously count vehicles across 4 camera feeds.
* **Density-Based Routing:** Calculates green light duration dynamically based on the exact number of waiting vehicles (e.g., 5s Base Time + 1.5s per vehicle).
* **Fairness Algorithm (Anti-Starvation):** Tracks "Wait Cycles" to artificially boost the priority of low-traffic lanes, ensuring no driver waits forever.
* **WebRTC Video Streaming:** Ultra-low latency, highly compressed H.264 live camera feeds streamed directly to the browser.
* **Telemetry Mode:** Saves 99% of bandwidth by running AI invisibly in the background, only initiating heavy WebRTC video streams when an operator clicks "View Live Stream."
* **Real-time Synchronization:** React dashboard syncs instantly with the Node.js state machine via WebSockets.

## 🛠️ Tech Stack
* **Frontend:** React.js, CSS3 (Modern Dark Dashboard)
* **Backend:** Node.js, Express, Socket.io
* **Computer Vision:** Python, Ultralytics YOLOv8, OpenCV
* **Streaming Protocol:** WebRTC (`aiortc`), `aiohttp`

## 📂 Project Structure
```text
traffic-light-system/
├── backend/                # Node.js + Socket.io State Machine
│   ├── package.json
│   └── server.js           
├── frontend/               # React UI Dashboard
│   ├── src/                
│   └── package.json        
├── cv_worker/              # Python AI & WebRTC Server
│   ├── requirements.txt    
│   └── webrtc_tracker.py   
├── package.json            # Root package for running all services via 'concurrently'
└── README.md