import { BUILT_IN_RULES } from '../config/severityRules.js';
import { prisma } from '../utils/prisma.js';
import { severityRank } from '../utils/constants.js';

function matches(cond, ctx) {
  if (cond.categories?.length && !cond.categories.includes(ctx.category)) return false;
  if (cond.minPeopleAffected != null && !(ctx.peopleAffected >= cond.minPeopleAffected)) return false;
  if (cond.minVulnerableCount != null && !((ctx.vulnerableCount ?? 0) >= cond.minVulnerableCount)) return false;
  if (cond.minTotalQuantity != null && !(ctx.totalQuantity >= cond.minTotalQuantity)) return false;
  if (cond.inActiveZone && !ctx.zoneActive) return false;
  if (cond.minZoneSeverity && !(ctx.zoneActive && severityRank(ctx.zoneSeverity) >= severityRank(cond.minZoneSeverity)))
    return false;
  if (cond.minAgeMinutes != null) {
    if (ctx.ageMinutes == null || ctx.ageMinutes < cond.minAgeMinutes) return false;
  }
  return true;
}

export async function loadRules(db = prisma) {
  const custom = await db.escalationRule.findMany({ where: { isActive: true }, orderBy: { priority: 'asc' } });
  return [...BUILT_IN_RULES, ...custom.map((r) => ({ ...r, conditions: r.conditions ?? {} }))];
}

// Returns { severity, reasons[], matchedRules[] }. Severity is a suggestion for staff review.
// `includeAgeRules` is false at creation time because a new request has no waiting time yet.
export function evaluate(rules, ctx, { includeAgeRules = false } = {}) {
  let severity = 'NORMAL';
  const matchedRules = [];
  for (const rule of rules) {
    if (!includeAgeRules && rule.conditions.minAgeMinutes != null) continue;
    if (matches(rule.conditions, ctx)) {
      matchedRules.push({ id: rule.id, name: rule.name, severity: rule.resultingSeverity });
      if (severityRank(rule.resultingSeverity) > severityRank(severity)) severity = rule.resultingSeverity;
    }
  }
  const reasons = matchedRules.length
    ? matchedRules.map((r) => `${r.name} → ${r.severity}`)
    : ['No escalation rule matched; routine priority until reviewed'];
  return { severity, reasons, matchedRules };
}

export function contextFor({ category, peopleAffected, vulnerableCount, items, zone, createdAt }) {
  return {
    category,
    peopleAffected,
    vulnerableCount,
    totalQuantity: items.reduce((sum, i) => sum + i.quantity, 0),
    zoneActive: zone?.status === 'ACTIVE',
    zoneSeverity: zone?.severity ?? null,
    ageMinutes: createdAt ? (Date.now() - new Date(createdAt).getTime()) / 60000 : null,
  };
}

export async function suggestSeverity(input, db = prisma, opts) {
  const rules = await loadRules(db);
  return evaluate(rules, contextFor(input), opts);
}
