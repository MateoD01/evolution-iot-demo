import { Pool } from 'pg';

const INTERVAL_MS = parseInt(process.env.PROCESSOR_INTERVAL_MS ?? '5000', 10);

const pool = new Pool({
  host:     process.env.POSTGRES_HOST     ?? 'localhost',
  port:     parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
  database: process.env.POSTGRES_DB       ?? 'iot_demo',
  user:     process.env.POSTGRES_USER     ?? 'iot_user',
  password: process.env.POSTGRES_PASSWORD ?? 'iot_password',
});

async function tick(): Promise<void> {
  const result = await pool.query<{ signal_name: string; readings: string }>(
    `SELECT signal_name, COUNT(*) AS readings
     FROM telemetry_raw
     WHERE time > NOW() - INTERVAL '10 seconds'
     GROUP BY signal_name
     ORDER BY signal_name`,
  );

  if (result.rows.length === 0) {
    console.log('[processor] No recent telemetry yet');
    return;
  }

  for (const row of result.rows) {
    console.log(`[processor] signal=${row.signal_name}  readings_10s=${row.readings}`);
  }
}

async function run(): Promise<void> {
  console.log(`[processor] Starting — interval: ${INTERVAL_MS}ms`);

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
