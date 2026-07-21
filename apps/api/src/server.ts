import { buildApp } from './app';
import { env } from './config/env';
import { startRecurringJob } from './jobs/recurring';
import { startStaleBalanceRemindersJob } from './jobs/stale-balance-reminders';
import { prisma } from './lib/prisma';
import { getIO, setupRealtime } from './realtime/io';

async function main(): Promise<void> {
  const app = await buildApp();
  setupRealtime(app);

  await app.listen({ port: env.PORT, host: env.HOST });
  startRecurringJob();
  startStaleBalanceRemindersJob();
  app.log.info(`Divzy API listening on ${env.HOST}:${env.PORT} (${env.NODE_ENV})`);
  // WI-077 — NODE_ENV also gates security-relevant behavior (e.g. the
  // secure-cookie flag in lib/auth.ts), so a `development` value reaching a
  // real deployment is worth a loud, unmissable log line, not just a silent
  // default.
  if (env.NODE_ENV === 'development') {
    app.log.warn(
      'NODE_ENV=development — if this is a real deployment (not local `pnpm dev`), this is a misconfiguration: set NODE_ENV=production.',
    );
  }

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'Shutting down');
    try {
      const io = getIO();
      if (io) await io.close();
      await app.close();
      await prisma.$disconnect();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  console.error('Failed to start Divzy API:', err);
  process.exit(1);
});
