import ModbusRTU from 'modbus-serial';
import type { Block, TagDef } from '../../types/collector';

export class ModbusClient {
  private readonly client = new ModbusRTU();

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly unitId: number,
  ) {}

  async connect(): Promise<void> {
    await this.client.connectTCP(this.host, { port: this.port });
    this.client.setID(this.unitId);
    this.client.setTimeout(5000);
    console.log(`[collector-pinedo] conectado a ${this.host}:${this.port} (unitID=${this.unitId})`);
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => {
      try {
        this.client.close(() => resolve());
      } catch {
        resolve();
      }
    });
  }

  async readBlock(block: Block): Promise<number[]> {
    const res = await this.client.readHoldingRegisters(block.start, block.count);
    return res.data as number[];
  }

  decodeTagValue(tag: TagDef, rawValues: number[]): number {
    if (tag.words === 1) return rawValues[0];

    const buf = Buffer.alloc(4);
    buf.writeUInt16BE(rawValues[1], 0);
    buf.writeUInt16BE(rawValues[0], 2);

    if (tag.type === 'float32_swapped') {
      return buf.readFloatBE(0);
    }

    return buf.readUInt32BE(0);
  }
}
