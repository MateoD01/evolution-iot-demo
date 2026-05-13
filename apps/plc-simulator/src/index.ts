import http from 'http';

const PORT = parseInt(process.env.PORT ?? '3001', 10);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function randBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function lerp(current: number, target: number, alpha: number): number {
  return current + (target - current) * alpha;
}

// ---------------------------------------------------------------------------
// Shared asset interfaces
// ---------------------------------------------------------------------------
interface FaultAlarmable {
  running: boolean;
  faultAlarmUntil: Date | null;
}

interface CycleAsset extends FaultAlarmable {
  transitionAt: Date;
}

// ---------------------------------------------------------------------------
// Cycle and fault alarm helpers
// ---------------------------------------------------------------------------
function tickCycle(
  asset: CycleAsset,
  runMinMs: number,
  runMaxMs: number,
  stopMinMs: number,
  stopMaxMs: number,
  label: string,
): void {
  if (Date.now() < asset.transitionAt.getTime()) return;
  const wasRunning = asset.running;
  asset.running = !wasRunning;
  const d = wasRunning
    ? randBetween(stopMinMs, stopMaxMs)
    : randBetween(runMinMs, runMaxMs);
  asset.transitionAt = new Date(Date.now() + d);
  if (wasRunning) {
    console.log(`[plc-simulator] ${label} STOPPED — resuming in ${Math.round(d / 1000)}s`);
  } else {
    console.log(`[plc-simulator] ${label} STARTED — next stop in ${Math.round(d / 60_000)}min`);
  }
}

function maybeFaultAlarm(
  asset: FaultAlarmable,
  faultProb: number,
  minMs: number,
  maxMs: number,
  label: string,
): void {
  const now = Date.now();
  if (asset.faultAlarmUntil !== null && now >= asset.faultAlarmUntil.getTime()) {
    asset.faultAlarmUntil = null;
    console.log(`[plc-simulator] ${label} fault alarm cleared`);
  }
  if (asset.faultAlarmUntil === null && asset.running && Math.random() < faultProb) {
    const d = randBetween(minMs, maxMs);
    asset.faultAlarmUntil = new Date(now + d);
    console.log(`[plc-simulator] ${label} fault alarm — clears in ${Math.round(d / 1000)}s`);
  }
}

function hasFaultAlarm(asset: { faultAlarmUntil: Date | null }): boolean {
  return asset.faultAlarmUntil !== null && Date.now() < asset.faultAlarmUntil.getTime();
}

// ---------------------------------------------------------------------------
// Fault alarm constants
// ---------------------------------------------------------------------------
const FAULT_PROB_NORMAL = 0.0002; // per tick
const FAULT_PROB_HIGH   = 0.0004; // NORIA-01 — more fault-prone
const FAULT_MIN_MS      = 10_000;
const FAULT_MAX_MS      = 60_000;

// ---------------------------------------------------------------------------
// Asset state types
// ---------------------------------------------------------------------------
interface VolcableState extends CycleAsset {
  load:     number; // 0–1
  currentA: number;
}

interface RedlerState extends CycleAsset {
  load:        number;
  temperature: number; // °C — bearing / gearbox
  vibration:   number; // mm/s
  currentA:    number;
}

interface NoriaState extends CycleAsset {
  load:        number;
  temperature: number;
  vibration:   number;
  currentA:    number;
}

interface DistribuidoraState extends FaultAlarmable {
  load:     number;
  currentA: number;
}

interface SecadoraState extends CycleAsset {
  load:        number;
  temperature: number; // chamber °C
  humidity:    number; // output grain humidity %
  currentA:    number;
}

interface SiloHumedoState {
  capacity:    number; // 0–100 %
  fanRunning:  boolean;
  faultAlarmUntil: Date | null;
}

interface SiloSecoState {
  capacity:    number;
  fanRunning:  boolean;
  faultAlarmUntil: Date | null;
}

// ---------------------------------------------------------------------------
// Initial states — plant was mid-shift at startup
// ---------------------------------------------------------------------------
const volcable: VolcableState = {
  running:         true,
  transitionAt:    new Date(Date.now() + randBetween(20 * 60_000, 55 * 60_000)),
  faultAlarmUntil: null,
  load:            0.82,
  currentA:        46,
};

const redler: RedlerState = {
  running:         true,
  transitionAt:    new Date(Date.now() + randBetween(180 * 60_000, 420 * 60_000)),
  faultAlarmUntil: null,
  load:            0.80,
  temperature:     42,
  vibration:       1.8,
  currentA:        61,
};

const noria: NoriaState = {
  running:         true,
  transitionAt:    new Date(Date.now() + randBetween(60 * 60_000, 150 * 60_000)),
  faultAlarmUntil: null,
  load:            0.77,
  temperature:     55,
  vibration:       2.1,
  currentA:        84,
};

const distribuidora: DistribuidoraState = {
  running:         true,
  faultAlarmUntil: null,
  load:            0.77,
  currentA:        21,
};

const secadora: SecadoraState = {
  running:         true,
  transitionAt:    new Date(Date.now() + randBetween(120 * 60_000, 300 * 60_000)),
  faultAlarmUntil: null,
  load:            0.74,
  temperature:     95,
  humidity:        13.5,
  currentA:        108,
};

const siloHumedo: SiloHumedoState = {
  capacity:        45,
  fanRunning:      true,
  faultAlarmUntil: null,
};

const siloSeco: SiloSecoState = {
  capacity:        38,
  fanRunning:      true,
  faultAlarmUntil: null,
};

// ---------------------------------------------------------------------------
// Nominal capacities
// ---------------------------------------------------------------------------
const VOLCABLE_MAX_TPH = 120;
const REDLER_MAX_TPH   = 115;
const NORIA_MAX_TPH    = 110;
const DISTRIB_MAX_TPH  = 108;
const SECADORA_MAX_TPH = 90;

// ---------------------------------------------------------------------------
// Per-asset update functions — called once per telemetry request
// ---------------------------------------------------------------------------

function updateVolcable(): void {
  tickCycle(volcable, 20 * 60_000, 55 * 60_000, 5 * 60_000, 30 * 60_000, 'VOLCABLE-01');
  maybeFaultAlarm(volcable, FAULT_PROB_NORMAL, FAULT_MIN_MS, FAULT_MAX_MS, 'VOLCABLE-01');

  const loadTarget = volcable.running ? 0.70 + Math.random() * 0.25 : 0;
  volcable.load     = clamp(lerp(volcable.load, loadTarget, 0.06), 0, 1);
  volcable.currentA = clamp(
    lerp(volcable.currentA, volcable.load * 57 + (Math.random() - 0.5) * 4, 0.10),
    0, 80,
  );
}

function updateRedler(): void {
  tickCycle(redler, 180 * 60_000, 420 * 60_000, 30 * 60_000, 90 * 60_000, 'REDLER-01');
  maybeFaultAlarm(redler, FAULT_PROB_NORMAL, FAULT_MIN_MS, FAULT_MAX_MS, 'REDLER-01');

  // Throughput follows VOLCABLE when both running; residual tail-off when volcable stops
  const loadTarget = redler.running
    ? (volcable.running ? volcable.load * 0.97 : Math.max(0, redler.load - 0.02))
    : 0;
  redler.load = clamp(lerp(redler.load, loadTarget, 0.08), 0, 1);

  const tempTarget = redler.running
    ? 34 + redler.load * 18 + (Math.random() - 0.5) * 2
    : 28;
  redler.temperature = clamp(lerp(redler.temperature, tempTarget, 0.012), 18, 70);

  const vibTarget = redler.running
    ? 0.9 + redler.load * 2.6 + Math.random() * 0.4
    : 0.2;
  redler.vibration = clamp(lerp(redler.vibration, vibTarget, 0.05), 0, 6);

  redler.currentA = clamp(
    lerp(redler.currentA, redler.load * 78 + (Math.random() - 0.5) * 5, 0.10),
    0, 100,
  );
}

function updateNoria(): void {
  tickCycle(noria, 60 * 60_000, 150 * 60_000, 10 * 60_000, 40 * 60_000, 'NORIA-01');
  maybeFaultAlarm(noria, FAULT_PROB_HIGH, FAULT_MIN_MS, FAULT_MAX_MS, 'NORIA-01');

  const loadTarget = noria.running
    ? (redler.running ? redler.load * 0.96 : Math.max(0, noria.load - 0.03))
    : 0;
  noria.load = clamp(lerp(noria.load, loadTarget, 0.10), 0, 1);

  const tempTarget = noria.running
    ? 46 + noria.load * 22 + (Math.random() - 0.5) * 3
    : 30;
  noria.temperature = clamp(lerp(noria.temperature, tempTarget, 0.010), 24, 88);

  const vibTarget = noria.running
    ? 1.4 + noria.load * 3.2 + Math.random() * 0.5
    : 0.3;
  noria.vibration = clamp(lerp(noria.vibration, vibTarget, 0.05), 0, 9);

  noria.currentA = clamp(
    lerp(noria.currentA, noria.load * 102 + (Math.random() - 0.5) * 6, 0.10),
    0, 135,
  );
}

function updateDistribuidora(): void {
  // DISTRIBUIDORA-01 is mechanically coupled to NORIA-01
  distribuidora.running = noria.running;
  maybeFaultAlarm(distribuidora, FAULT_PROB_NORMAL, FAULT_MIN_MS, FAULT_MAX_MS, 'DISTRIBUIDORA-01');

  const loadTarget = distribuidora.running ? noria.load * 0.99 : 0;
  distribuidora.load     = clamp(lerp(distribuidora.load, loadTarget, 0.12), 0, 1);
  distribuidora.currentA = clamp(
    lerp(distribuidora.currentA, distribuidora.load * 27 + (Math.random() - 0.5) * 2, 0.10),
    0, 40,
  );
}

function updateSecadora(): void {
  tickCycle(secadora, 120 * 60_000, 300 * 60_000, 30 * 60_000, 90 * 60_000, 'SECADORA-01');
  maybeFaultAlarm(secadora, FAULT_PROB_NORMAL, FAULT_MIN_MS, FAULT_MAX_MS, 'SECADORA-01');

  const loadTarget = secadora.running
    ? (distribuidora.running ? distribuidora.load * 0.95 : Math.max(0, secadora.load - 0.04))
    : 0;
  secadora.load = clamp(lerp(secadora.load, loadTarget, 0.05), 0, 1);

  // Chamber temperature rises with load; cools on stop
  const tempTarget = secadora.running
    ? 90 + secadora.load * 8 + (Math.random() - 0.5) * 1.5
    : 35;
  secadora.temperature = clamp(lerp(secadora.temperature, tempTarget, 0.008), 28, 108);

  // Output humidity drops as dryer handles more grain (better moisture extraction)
  const humidTarget = secadora.running
    ? 14.2 - secadora.load * 1.8 + (Math.random() - 0.5) * 0.4
    : 18;
  secadora.humidity = clamp(lerp(secadora.humidity, humidTarget, 0.015), 9, 22);

  secadora.currentA = clamp(
    lerp(secadora.currentA, secadora.load * 133 + (Math.random() - 0.5) * 8, 0.08),
    0, 165,
  );
}

function updateSiloHumedo(): void {
  // Fills from DISTRIBUIDORA; drains into SECADORA
  if (distribuidora.running) {
    siloHumedo.capacity += distribuidora.load * 0.010;
  }
  if (secadora.running) {
    siloHumedo.capacity -= secadora.load * 0.008;
  }
  siloHumedo.capacity = clamp(siloHumedo.capacity, 0, 100);

  // Ventilation fan auto-starts above 20% to prevent moisture buildup
  siloHumedo.fanRunning = siloHumedo.capacity > 20;

  const now = Date.now();
  if (siloHumedo.faultAlarmUntil !== null && now >= siloHumedo.faultAlarmUntil.getTime()) {
    siloHumedo.faultAlarmUntil = null;
  }
  const levelFine = siloHumedo.capacity >= 8 && siloHumedo.capacity <= 92;
  if (levelFine && siloHumedo.faultAlarmUntil === null && Math.random() < FAULT_PROB_NORMAL / 2) {
    siloHumedo.faultAlarmUntil = new Date(now + randBetween(FAULT_MIN_MS, FAULT_MAX_MS));
    console.log('[plc-simulator] SILO-HUMEDO-01 sensor fault alarm triggered');
  }
}

function updateSiloSeco(): void {
  // Fills from SECADORA; slow continuous drain from grain shipments
  if (secadora.running) {
    siloSeco.capacity += secadora.load * 0.008;
  }
  siloSeco.capacity -= 0.003; // continuous dispatch drain
  siloSeco.capacity = clamp(siloSeco.capacity, 0, 100);

  // Ventilation fan auto-starts above 15% to maintain grain quality
  siloSeco.fanRunning = siloSeco.capacity > 15;

  const now = Date.now();
  if (siloSeco.faultAlarmUntil !== null && now >= siloSeco.faultAlarmUntil.getTime()) {
    siloSeco.faultAlarmUntil = null;
  }
  const levelFine = siloSeco.capacity <= 94;
  if (levelFine && siloSeco.faultAlarmUntil === null && Math.random() < FAULT_PROB_NORMAL / 2) {
    siloSeco.faultAlarmUntil = new Date(now + randBetween(FAULT_MIN_MS, FAULT_MAX_MS));
    console.log('[plc-simulator] SILO-SECO-01 sensor fault alarm triggered');
  }
}

// ---------------------------------------------------------------------------
// Snapshot builder
// ---------------------------------------------------------------------------
interface Signal {
  name:  string;
  value: number;
  unit:  string;
}

interface PlcSnapshot {
  machineId: string;
  timestamp: string;
  signals:   Signal[];
}

function buildSnapshot(): PlcSnapshot {
  updateVolcable();
  updateRedler();
  updateNoria();
  updateDistribuidora();
  updateSecadora();
  updateSiloHumedo();
  updateSiloSeco();

  // Derived alarm states: fault alarm OR threshold breach
  const volcableAlarm  = hasFaultAlarm(volcable) ? 1 : 0;
  const redlerAlarm    = (hasFaultAlarm(redler) || redler.temperature > 65 || redler.vibration > 5.0) ? 1 : 0;
  const noriaAlarm     = (hasFaultAlarm(noria)  || noria.temperature  > 78 || noria.vibration  > 6.5) ? 1 : 0;
  const distribAlarm   = hasFaultAlarm(distribuidora) ? 1 : 0;
  const secadoraAlarm  = (hasFaultAlarm(secadora) || secadora.temperature > 102 || secadora.humidity > 18) ? 1 : 0;
  const siloHumedoAlarm = (siloHumedo.capacity < 8 || siloHumedo.capacity > 92 || hasFaultAlarm(siloHumedo)) ? 1 : 0;
  const siloSecoAlarm   = (siloSeco.capacity > 94 || hasFaultAlarm(siloSeco)) ? 1 : 0;

  const signals: Signal[] = [
    // VOLCABLE-01 — grain unloader / intake
    { name: 'volcable_01_running',        value: volcable.running ? 1 : 0,                              unit: 'bool'    },
    { name: 'volcable_01_alarm_active',   value: volcableAlarm,                                         unit: 'bool'    },
    { name: 'volcable_01_throughput_tph', value: +(volcable.load * VOLCABLE_MAX_TPH).toFixed(1),         unit: 'tph'     },
    { name: 'volcable_01_current_a',      value: +volcable.currentA.toFixed(1),                          unit: 'amperes' },

    // REDLER-01 — chain conveyor
    { name: 'redler_01_running',          value: redler.running ? 1 : 0,                                unit: 'bool'    },
    { name: 'redler_01_alarm_active',     value: redlerAlarm,                                            unit: 'bool'    },
    { name: 'redler_01_throughput_tph',   value: +(redler.load * REDLER_MAX_TPH).toFixed(1),             unit: 'tph'     },
    { name: 'redler_01_current_a',        value: +redler.currentA.toFixed(1),                            unit: 'amperes' },
    { name: 'redler_01_temperature_c',    value: +redler.temperature.toFixed(2),                         unit: 'celsius' },
    { name: 'redler_01_vibration_mm_s',   value: +redler.vibration.toFixed(3),                           unit: 'mm/s'    },

    // NORIA-01 — bucket elevator (critical path)
    { name: 'noria_01_running',           value: noria.running ? 1 : 0,                                 unit: 'bool'    },
    { name: 'noria_01_alarm_active',      value: noriaAlarm,                                             unit: 'bool'    },
    { name: 'noria_01_throughput_tph',    value: +(noria.load * NORIA_MAX_TPH).toFixed(1),               unit: 'tph'     },
    { name: 'noria_01_current_a',         value: +noria.currentA.toFixed(1),                             unit: 'amperes' },
    { name: 'noria_01_temperature_c',     value: +noria.temperature.toFixed(2),                          unit: 'celsius' },
    { name: 'noria_01_vibration_mm_s',    value: +noria.vibration.toFixed(3),                            unit: 'mm/s'    },

    // DISTRIBUIDORA-01 — grain distributor (follows NORIA)
    { name: 'distribuidora_01_running',        value: distribuidora.running ? 1 : 0,                    unit: 'bool'    },
    { name: 'distribuidora_01_alarm_active',   value: distribAlarm,                                      unit: 'bool'    },
    { name: 'distribuidora_01_throughput_tph', value: +(distribuidora.load * DISTRIB_MAX_TPH).toFixed(1), unit: 'tph'    },
    { name: 'distribuidora_01_current_a',      value: +distribuidora.currentA.toFixed(1),                unit: 'amperes' },

    // SECADORA-01 — rotary dryer
    { name: 'secadora_01_running',        value: secadora.running ? 1 : 0,                              unit: 'bool'    },
    { name: 'secadora_01_alarm_active',   value: secadoraAlarm,                                          unit: 'bool'    },
    { name: 'secadora_01_temperature_c',  value: +secadora.temperature.toFixed(2),                       unit: 'celsius' },
    { name: 'secadora_01_humidity_pct',   value: +secadora.humidity.toFixed(2),                          unit: 'percent' },
    { name: 'secadora_01_current_a',      value: +secadora.currentA.toFixed(1),                          unit: 'amperes' },

    // SILO-HUMEDO-01 — wet grain buffer
    { name: 'silo_humedo_01_capacity_pct', value: +siloHumedo.capacity.toFixed(2),                      unit: 'percent' },
    { name: 'silo_humedo_01_alarm_active', value: siloHumedoAlarm,                                       unit: 'bool'    },
    { name: 'silo_humedo_01_fan_running',  value: siloHumedo.fanRunning ? 1 : 0,                        unit: 'bool'    },

    // SILO-SECO-01 — dry grain storage
    { name: 'silo_seco_01_capacity_pct',   value: +siloSeco.capacity.toFixed(2),                        unit: 'percent' },
    { name: 'silo_seco_01_alarm_active',   value: siloSecoAlarm,                                         unit: 'bool'    },
    { name: 'silo_seco_01_fan_running',    value: siloSeco.fanRunning ? 1 : 0,                          unit: 'bool'    },
  ];

  return {
    machineId: 'PLC-001',
    timestamp: new Date().toISOString(),
    signals,
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
  console.log(`[plc-simulator] Grain silo plant — listening on port ${PORT}`);
  console.log('[plc-simulator] Assets: VOLCABLE-01 → REDLER-01 → NORIA-01 → DISTRIBUIDORA-01 → SILO-HUMEDO-01 ↔ SECADORA-01 → SILO-SECO-01');
  console.log(`[plc-simulator] 31 signals across 7 assets`);
});
