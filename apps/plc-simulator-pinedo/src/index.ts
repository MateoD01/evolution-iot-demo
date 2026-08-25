/**
 * Simulador Modbus TCP del M340 de Pinedo — "gemelo digital" a nivel protocolo.
 *
 * A diferencia de apps/plc-simulator (que simula assets de alto nivel por HTTP,
 * usado para las demos ya mostradas al cliente), este servicio expone un servidor
 * Modbus TCP real con el MISMO mapa de registros que el PLC real, tal como fue
 * exportado del SCADA de Electroluz (Tags Scada Pinedo.xlsx → tags.pinedo.json).
 *
 * Objetivo: desarrollar y validar collector-pinedo contra un servidor que responde
 * exactamente como el M340 respondería. Para pasar a producción, el único cambio
 * es apuntar PLC_HOST/PLC_PORT a 172.16.16.180:502.
 */

import { ServerTCP } from 'modbus-serial';
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

const PORT = parseInt(process.env.SIM_PORT ?? '502', 10);
const HOST = process.env.SIM_HOST ?? '0.0.0.0';
const UNIT_ID = parseInt(process.env.SIM_UNIT_ID ?? '255', 10); // = DA=255 del export WinCC
const TICK_MS = parseInt(process.env.SIM_TICK_MS ?? '1000', 10);

const tags: TagDef[] = JSON.parse(readFileSync(join(__dirname, 'tags.pinedo.json'), 'utf-8'));

const REG_COUNT = Math.max(...tags.map((t) => t.register + t.words)) + 10;
const registers = new Uint16Array(REG_COUNT);

function writeU16(addr: number, val: number): void {
  registers[addr] = val & 0xffff;
}

function writeU32Swapped(addr: number, val: number): void {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(val >>> 0, 0);
  registers[addr] = buf.readUInt16BE(2); // low word primero (igual convención que Swap=1)
  registers[addr + 1] = buf.readUInt16BE(0);
}

// ---- Indexar EST_/CMD_/HS_ por sufijo de equipo para simular pares con ciclo propio ----
interface EquipoGroup {
  EST?: TagDef;
  HS?: TagDef;
}
const byGroup: Record<string, EquipoGroup> = {};
for (const t of tags) {
  const m = t.sourceName.match(/^([A-Za-z]+)_(.+)$/);
  if (!m) continue;
  const [, prefix, suffix] = m;
  if (prefix !== 'EST' && prefix !== 'HS') continue;
  byGroup[suffix] = byGroup[suffix] ?? {};
  (byGroup[suffix] as Record<string, TagDef>)[prefix] = t;
}

const equipos = Object.keys(byGroup).filter((k) => byGroup[k].EST);

interface MotorState {
  running: boolean;
  horas: number;
  proximoCambio: number;
}
const estado: Record<string, MotorState> = {};
for (const suf of equipos) {
  estado[suf] = {
    running: false,
    horas: Math.floor(Math.random() * 500),
    proximoCambio: Date.now() + Math.random() * 20000,
  };
}

const analogTag = tags.find((t) => t.sourceName === 'AA_1_PC');

setInterval(() => {
  const now = Date.now();
  let algunoCorriendo = false;

  for (const suf of equipos) {
    const st = estado[suf];
    const est = byGroup[suf].EST!;
    const hs = byGroup[suf].HS;

    if (now >= st.proximoCambio) {
      st.running = !st.running;
      st.proximoCambio = now + (st.running ? 20000 + Math.random() * 160000 : 5000 + Math.random() * 35000);
      console.log(`[sim-pinedo] ${suf}: ${st.running ? 'ARRANCA' : 'PARA'}`);
    }

    writeU16(est.register, st.running ? 1 : 0);
    if (st.running) {
      algunoCorriendo = true;
      st.horas += TICK_MS / 3_600_000;
      if (hs) writeU32Swapped(hs.register, Math.floor(st.horas));
    }
  }

  if (analogTag) {
    const base = algunoCorriendo ? 4200 + Math.random() * 300 : 20 + Math.random() * 10;
    writeU16(analogTag.register, Math.round(base));
  }
}, TICK_MS);

const vector = {
  getHoldingRegister: (addr: number, _unitID: number, callback: (err: Error | null, value: number) => void) => {
    callback(null, registers[addr] ?? 0);
  },
  setRegister: (addr: number, value: number, _unitID: number, callback: (err: Error | null) => void) => {
    // El SCADA real escribe acá (son los CMD_*). El collector NUNCA debe hacerlo.
    registers[addr] = value;
    console.log(`[sim-pinedo] WRITE en registro ${addr} = ${value}`);
    callback(null);
  },
};

const server = new ServerTCP(vector, { host: HOST, port: PORT, unitID: UNIT_ID });
server.on('socketError', (err: Error | null) => console.error('[sim-pinedo] socket error:', err));

console.log(`[sim-pinedo] PLC simulado (Pinedo/M340) escuchando Modbus TCP en ${HOST}:${PORT}, unitID=${UNIT_ID}`);
console.log(`[sim-pinedo] ${tags.length} tags cargados, ${equipos.length} equipos con ciclo ON/OFF simulado`);
