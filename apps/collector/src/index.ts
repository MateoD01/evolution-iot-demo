import { Pool } from 'pg';

const PLC_URL     = process.env.PLC_SIMULATOR_URL    ?? 'http://localhost:3001';
const INTERVAL_MS = parseInt(process.env.COLLECTOR_INTERVAL_MS ?? '1000', 10);

const pool = new Pool({
  host:     process.env.POSTGRES_HOST     ?? 'localhost',
  port:     parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
  database: process.env.POSTGRES_DB       ?? 'iot_demo',
  user:     process.env.POSTGRES_USER     ?? 'iot_user',
  password: process.env.POSTGRES_PASSWORD ?? 'iot_password',
});

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

async function fetchTelemetry(): Promise<PlcSnapshot> {
  const res = await fetch(`${PLC_URL}/telemetry`);
  if (!res.ok) throw new Error(`PLC returned HTTP ${res.status}`);
  return res.json() as Promise<PlcSnapshot>;
}

async function persistSnapshot(snapshot: PlcSnapshot): Promise<void> {
  const client = await pool.connect();
  try {
    const machineRow = await client.query(
      'SELECT id FROM machines WHERE name = $1',
      [snapshot.machineId],
    );
    const machineId: number = (machineRow.rows[0]?.id as number | undefined) ?? 1;

    for (const signal of snapshot.signals) {
      await client.query(
        `INSERT INTO telemetry_raw (time, machine_id, signal_name, value, unit)
         VALUES ($1, $2, $3, $4, $5)`,
        [snapshot.timestamp, machineId, signal.name, signal.value, signal.unit],
      );
    }
  } finally {
    client.release();
  }
}

async function collect(): Promise<void> {
  try {
    const snapshot = await fetchTelemetry();
    await persistSnapshot(snapshot);
    console.log(`[collector] Stored snapshot — machine: ${snapshot.machineId}  time: ${snapshot.timestamp}`);
  } catch (err) {
    console.error('[collector] Error:', (err as Error).message);
  }
}

async function run(): Promise<void> {
  console.log(`[collector] Starting — PLC: ${PLC_URL}  interval: ${INTERVAL_MS}ms`);
  await collect();
  setInterval(collect, INTERVAL_MS);
}

run();
