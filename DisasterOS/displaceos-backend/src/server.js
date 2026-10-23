import { createServer } from 'node:http';
import { config } from './config/env.js';
import { createApp } from './app.js';
import { createSocketServer } from './sockets/index.js';
import { startEscalationJob } from './jobs/escalation.job.js';
import { startHazardFeedJob } from './jobs/hazardFeed.job.js';
import { prisma } from './utils/prisma.js';
import { logger } from './utils/logger.js';

const app = createApp();
const httpServer = createServer(app);
const io = createSocketServer(httpServer);

try {
  await prisma.$connect();
} catch {
  logger.error('Could not connect to PostgreSQL. Check DATABASE_URL and that the database is running.');
  process.exit(1);
}

startEscalationJob();
startHazardFeedJob();

httpServer.listen(config.PORT, () => {
  logger.info(`DisplaceOS API listening on http://localhost:${config.PORT}/api/v1`);
  if (config.SWAGGER_ENABLED) logger.info(`API docs: http://localhost:${config.PORT}/api/docs`);
});

async function shutdown(signal) {
  logger.info({ signal }, 'Shutting down');
  io.close();
  httpServer.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
