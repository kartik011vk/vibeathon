// Optional provider adapters. The core backend never requires any of them.
//
// Adapter contracts:
//   notification channel: { name, deliver({ user, title, body, data }) -> Promise<void> }  (throws on failure)
//   routing:              { name, estimate({ from:{lat,lng}, to:{lat,lng} }) -> Promise<{ distanceKm, durationMinutes }> }
//
// Only a development "console" email/SMS adapter ships with the project. Real providers (SMTP, SMS gateway,
// OSRM/GraphHopper, etc.) can be added here without touching services.
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { emit, rooms } from '../sockets/emitter.js';

const maskEmail = (e) => (e ? e.replace(/^(.).*(@.*)$/, '$1***$2') : 'unknown');

const consoleChannel = (name) => ({
  name: `console-${name}`,
  async deliver({ user, title }) {
    // Logs only that a message would be sent. Body and full address are intentionally omitted.
    logger.info({ channel: name, to: maskEmail(user.email), title }, 'Development notification adapter');
  },
});

function pick(kind, value) {
  if (!value) return null;
  if (value === 'console') return consoleChannel(kind);
  logger.warn({ kind, value }, 'Unknown provider configured; treating it as not configured');
  return null;
}

// Mutable registry so tests can substitute failing adapters.
export const channels = {
  inApp: {
    name: 'in-app-socket',
    async deliver({ user, notification }) {
      emit(rooms.user(user.id), 'notification:created', {
        id: notification.id,
        type: notification.type,
        title: notification.title,
      });
    },
  },
  email: pick('email', config.EMAIL_PROVIDER),
  sms: pick('sms', config.SMS_PROVIDER),
};

// No routing provider ships with the project. OpenStreetMap tiles alone cannot produce road ETAs.
if (config.ROUTING_PROVIDER) {
  logger.warn({ value: config.ROUTING_PROVIDER }, 'ROUTING_PROVIDER is set but no adapter is implemented for it');
}
export const routing = { adapter: null };

export function routingStatus() {
  return routing.adapter
    ? { configured: true, provider: routing.adapter.name }
    : { configured: false, provider: null, reason: 'No routing provider is configured on this server' };
}
