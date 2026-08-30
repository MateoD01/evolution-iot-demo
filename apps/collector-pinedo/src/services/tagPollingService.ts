import type { Block, Reading, TagDef } from '../types/collector';
import type { ModbusClient } from '../infrastructure/plc/modbusClient';

export class TagPollingService {
  constructor(
    private readonly modbusClient: ModbusClient,
    private readonly blocks: Block[],
  ) {}

  async pollOnce(): Promise<Reading[]> {
    const timestamp = new Date().toISOString();
    const readings: Reading[] = [];

    for (const block of this.blocks) {
      try {
        const rawData = await this.modbusClient.readBlock(block);

        for (const tag of block.tags) {
          const offset = tag.register - block.start;
          const rawSlice = rawData.slice(offset, offset + tag.words);
          const rawValue = this.modbusClient.decodeTagValue(tag, rawSlice);
          const scaledValue = tag.scale ? rawValue * tag.scale : rawValue;

          readings.push({
            tag: tag.tag,
            value: scaledValue,
            timestamp,
          });
        }
      } catch (err) {
        console.error(`[collector-pinedo] error leyendo bloque @${block.start} (${block.count} regs):`, (err as Error).message);
      }
    }

    return readings;
  }
}

export function buildBlocks(tagList: TagDef[], maxGap = 4, maxBlockSize = 125): Block[] {
  const sorted = [...tagList].sort((a, b) => a.register - b.register);
  const blocks: Block[] = [];
  let current: Block | null = null;

  for (const tag of sorted) {
    const end = tag.register + tag.words;

    if (!current || tag.register - (current.start + current.count) > maxGap || end - current.start > maxBlockSize) {
      current = { start: tag.register, count: end - tag.register, tags: [tag] };
      blocks.push(current);
    } else {
      current.count = Math.max(current.count, end - current.start);
      current.tags.push(tag);
    }
  }

  return blocks;
}
