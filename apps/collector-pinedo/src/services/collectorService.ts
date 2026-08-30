import { env } from '../config/env';
import { pool } from '../config/database';
import { MachineRepository } from '../repositories/machineRepository';
import { TelemetryRepository } from '../repositories/telemetryRepository';
import { ModbusClient } from '../infrastructure/plc/modbusClient';
import { TagPollingService, buildBlocks } from './tagPollingService';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { TagDef, Reading, Block } from '../types/collector';

function resolveTagsPath(): string {
  const candidates = [
    join(process.cwd(), 'src', 'tags.pinedo.json'),
    join(process.cwd(), 'dist', 'tags.pinedo.json'),
    join(__dirname, '..', 'tags.pinedo.json'),
  ];

  const existing = candidates.find((candidate) => existsSync(candidate));
  if (!existing) {
    throw new Error(`No se encontró tags.pinedo.json. Buscados: ${candidates.join(', ')}`);
  }

  return existing;
}

export class CollectorService {
  private readonly machineRepository = new MachineRepository(pool);
  private readonly telemetryRepository = new TelemetryRepository(pool);
  private readonly tags: TagDef[];
  private readonly blocks: Block[];
  private readonly modbusClient: ModbusClient;
  private readonly pollingService: TagPollingService;
  private machineId: number | null = null;

  constructor() {
    this.tags = JSON.parse(readFileSync(resolveTagsPath(), 'utf-8')) as TagDef[];
    const tagsToPoll = this.tags.filter((tag) => !tag.readOnly);
    this.blocks = buildBlocks(tagsToPoll);
    this.modbusClient = new ModbusClient(env.PLC_HOST, env.PLC_PORT, env.UNIT_ID);
    this.pollingService = new TagPollingService(this.modbusClient, this.blocks);
  }

  getStats(): { tagsToPoll: number; allTags: number; blocks: number } {
    return {
      tagsToPoll: this.tags.filter((tag) => !tag.readOnly).length,
      allTags: this.tags.length,
      blocks: this.blocks.length,
    };
  }

  async ensureMachine(): Promise<number> {
    this.machineId = await this.machineRepository.ensureMachine(
      env.MACHINE_NAME,
      'Planta de silos Pinedo — PLC Schneider M340 (mapa real Electroluz)',
    );

    return this.machineId;
  }

  async connectPlc(): Promise<void> {
    await this.modbusClient.connect();
  }

  async runCycle(): Promise<Reading[]> {
    if (!this.machineId) {
      this.machineId = await this.ensureMachine();
    }

    const readings = await this.pollingService.pollOnce();
    await this.telemetryRepository.persist(this.machineId, readings);

    console.log(`[collector-pinedo] ${new Date().toISOString()} — ${readings.length} lecturas guardadas`);
    return readings;
  }

  async reconnect(): Promise<void> {
    try {
      await this.modbusClient.close();
    } catch {
      // noop
    }

    await this.connectPlc();
  }
}
