import { Pool, PoolClient } from 'pg';

const INTERVAL_MS = parseInt(process.env.PROCESSOR_INTERVAL_MS ?? '5000', 10);

const pool = new Pool({
  host:     process.env.POSTGRES_HOST     ?? 'localhost',
  port:     parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
  database: process.env.POSTGRES_DB       ?? 'iot_demo',
  user:     process.env.POSTGRES_USER     ?? 'iot_user',
  password: process.env.POSTGRES_PASSWORD ?? 'iot_password',
});

interface AssetState {
  machineId: number;
  assetId: string;        // e.g. "noria_01"
  signalName: string;     // e.g. "noria_01_running"
  running: boolean;
  stoppedAt: Date | null;
  lastProcessedTime: Date;
}

// Composite key: "<machineId>:<assetId>"
const states = new Map<string, AssetState>();

function stateKey(machineId: number, assetId: string): string {
  return `${machineId}:${assetId}`;
}

// "noria_01_running" → "noria_01"
function assetIdFromSignal(signalName: string): string {
  return signalName.replace(/_running$/, '');
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = String(Math.round(seconds % 60)).padStart(2, '0');
  return `${m}m ${s}s`;
}

// ---------------------------------------------------------------------------
// Discovery: find all asset *_running signals.
// Excludes fan_running (ventilation state, not an asset operational signal).
// ---------------------------------------------------------------------------
async function discoverAssets(client: PoolClient): Promise<Array<{ machineId: number; signalName: string }>> {
  const rows = await client.query<{ machine_id: number; signal_name: string }>(
    `SELECT DISTINCT machine_id, signal_name
     FROM telemetry_raw
     WHERE signal_name LIKE '%_running'
       AND signal_name NOT LIKE '%fan_running'
     ORDER BY machine_id, signal_name`,
  );
  return rows.rows.map(r => ({ machineId: r.machine_id, signalName: r.signal_name }));
}

// ---------------------------------------------------------------------------
// Initialize state for a single asset.
// Priority: recover from processed_events (new-format events carry assetId in metadata).
// Fallback: baseline from latest telemetry row.
// ---------------------------------------------------------------------------
async function initAssetState(
  client: PoolClient,
  machineId: number,
  signalName: string,
): Promise<AssetState | null> {
  const assetId = assetIdFromSignal(signalName);

  // Recover from events this processor version wrote (metadata carries assetId).
  const eventRow = await client.query<{ event_type: string; time: Date }>(
    `SELECT event_type, time
     FROM processed_events
     WHERE machine_id = $1
       AND event_type IN ('MACHINE_STOPPED', 'MACHINE_RESUMED')
       AND metadata->>'assetId' = $2
     ORDER BY time DESC
     LIMIT 1`,
    [machineId, assetId],
  );

  if (eventRow.rows.length > 0) {
    const { event_type, time } = eventRow.rows[0];
    console.log(
      `[processor]   ${assetId} (machine ${machineId}): recovered — last event ${event_type} at ${time.toISOString()}`,
    );
    return {
      machineId,
      assetId,
      signalName,
      running: event_type === 'MACHINE_RESUMED',
      stoppedAt: event_type === 'MACHINE_STOPPED' ? time : null,
      lastProcessedTime: time,
    };
  }

  // No prior events — baseline from most recent telemetry.
  const baseline = await client.query<{ time: Date; value: number }>(
    `SELECT time, value FROM telemetry_raw
     WHERE machine_id = $1 AND signal_name = $2
     ORDER BY time DESC LIMIT 1`,
    [machineId, signalName],
  );

  if (baseline.rows.length === 0) return null;

  const { time, value } = baseline.rows[0];
  const isRunning = value === 1;

  console.log(
    `[processor]   ${assetId} (machine ${machineId}): baseline ${isRunning ? 'RUNNING' : 'STOPPED'} at ${time.toISOString()}`,
  );

  return {
    machineId,
    assetId,
    signalName,
    running: isRunning,
    stoppedAt: isRunning ? null : time,
    lastProcessedTime: time,
  };
}

// ---------------------------------------------------------------------------
// Startup: load initial state for all discovered assets.
// ---------------------------------------------------------------------------
async function loadInitialState(client: PoolClient): Promise<void> {
  const assets = await discoverAssets(client);

  if (assets.length === 0) {
    console.log('[processor] No asset *_running signals found — will retry on each tick');
    return;
  }

  console.log(`[processor] Discovered ${assets.length} asset(s):`);

  for (const { machineId, signalName } of assets) {
    const assetId = assetIdFromSignal(signalName);
    const key = stateKey(machineId, assetId);
    if (states.has(key)) continue;

    const state = await initAssetState(client, machineId, signalName);
    if (state !== null) states.set(key, state);
  }
}

// ---------------------------------------------------------------------------
// Tick-time discovery: pick up assets that appeared after startup.
// ---------------------------------------------------------------------------
async function discoverNewAssets(client: PoolClient): Promise<void> {
  const assets = await discoverAssets(client);

  for (const { machineId, signalName } of assets) {
    const assetId = assetIdFromSignal(signalName);
    const key = stateKey(machineId, assetId);
    if (states.has(key)) continue;

    const state = await initAssetState(client, machineId, signalName);
    if (state !== null) {
      states.set(key, state);
      console.log(`[processor] New asset online: ${assetId} (machine ${machineId})`);
    }
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
// Event detection for one asset.
// ---------------------------------------------------------------------------
async function processAsset(client: PoolClient, key: string): Promise<void> {
  const state = states.get(key);
  if (state === undefined) return;

  const rows = await client.query<{ time: Date; value: number }>(
    `SELECT time, value FROM telemetry_raw
     WHERE machine_id = $1
       AND signal_name = $2
       AND time > $3
     ORDER BY time ASC`,
    [state.machineId, state.signalName, state.lastProcessedTime],
  );

  if (rows.rows.length === 0) return;

  let current = { ...state };

  for (const { time: t, value } of rows.rows) {
    const isRunning = value === 1;

    if (isRunning === current.running) {
      current.lastProcessedTime = t;
      continue;
    }

    if (!isRunning) {
      // running → stopped
      await persistEvent(client, current.machineId, 'MACHINE_STOPPED', t, null, {
        assetId: current.assetId,
        signal: current.signalName,
        previousState: 'running',
      });
      console.log(
        `[processor] STOP   ${current.assetId} (machine ${current.machineId}) at ${t.toISOString()}`,
      );
      current = { ...current, running: false, stoppedAt: t, lastProcessedTime: t };

    } else {
      // stopped → running
      const durationSeconds =
        current.stoppedAt !== null
          ? (t.getTime() - current.stoppedAt.getTime()) / 1000
          : null;

      await persistEvent(client, current.machineId, 'MACHINE_RESUMED', t, durationSeconds, {
        assetId: current.assetId,
        signal: current.signalName,
        stoppedAt: current.stoppedAt?.toISOString() ?? null,
      });

      if (durationSeconds !== null && current.stoppedAt !== null) {
        await persistEvent(client, current.machineId, 'DOWNTIME_DETECTED', t, durationSeconds, {
          assetId: current.assetId,
          signal: current.signalName,
          stoppedAt: current.stoppedAt.toISOString(),
          resumedAt: t.toISOString(),
          durationSeconds,
        });
        console.log(
          `[processor] RESUME ${current.assetId} (machine ${current.machineId}) — downtime ${formatDuration(durationSeconds)}`,
        );
      } else {
        console.log(
          `[processor] RESUME ${current.assetId} (machine ${current.machineId}) — downtime duration unknown (no prior stop recorded)`,
        );
      }

      current = { ...current, running: true, stoppedAt: null, lastProcessedTime: t };
    }
  }

  states.set(key, current);
}

// ---------------------------------------------------------------------------
// Tick: discover new assets, then process all tracked assets.
// ---------------------------------------------------------------------------
async function tick(): Promise<void> {
  const client = await pool.connect();
  try {
    await discoverNewAssets(client);
    for (const key of states.keys()) {
      await processAsset(client, key);
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

  const assetList = [...states.values()].map(s => s.assetId).join(', ');
  console.log(
    `[processor] Tracking ${states.size} asset(s)${states.size > 0 ? `: ${assetList}` : ' — waiting for telemetry'}`,
  );

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
