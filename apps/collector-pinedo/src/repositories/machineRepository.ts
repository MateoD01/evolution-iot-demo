import type { Pool } from 'pg';

export class MachineRepository {
  constructor(private readonly db: Pool) {}

  async ensureMachine(name: string, description: string): Promise<number> {
    const res = await this.db.query<{ id: number }>(
      `INSERT INTO machines (name, description)
       VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description
       RETURNING id`,
      [name, description],
    );

    return res.rows[0].id;
  }
}
