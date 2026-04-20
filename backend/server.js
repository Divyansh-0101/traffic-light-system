const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(express.json()); 

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// System Constants
const YELLOW_DURATION = 3; 
const BASE_GREEN_TIME = 5;
const MAX_GREEN_TIME = 30;

// [OPTIMIZATION] State now tracks absolute end times, not relative ticks
let state = {
  activeDirection: 'North',
  phase: 'GREEN',
  phaseEndTime: Date.now() + (BASE_GREEN_TIME * 1000), // Timestamp
  displayTimer: BASE_GREEN_TIME, // Calculated for UI
  directions: {
    North: { count: 0, signal: 'GREEN', waitCycles: 0 },
    South: { count: 0, signal: 'RED', waitCycles: 0 },
    East:  { count: 0, signal: 'RED', waitCycles: 0 },
    West:  { count: 0, signal: 'RED', waitCycles: 0 }
  }
};

let phaseTimeout;

app.post('/api/update-traffic', (req, res) => {
  const { direction, count } = req.body;
  if (state.directions[direction]) {
    state.directions[direction].count = count;
    res.status(200).send({ message: 'Count updated' });
  } else {
    res.status(400).send({ error: 'Invalid direction' });
  }
});

function getNextDirection() {
  let highestScore = -1;
  let nextDir = state.activeDirection;
  
  for (const [dir, data] of Object.entries(state.directions)) {
    if (dir === state.activeDirection || data.count === 0) continue; 
    
    const priorityScore = data.count + (data.waitCycles * 5); 
    if (priorityScore > highestScore) {
      highestScore = priorityScore;
      nextDir = dir;
    }
  }

  if (highestScore === -1) {
    return state.directions[state.activeDirection].count > 0 ? state.activeDirection : 'North';
  }
  return nextDir;
}

function setPhase(durationSeconds) {
    state.phaseEndTime = Date.now() + (durationSeconds * 1000);
    state.displayTimer = durationSeconds;
    phaseTimeout = setTimeout(cycleTrafficLight, durationSeconds * 1000);
}

function cycleTrafficLight() {
  if (state.phase === 'GREEN') {
    const totalWaitingCars = Object.entries(state.directions)
        .reduce((acc, [dir, data]) => acc + (dir !== state.activeDirection ? data.count : 0), 0);

    if (totalWaitingCars === 0 && state.directions[state.activeDirection].count === 0) {
        setPhase(BASE_GREEN_TIME); // Safely extend
        return; 
    }

    state.phase = 'YELLOW';
    state.directions[state.activeDirection].signal = 'YELLOW';
    setPhase(YELLOW_DURATION);

  } else if (state.phase === 'YELLOW') {
    state.directions[state.activeDirection].signal = 'RED';
    const nextDir = getNextDirection();
    
    for (const dir in state.directions) {
      if (dir === nextDir) {
        state.directions[dir].waitCycles = 0; 
      } else if (state.directions[dir].count > 0) {
        state.directions[dir].waitCycles += 1; 
      }
    }

    const actualVehicles = state.directions[nextDir].count;
    const dynamicTime = Math.max(BASE_GREEN_TIME, Math.min(MAX_GREEN_TIME, actualVehicles * 1.5)); 
    
    state.activeDirection = nextDir;
    state.phase = 'GREEN';
    state.directions[state.activeDirection].signal = 'GREEN';
    setPhase(Math.floor(dynamicTime));
  }
}

cycleTrafficLight();

// [OPTIMIZATION] Drift-Free Sync Clock
setInterval(() => {
  const remaining = Math.max(0, Math.ceil((state.phaseEndTime - Date.now()) / 1000));
  state.displayTimer = remaining;
  io.emit('systemState', state);
}, 250); // Tick 4x a second for snappier UI, Math.ceil keeps it smooth

io.on('connection', (socket) => {
  socket.emit('systemState', state);

  socket.on('manualOverride', () => {
    if (state.phase === 'GREEN') {
      clearTimeout(phaseTimeout);
      cycleTrafficLight(); 
    }
  });

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
    setPhase(BASE_GREEN_TIME);
    io.emit('systemState', state);
  });
});

server.listen(4000, () => console.log('Traffic Server running on port 4000'));