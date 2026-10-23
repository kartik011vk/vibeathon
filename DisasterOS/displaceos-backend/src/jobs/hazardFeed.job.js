// Polls the India hazard feeds (NDMA SACHET, USGS, GDACS) in-process. No Redis or queue is needed.
// Disable with HAZARD_FEEDS_ENABLED=false (e.g. for offline demos); the rest of the app is unaffected.
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { runFeeds } from '../services/hazard.service.js';

export function startHazardFeedJob() {
  if (!config.HAZARD_FEEDS_ENABLED || config.isTest) return null;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const { summary, created } = await runFeeds();
      logger.info({ summary, created }, 'Hazard feeds polled');
    } catch (err) {
      logger.error({ err: err.message }, 'Hazard feed run failed');
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 5000).unref();
  const timer = setInterval(tick, config.HAZARD_FEED_INTERVAL_MINUTES * 60 * 1000);
  timer.unref();
  logger.info({ everyMinutes: config.HAZARD_FEED_INTERVAL_MINUTES }, 'Hazard feed job enabled (NDMA SACHET, USGS, GDACS)');
  return timer;
}
