import { Pool, PoolClient } from 'pg';

const INTERVAL_MS = parseInt(process.env.PROCESSOR_INTERVAL_MS ?? '5000', 10);

const pool = new Pool({
  host:     process.env.POSTGRES_HOST     ?? 'localhost',
  port:     parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
  database: process.env.POSTGRES_DB       ?? 'iot_demo',
  user:     process.env.POSTGRES_USER     ?? 'iot_user',
  password: process.env.POSTGRES_PASSWORD ?? 'iot_password',
});

interface MachineState {
  running: boolean;
  stoppedAt: Date | null;     // when the current stop began
  lastProcessedTime: Date;    // telemetry cursor — only look at rows after this
}

// One entry per machine_id, populated at startup and kept current in memory.
const states = new Map<number, MachineState>();

// ---------------------------------------------------------------------------
// Startup: recover state from processed_events so restarts don't re-emit.
// For machines with no prior events, establish baseline from latest telemetry.
// ---------------------------------------------------------------------------
async function loadInitialState(client: PoolClient): Promise<void> {
  const eventRows = await client.query<{
    machine_id: number;
    event_type: string;
    time: Date;
  }>(
    `SELECT DISTINCT ON (machine_id) machine_id, event_type, time
     FROM processed_events
     WHERE event_type IN ('MACHINE_STOPPED', 'MACHINE_RESUMED')
     ORDER BY machine_id, time DESC`,
  );

  for (const row of eventRows.rows) {
    states.set(row.machine_id, {
      running: row.event_type === 'MACHINE_RESUMED',
      stoppedAt: row.event_type === 'MACHINE_STOPPED' ? row.time : null,
      lastProcessedTime: row.time,
    });
    console.log(
      `[processor] Recovered machine ${row.machine_id}: last event=${row.event_type} at ${row.time.toISOString()}`,
    );
  }

  // Machines that exist in telemetry but have no prior events yet.
  const machineRows = await client.query<{ machine_id: number }>(
    `SELECT DISTINCT machine_id FROM telemetry_raw ORDER BY machine_id`,
  );

  for (const { machine_id } of machineRows.rows) {
    if (states.has(machine_id)) continue;

    // Use the latest reading as the baseline — don't retroactively emit events.
    const baseline = await client.query<{ time: Date; value: number }>(
      `SELECT time, value FROM telemetry_raw
       WHERE machine_id = $1 AND signal_name = 'running'
       ORDER BY time DESC LIMIT 1`,
      [machine_id],
    );

    if (baseline.rows.length === 0) continue;

    const { time, value } = baseline.rows[0];
    const isRunning = value === 1;

    states.set(machine_id, {
      running: isRunning,
      stoppedAt: isRunning ? null : time,
      lastProcessedTime: time,
    });

    console.log(
      `[processor] Machine ${machine_id} baseline: ${isRunning ? 'running' : 'stopped'} at ${time.toISOString()}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
async function persistEvent(
  client: PoolClient,
  machineId: number,
  eventType: string,
  time: Date,
  durationSeconds: number | null,
  metadata: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO processed_events (time, machine_id, event_type, duration_seconds, metadata)
     VALUES ($1, $2, $3, $4, $5)`,
    [time, machineId, eventType, durationSeconds, JSON.stringify(metadata)],
  );
}

// ---------------------------------------------------------------------------
// Event detection for one machine.
// Reads all running-signal rows since lastProcessedTime in chronological order
// so every transition within a tick window is caught.
// ---------------------------------------------------------------------------
async function processMachine(client: PoolClient, machineId: number): Promise<void> {
  const state = states.get(machineId);
  if (state === undefined) return;

  const rows = await client.query<{ time: Date; value: number }>(
    `SELECT time, value FROM telemetry_raw
     WHERE machine_id = $1
       AND signal_name = 'running'
       AND time > $2
     ORDER BY time ASC`,
    [machineId, state.lastProcessedTime],
  );

  if (rows.rows.length === 0) return;

  // Work on a local copy so the map is only updated after successful processing.
  let current = { ...state };

  for (const { time: t, value } of rows.rows) {
    const isRunning = value === 1;

    if (isRunning === current.running) {
      current.lastProcessedTime = t;
      continue;
    }

    if (!isRunning) {
      // Transition: running → stopped
      await persistEvent(client, machineId, 'MACHINE_STOPPED', t, null, {
        previousState: 'running',
      });
      console.log(`[processor] Machine ${machineId} STOPPED at ${t.toISOString()}`);
      current = { running: false, stoppedAt: t, lastProcessedTime: t };

    } else {
      // Transition: stopped → running
      const durationSeconds =
        current.stoppedAt !== null
          ? (t.getTime() - current.stoppedAt.getTime()) / 1000
          : null;

      await persistEvent(client, machineId, 'MACHINE_RESUMED', t, durationSeconds, {
        stoppedAt: current.stoppedAt?.toISOString() ?? null,
      });

      // DOWNTIME_DETECTED is emitted only when the full stop→resume interval is known.
      if (durationSeconds !== null && current.stoppedAt !== null) {
        await persistEvent(client, machineId, 'DOWNTIME_DETECTED', t, durationSeconds, {
          stoppedAt: current.stoppedAt.toISOString(),
          resumedAt: t.toISOString(),
          durationSeconds,
        });
        console.log(
          `[processor] Machine ${machineId} RESUMED — downtime ${durationSeconds.toFixed(1)}s`,
        );
      } else {
        // stoppedAt is unknown (machine was stopped before the processor first ran)
        console.log(`[processor] Machine ${machineId} RESUMED — downtime duration unknown`);
      }

      current = { running: true, stoppedAt: null, lastProcessedTime: t };
    }
  }

  states.set(machineId, current);
}

// ---------------------------------------------------------------------------
// Tick: process every tracked machine.
// ---------------------------------------------------------------------------
async function tick(): Promise<void> {
  const client = await pool.connect();
  try {
    for (const machineId of states.keys()) {
      await processMachine(client, machineId);
    }
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function run(): Promise<void> {
  console.log(`[processor] Starting — interval: ${INTERVAL_MS}ms`);

  const client = await pool.connect();
  try {
    await loadInitialState(client);
  } finally {
    client.release();
  }

  console.log(`[processor] Tracking ${states.size} machine(s)`);

  const safeTick = async () => {
    try {
      await tick();
    } catch (err) {
      console.error('[processor] Error:', (err as Error).message);
    }
  };

  await safeTick();
  setInterval(safeTick, INTERVAL_MS);
}

run();
