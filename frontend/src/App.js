import React, { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';

const socket = io('http://localhost:4000');

const WebRTCFeed = ({ direction, onClose }) => {
  const videoRef = useRef(null);
  const pcRef = useRef(null);
  
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false); // [OPTIMIZATION] Track errors

  useEffect(() => {
    const startWebRTC = async () => {
      setIsLoading(true);
      setError(false);

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
      pcRef.current = pc;

      pc.addTransceiver('video', { direction: 'recvonly' });

      pc.ontrack = (event) => {
        if (videoRef.current && event.streams && event.streams[0]) {
          videoRef.current.srcObject = event.streams[0];
        }
      };

      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const response = await fetch(`http://localhost:5000/offer/${direction}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sdp: pc.localDescription.sdp,
            type: pc.localDescription.type
          })
        });
        
        if (!response.ok) throw new Error("Server rejected offer");

        const answer = await response.json();
        await pc.setRemoteDescription(answer);
      } catch (err) {
        console.error(`Failed to connect WebRTC for ${direction}:`, err);
        setIsLoading(false);
        setError(true); // [OPTIMIZATION] Escape the infinite loader
      }
    };

    startWebRTC();

    return () => {
      // [OPTIMIZATION] Hard cleanup of media tracks to prevent browser memory leaks
      if (videoRef.current && videoRef.current.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(track => track.stop());
      }
      if (pcRef.current) {
        pcRef.current.close();
      }
    };
  }, [direction]);

  return (
    <div className="webrtc-container">
      {isLoading && (
        <div className="loading-overlay">
          <div className="spinner"></div>
          <p>Connecting {direction} Feed...</p>
        </div>
      )}

      {error && (
        <div className="loading-overlay error-overlay">
          <p>❌ Connection Failed.</p>
          <button className="cam-toggle-btn" onClick={onClose}>Dismiss</button>
        </div>
      )}
      
      {!error && (
        <video 
          ref={videoRef} 
          autoPlay 
          playsInline 
          muted 
          className="live-video" 
          onPlaying={() => setIsLoading(false)} 
        />
      )}
      <button className="cam-toggle-btn overlay" onClick={onClose}>Close Feed</button>
    </div>
  );
};

export default function App() {
  const [state, setState] = useState(null);
  const [activeCameras, setActiveCameras] = useState({});

  useEffect(() => {
    socket.on('systemState', (newState) => setState(newState));
    return () => socket.off('systemState');
  }, []);

  const toggleCamera = (direction) => {
    setActiveCameras(prev => ({ ...prev, [direction]: !prev[direction] }));
  };

  if (!state) return <div>Loading System...</div>;

  return (
    <div className="dashboard">
      <header>
        <h1>Intelligent Traffic Control System</h1>
        <div className="controls">
          <button onClick={() => socket.emit('manualOverride')}>Force Next Cycle</button>
          <button onClick={() => socket.emit('reset')}>Reset System</button>
        </div>
      </header>

      <div className="grid">
        {Object.entries(state.directions).map(([dir, data]) => (
          <div key={dir} className={`panel ${state.activeDirection === dir ? 'active' : ''}`}>
            <h2>{dir} Camera</h2>
            
            <div className="video-feed-container">
              {activeCameras[dir] ? (
                <WebRTCFeed direction={dir} onClose={() => toggleCamera(dir)} />
              ) : (
                <div className="telemetry-mode">
                  <div className="pulse-dot"></div>
                  <p>Telemetry Mode Active</p>
                  <span className="bandwidth-badge">Saving 99% Bandwidth</span>
                  <button className="cam-toggle-btn" onClick={() => toggleCamera(dir)}>
                    View Live Stream 
                  </button>
                </div>
              )}
            </div>

            <div className="stats">
              <div className="metric"><span>Vehicles:</span><strong>{data.count}</strong></div>
              <div className="metric"><span>Wait Cycles:</span><strong>{data.waitCycles}</strong></div>
              <div className="metric">
                <span>Signal:</span>
                <strong className={`signal ${data.signal.toLowerCase()}`}>{data.signal}</strong>
              </div>
              <div className="metric">
                <span>Timer:</span>
                {/* [OPTIMIZATION] Read from the accurate displayTimer */}
                <strong>{state.activeDirection === dir ? state.displayTimer + 's' : '--'}</strong>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}