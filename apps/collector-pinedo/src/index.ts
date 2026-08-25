/**
 * Collector Service real — habla Modbus TCP (FC03, solo lectura) contra el M340
 * de Pinedo (o contra plc-simulator-pinedo, que responde exactamente igual).
 *
 * Escribe en la misma tabla telemetry_raw que usa apps/collector, bajo la
 * máquina 'PLC-PINEDO', para que apps/processor (genérico, detecta cualquier
 * señal *_running) los procese sin cambios.
 *
 * Pasar a producción = cambiar PLC_HOST/PLC_PORT a 172.16.16.180:502. Nada más.
 */

import ModbusRTU from 'modbus-serial';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

interface TagDef {
  tag: string;
  sourceName: string;
  register: number;
  words: 1 | 2;
  type: 'uint16' | 'uint32_swapped' | 'float32_swapped';
  fc: number;
  readOnly: boolean;
  scale: number | null;
}

interface Block {
  start: number;
  count: number;
  tags: TagDef[];
}

const PLC_HOST = process.env.PLC_HOST ?? 'plc-simulator-pinedo';
const PLC_PORT = parseInt(process.env.PLC_PORT ?? '502', 10);
const UNIT_ID = parseInt(process.env.PLC_UNIT_ID ?? '255', 10); // DA=255 del export WinCC
const POLL_MS = parseInt(process.env.POLL_MS ?? '1000', 10);
const MACHINE_NAME = process.env.MACHINE_NAME ?? 'PLC-PINEDO';

const pool = new Pool({
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
  database: process.env.POSTGRES_DB ?? 'iot_demo',
  user: process.env.POSTGRES_USER ?? 'iot_user',
  password: process.env.POSTGRES_PASSWORD ?? 'iot_password',
});

const allTags: TagDef[] = JSON.parse(readFileSync(join(__dirname, 'tags.pinedo.json'), 'utf-8'));

// Solo lectura, siempre: los CMD_* son escribibles por el SCADA pero nuestro
// collector jamás debe escribirlos ni aunque el protocolo se lo permita.
const tagsToPoll = allTags.filter((t) => !t.readOnly);

const client = new ModbusRTU();

async function connectPlc(): Promise<void> {
  await client.connectTCP(PLC_HOST, { port: PLC_PORT });
  client.setID(UNIT_ID);
  client.setTimeout(5000);
  console.log(`[collector-pinedo] conectado a ${PLC_HOST}:${PLC_PORT} (unitID=${UNIT_ID})`);
}

function decode(t: TagDef, regs: number[]): number {
  if (t.words === 1) return regs[0];
  const buf = Buffer.alloc(4);
  buf.writeUInt16BE(regs[1], 0); // orden "swapped", igual convención que Swap=1 del SCADA
  buf.writeUInt16BE(regs[0], 2);
  return t.type === 'float32_swapped' ? buf.readFloatBE(0) : buf.readUInt32BE(0);
}

// Agrupa tags contiguos en bloques de hasta 125 registros (límite Modbus TCP por request FC03).
function buildBlocks(tagList: TagDef[], maxGap = 4, maxBlockSize = 125): Block[] {
  const sorted = [...tagList].sort((a, b) => a.register - b.register);
  const blocks: Block[] = [];
  let current: Block | null = null;

  for (const t of sorted) {
    const end = t.register + t.words;
    if (!current || t.register - (current.start + current.count) > maxGap || end - current.start > maxBlockSize) {
      current = { start: t.register, count: end - t.register, tags: [t] };
      blocks.push(current);
    } else {
      current.count = Math.max(current.count, end - current.start);
      current.tags.push(t);
    }
  }
  return blocks;
}

const blocks = buildBlocks(tagsToPoll);

interface Reading {
  tag: string;
  value: number;
  timestamp: string;
}

async function pollOnce(): Promise<Reading[]> {
  const timestamp = new Date().toISOString();
  const readings: Reading[] = [];

  for (const block of blocks) {
    try {
      const res = await client.readHoldingRegisters(block.start, block.count); // FC 03
      for (const t of block.tags) {
        const offset = t.register - block.start;
        const raw = decode(t, res.data.slice(offset, offset + t.words));
        readings.push({ tag: t.tag, value: t.scale ? raw * t.scale : raw, timestamp });
      }
    } catch (err) {
      console.error(`[collector-pinedo] error leyendo bloque @${block.start} (${block.count} regs):`, (err as Error).message);
    }
  }
  return readings;
}

async function ensureMachine(): Promise<number> {
  const res = await pool.query<{ id: number }>(
    `INSERT INTO machines (name, description) VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description
     RETURNING id`,
    [MACHINE_NAME, 'Planta de silos Pinedo — PLC Schneider M340 (mapa real Electroluz)'],
  );
  return res.rows[0].id;
}

async function persist(machineId: number, readings: Reading[]): Promise<void> {
  const dbClient = await pool.connect();
  try {
    for (const r of readings) {
      await dbClient.query(
        `INSERT INTO telemetry_raw (time, machine_id, signal_name, value, unit)
         VALUES ($1, $2, $3, $4, $5)`,
        [r.timestamp, machineId, r.tag, r.value, null],
      );
    }
  } finally {
    dbClient.release();
  }
}

async function run(): Promise<void> {
  console.log(`[collector-pinedo] ${tagsToPoll.length} tags a leer (excluidos ${allTags.length - tagsToPoll.length} CMD_* de solo-escritura), ${blocks.length} bloques Modbus`);

  const machineId = await ensureMachine();
  await connectPlc();

  setInterval(async () => {
    try {
      const readings = await pollOnce();
      await persist(machineId, readings);
      console.log(`[collector-pinedo] ${new Date().toISOString()} — ${readings.length} lecturas guardadas`);
    } catch (err) {
      console.error('[collector-pinedo] fallo de ciclo, reconectando...', (err as Error).message);
      try {
        client.close(() => {});
      } catch {
        /* noop */
      }
      await connectPlc();
    }
  }, POLL_MS);
}

run();
