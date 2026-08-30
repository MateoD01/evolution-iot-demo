import type { Pool } from 'pg';
import type { Reading } from '../types/collector';

export class TelemetryRepository {
  constructor(private readonly db: Pool) {}

  async persist(machineId: number, readings: Reading[]): Promise<void> {
    const client = await this.db.connect();

    try {
      for (const reading of readings) {
        await client.query(
          `INSERT INTO telemetry_raw (time, machine_id, signal_name, value, unit)
           VALUES ($1, $2, $3, $4, $5)`,
          [reading.timestamp, machineId, reading.tag, reading.value, null],
        );
      }
    } finally {
      client.release();
    }
  }
}
