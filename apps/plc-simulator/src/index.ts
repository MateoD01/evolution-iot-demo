import http from 'http';

const PORT = parseInt(process.env.PORT ?? '3001', 10);

// ---------------------------------------------------------------------------
// Physical constants
// ---------------------------------------------------------------------------
const TEMP_AMBIENT       = 35;   // °C — cooling target when stopped
const TEMP_OPERATIONAL   = 73;   // °C — nominal target when running at full speed
const TEMP_ALARM_HIGH    = 76;   // °C — triggers thermal alarm
const TEMP_HEAT_ALPHA    = 0.015; // heating rate per tick (exponential approach)
const TEMP_COOL_ALPHA    = 0.008; // cooling rate per tick (slower than heating)

const SPEED_NOMINAL      = 850;  // rpm
const SPEED_VARIANCE     = 40;   // ±rpm band around nominal when running
const SPEED_RAMP_ALPHA   = 0.12; // how fast speed ramps up/down per tick

// ---------------------------------------------------------------------------
// Cycle timing
// ---------------------------------------------------------------------------
const RUN_MIN_MS  =  5 * 60 * 1000;  //  5 min minimum run
const RUN_MAX_MS  = 20 * 60 * 1000;  // 20 min maximum run
const STOP_MIN_MS = 45 * 1000;        // 45 sec minimum stop
const STOP_MAX_MS =  3 * 60 * 1000;  //  3 min maximum stop

const FAULT_ALARM_PROB   = 0.001; // per-tick probability of a random fault alarm
const FAULT_ALARM_MIN_MS = 8  * 1000;
const FAULT_ALARM_MAX_MS = 45 * 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function randBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ---------------------------------------------------------------------------
// Persistent machine state — updated on every telemetry request
// ---------------------------------------------------------------------------
interface MachineState {
  running:         boolean;
  temperature:     number;   // °C, evolves smoothly each tick
  speed:           number;   // rpm, 0 when stopped
  transitionAt:    Date;     // next planned state change
  faultAlarmUntil: Date | null;
}

const state: MachineState = {
  running:         true,
  temperature:     TEMP_OPERATIONAL,            // machine was already warm at startup
  speed:           SPEED_NOMINAL,
  transitionAt:    new Date(Date.now() + randBetween(RUN_MIN_MS, RUN_MAX_MS)),
  faultAlarmUntil: null,
};

// ---------------------------------------------------------------------------
// State update — called once per telemetry request
// ---------------------------------------------------------------------------
function updateState(): void {
  const now = Date.now();

  // --- State transition ---
  if (now >= state.transitionAt.getTime()) {
    if (state.running) {
      state.running = false;
      const stopDuration = randBetween(STOP_MIN_MS, STOP_MAX_MS);
      state.transitionAt = new Date(now + stopDuration);
      console.log(
        `[plc-simulator] STOPPED — resuming in ${Math.round(stopDuration / 1000)}s`,
      );
    } else {
      state.running = true;
      const runDuration = randBetween(RUN_MIN_MS, RUN_MAX_MS);
      state.transitionAt = new Date(now + runDuration);
      console.log(
        `[plc-simulator] STARTED — next stop in ${Math.round(runDuration / 60000)}min`,
      );
    }
  }

  // --- Temperature physics ---
  // Target drifts slightly with load variation when running
  const tempTarget = state.running
    ? TEMP_OPERATIONAL + (Math.random() - 0.5) * 4
    : TEMP_AMBIENT;
  const alpha = state.running ? TEMP_HEAT_ALPHA : TEMP_COOL_ALPHA;
  state.temperature += (tempTarget - state.temperature) * alpha;
  state.temperature = clamp(state.temperature, TEMP_AMBIENT - 1, TEMP_ALARM_HIGH + 3);

  // --- Speed physics ---
  const speedTarget = state.running
    ? SPEED_NOMINAL + (Math.random() - 0.5) * SPEED_VARIANCE * 2
    : 0;
  state.speed += (speedTarget - state.speed) * SPEED_RAMP_ALPHA;
  state.speed = clamp(state.speed, 0, 1050);

  // --- Fault alarm lifecycle (independent of thermal) ---
  if (state.faultAlarmUntil !== null && now >= state.faultAlarmUntil.getTime()) {
    state.faultAlarmUntil = null;
    console.log('[plc-simulator] Fault alarm cleared');
  }
  if (state.faultAlarmUntil === null && state.running && Math.random() < FAULT_ALARM_PROB) {
    const duration = randBetween(FAULT_ALARM_MIN_MS, FAULT_ALARM_MAX_MS);
    state.faultAlarmUntil = new Date(now + duration);
    console.log(
      `[plc-simulator] Fault alarm triggered — clears in ${Math.round(duration / 1000)}s`,
    );
  }
}

// ---------------------------------------------------------------------------
// Snapshot builder — reads state after update
// ---------------------------------------------------------------------------
interface Signal {
  name: string;
  value: number;
  unit: string;
}

interface PlcSnapshot {
  machineId: string;
  timestamp: string;
  signals: Signal[];
}

function buildSnapshot(): PlcSnapshot {
  updateState();

  const thermalAlarm = state.temperature >= TEMP_ALARM_HIGH;
  const faultAlarm   = state.faultAlarmUntil !== null && Date.now() < state.faultAlarmUntil.getTime();
  const alarmActive  = thermalAlarm || faultAlarm;

  // Parts produced this cycle: correlated with speed (0 during stop and ramp-up)
  const partsThisCycle = state.running
    ? Math.max(0, Math.round((state.speed / SPEED_NOMINAL) * (0.5 + Math.random() * 2.5)))
    : 0;

  return {
    machineId: 'PLC-001',
    timestamp: new Date().toISOString(),
    signals: [
      { name: 'running',       value: state.running ? 1 : 0,         unit: 'bool'    },
      { name: 'speed_rpm',     value: +state.speed.toFixed(1),        unit: 'rpm'     },
      { name: 'temperature_c', value: +state.temperature.toFixed(2),  unit: 'celsius' },
      { name: 'parts_count',   value: partsThisCycle,                 unit: 'count'   },
      { name: 'alarm_active',  value: alarmActive ? 1 : 0,            unit: 'bool'    },
    ],
  };
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'plc-simulator' }));
    return;
  }

  if (req.method === 'GET' && req.url === '/telemetry') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(buildSnapshot()));
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`[plc-simulator] Listening on port ${PORT}`);
  console.log(
    `[plc-simulator] First stop scheduled in ${Math.round((state.transitionAt.getTime() - Date.now()) / 60000)}min`,
  );
});
