import { prisma } from '../utils/prisma.js';
import { notFound } from '../utils/errors.js';
import { BUILT_IN_RULES } from '../config/severityRules.js';
import { audit } from './audit.service.js';

export async function listRules() {
  const custom = await prisma.escalationRule.findMany({ orderBy: [{ isActive: 'desc' }, { priority: 'asc' }] });
  return {
    builtIn: BUILT_IN_RULES.map((r) => ({ ...r, isActive: true, editable: false })),
    custom: custom.map((r) => ({ ...r, editable: true })),
  };
}

export async function createRule(user, data, req) {
  const rule = await prisma.escalationRule.create({ data: { ...data, createdById: user.id } });
  await audit(null, { actor: user, action: 'ESCALATION_RULE_CREATED', entityType: 'EscalationRule', entityId: rule.id, after: data, req });
  return rule;
}

export async function updateRule(user, id, data, req) {
  const before = await prisma.escalationRule.findUnique({ where: { id } });
  if (!before) throw notFound('Escalation rule');
  const rule = await prisma.escalationRule.update({ where: { id }, data });
  await audit(null, { actor: user, action: 'ESCALATION_RULE_UPDATED', entityType: 'EscalationRule', entityId: id, before, after: data, req });
  return rule;
}
