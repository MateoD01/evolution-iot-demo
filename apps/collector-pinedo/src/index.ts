import { env } from './config/env';
import { CollectorService } from './services/collectorService';

async function run(): Promise<void> {
  const collector = new CollectorService();
  const stats = collector.getStats();

  console.log(
    `[collector-pinedo] ${stats.tagsToPoll} tags a leer (excluidos ${stats.allTags - stats.tagsToPoll} CMD_* de solo-escritura), ${stats.blocks} bloques Modbus`,
  );

  await collector.ensureMachine();
  await collector.connectPlc();

  setInterval(async () => {
    try {
      await collector.runCycle();
    } catch (err) {
      console.error('[collector-pinedo] fallo de ciclo, reconectando...', (err as Error).message);
      try {
        await collector.reconnect();
      } catch (reconnectError) {
        console.error('[collector-pinedo] no se pudo reconectar', (reconnectError as Error).message);
      }
    }
  }, env.POLL_MS);
}

run();
