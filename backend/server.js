const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
// Essential middleware to parse incoming JSON telemetry from the Python WebRTC script
app.use(express.json()); 

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// 1. SYSTEM STATE (Includes waitCycles for the Fairness Algorithm)
let state = {
  activeDirection: 'North',
  phase: 'GREEN',
  timer: 10,
  directions: {
    North: { count: 0, signal: 'GREEN', waitCycles: 0 },
    South: { count: 0, signal: 'RED', waitCycles: 0 },
    East:  { count: 0, signal: 'RED', waitCycles: 0 },
    West:  { count: 0, signal: 'RED', waitCycles: 0 }
  }
};

let phaseTimeout;
const YELLOW_DURATION = 3; 

// 2. REST API: Receive live vehicle counts from the Python YOLO worker
app.post('/api/update-traffic', (req, res) => {
  const { direction, count } = req.body;
  
  if (state.directions[direction]) {
    state.directions[direction].count = count;
    io.emit('systemState', state); // Instantly broadcast the new count to the React UI
    res.status(200).send({ message: 'Count updated' });
  } else {
    res.status(400).send({ error: 'Invalid direction' });
  }
});

// 3. FAIRNESS ALGORITHM: Decide the next green light
function getNextDirection() {
  let highestScore = -1;
  let nextDir = state.activeDirection;
  
  for (const [dir, data] of Object.entries(state.directions)) {
    if (dir === state.activeDirection) continue; // Skip current
    if (data.count === 0) continue; // Skip empty lanes

    // Priority Score = Actual Count + (Wait Cycles * 5)
    const priorityScore = data.count + (data.waitCycles * 5); 

    if (priorityScore > highestScore) {
      highestScore = priorityScore;
      nextDir = dir;
    }
  }

  // Fallback: If all other lanes are empty, stay on current (if it has cars) or default to North
  if (highestScore === -1) {
    return state.directions[state.activeDirection].count > 0 ? state.activeDirection : 'North';
  }

  return nextDir;
}

// 4. STATE MACHINE: Handles light transitions and timer calculations
function cycleTrafficLight() {
  if (state.phase === 'GREEN') {
    // Transition GREEN -> YELLOW
    state.phase = 'YELLOW';
    state.directions[state.activeDirection].signal = 'YELLOW';
    state.timer = YELLOW_DURATION;
    
    phaseTimeout = setTimeout(cycleTrafficLight, YELLOW_DURATION * 1000);
  } else if (state.phase === 'YELLOW') {
    // Transition YELLOW -> RED
    state.directions[state.activeDirection].signal = 'RED';
    
    const nextDir = getNextDirection();
    
    // --- Fairness Accounting ---
    for (const dir in state.directions) {
      if (dir === nextDir) {
        state.directions[dir].waitCycles = 0; // Reset winner
      } else if (state.directions[dir].count > 0) {
        state.directions[dir].waitCycles += 1; // Increment waiting lanes
      }
    }

    // Dynamic Timer: 5s base + 1.5s per ACTUAL vehicle (Max 30 seconds)
    const actualVehicles = state.directions[nextDir].count;
    const dynamicTime = Math.max(5, Math.min(30, actualVehicles * 1.5)); 
    
    state.activeDirection = nextDir;
    state.phase = 'GREEN';
    state.directions[state.activeDirection].signal = 'GREEN';
    state.timer = Math.floor(dynamicTime);
    
    phaseTimeout = setTimeout(cycleTrafficLight, state.timer * 1000);
  }
}

// Start initial cycle
cycleTrafficLight();

// 1-second clock tick to sync the dashboard timers
setInterval(() => {
  if (state.timer > 0) state.timer -= 1;
  io.emit('systemState', state);
}, 1000);

// 5. WEBSOCKET CONTROLS: Manual Override & Reset Handling
io.on('connection', (socket) => {
  console.log('Dashboard connected');
  socket.emit('systemState', state);

  // Safely force the next light cycle
  socket.on('manualOverride', () => {
    if (state.phase === 'GREEN') {
      clearTimeout(phaseTimeout);
      state.timer = 0; 
      cycleTrafficLight(); // Forces the immediate transition to YELLOW
    }
  });

  // Hard reset the entire system back to baseline
  socket.on('reset', () => {
    clearTimeout(phaseTimeout);
    
    for (const dir in state.directions) {
      state.directions[dir].count = 0; 
      state.directions[dir].waitCycles = 0; 
      state.directions[dir].signal = 'RED';
    }

    state.activeDirection = 'North';
    state.phase = 'GREEN';
    state.directions['North'].signal = 'GREEN';
    state.timer = 5; // Default base time
    
    cycleTrafficLight();
    io.emit('systemState', state);
  });
});

server.listen(4000, () => console.log('Traffic Server running on port 4000'));