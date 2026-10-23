// Optional periodic job (ESCALATION_JOB_ENABLED=true). Re-evaluates unverified requests so that
// age-based rules (minAgeMinutes) can raise the suggested priority of requests that have waited too long.
// Runs in-process with setInterval; no Redis or external queue is required.
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/env.js';
import { SEVERITY_LABELS, severityRank } from '../utils/constants.js';
import { contextFor, evaluate, loadRules } from '../services/severity.service.js';
import { addTimelineEvent } from '../services/timeline.service.js';
import { announceAlert, isRedLevel, upsertRequestAlertTx } from '../services/alert.service.js';
import { audit } from '../services/audit.service.js';
import { emit, rooms } from '../sockets/emitter.js';

export async function runEscalationPass() {
  const rules = await loadRules();
  const pending = await prisma.reliefRequest.findMany({ where: { status: 'SUBMITTED' }, include: { items: true, disasterZone: true } });
  let raised = 0;
  for (const r of pending) {
    const result = evaluate(rules, contextFor({ ...r, zone: r.disasterZone }), { includeAgeRules: true });
    if (severityRank(result.severity) <= severityRank(r.severity)) continue;
    const alertResult = await prisma.$transaction(async (tx) => {
      const updated = await tx.reliefRequest.update({
        where: { id: r.id },
        data: { suggestedSeverity: result.severity, severity: result.severity, severityReason: result.reasons.join('; ') },
      });
      await addTimelineEvent(tx, {
        requestId: r.id,
        type: 'SEVERITY_SUGGESTED',
        message: `Waiting time rule raised suggested priority to ${SEVERITY_LABELS[result.severity]}`,
        isPublic: false,
        data: { from: r.severity, to: result.severity, matchedRules: result.matchedRules },
      });
      await audit(tx, { actor: null, action: 'REQUEST_AUTO_ESCALATED', entityType: 'ReliefRequest', entityId: r.id, before: { severity: r.severity }, after: { severity: result.severity } });
      return isRedLevel(result.severity)
        ? upsertRequestAlertTx(tx, { request: updated, severity: result.severity, source: 'SYSTEM_RULE', reason: 'Raised by waiting-time rule', actor: null })
        : null;
    });
    raised += 1;
    emit([rooms.request(r.id), rooms.ops], 'request:updated', { id: r.id, severity: result.severity });
    if (alertResult?.changed) await announceAlert(alertResult.alert, { created: alertResult.created });
  }
  return { checked: pending.length, raised };
}

export function startEscalationJob() {
  if (!config.ESCALATION_JOB_ENABLED) return null;
  const timer = setInterval(async () => {
    try {
      const res = await runEscalationPass();
      if (res.raised) logger.info(res, 'Escalation pass raised request priorities');
    } catch (err) {
      logger.error({ err: err.message }, 'Escalation pass failed');
    }
  }, config.ESCALATION_JOB_INTERVAL_SECONDS * 1000);
  timer.unref();
  logger.info({ intervalSeconds: config.ESCALATION_JOB_INTERVAL_SECONDS }, 'Escalation job enabled');
  return timer;
}
