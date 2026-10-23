// Responder onboarding.
//   1. A relief organisation registers (status PENDING). Its lead gets a normal account with no extra powers.
//   2. An admin approves it: the lead becomes RESPONSE_TEAM and the organisation gets its first response team.
//   3. The lead shares a join code; members sign up with it (membership PENDING).
//   4. The lead approves each member, who then becomes RESPONSE_TEAM on the organisation's team.
// Nobody can grant themselves a privileged role: every step that adds RESPONSE_TEAM is an approval by someone else.
import { randomBytes } from 'node:crypto';
import { prisma } from '../utils/prisma.js';
import { badRequest, conflict, forbidden, invalidTransition, notFound } from '../utils/errors.js';
import { sha256 } from '../utils/crypto.js';
import { pageMeta } from '../utils/pagination.js';
import { Roles } from '../utils/constants.js';
import { audit } from './audit.service.js';
import { hashPassword, issueSession, publicUser } from './auth.service.js';
import { notifyRoles, notifyUsers } from './notification.service.js';

const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
function newJoinCode() {
  const bytes = randomBytes(8);
  let code = '';
  for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}
const normaliseCode = (c) => c.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(.{4})(.{4})$/, '$1-$2');

async function assertEmailFree(email) {
  if (await prisma.user.findUnique({ where: { email } })) throw conflict('An account with this email already exists');
}

export async function registerOrganization({ organization, account }, req) {
  await assertEmailFree(account.email);
  if (await prisma.organization.findUnique({ where: { name: organization.name } })) {
    throw conflict('An organisation with this name is already registered');
  }
  const passwordHash = await hashPassword(account.password);
  const { user, org } = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: organization });
    const user = await tx.user.create({
      data: {
        email: account.email,
        fullName: account.fullName,
        phone: account.phone,
        passwordHash,
        role: Roles.CITIZEN,
        organizationId: org.id,
        orgRole: 'LEAD',
        membershipStatus: 'PENDING',
        preference: { create: {} },
      },
    });
    await audit(tx, { actor: user, action: 'ORGANIZATION_REGISTERED', entityType: 'Organization', entityId: org.id, after: { name: org.name, type: org.type }, req });
    return { user, org };
  });
  await notifyRoles([Roles.ADMIN], {
    type: 'ORGANIZATION_PENDING',
    title: `New responder organisation: ${org.name}`,
    body: `${org.type.replace('_', ' ').toLowerCase()} in ${org.area} is waiting for approval.`,
    severity: 'HIGH',
    data: { organizationId: org.id },
  });
  const tokens = await issueSession(prisma, user, { userAgent: req.get('user-agent') });
  return { user: publicUser(user), organization: shapeOrg(org), ...tokens };
}

export async function joinOrganization({ joinCode, account }, req) {
  const org = await prisma.organization.findUnique({ where: { joinCodeHash: sha256(normaliseCode(joinCode)) } });
  if (!org || org.status !== 'APPROVED') throw notFound('Organisation for this join code');
  await assertEmailFree(account.email);
  const passwordHash = await hashPassword(account.password);
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        email: account.email,
        fullName: account.fullName,
        phone: account.phone,
        passwordHash,
        role: Roles.CITIZEN,
        organizationId: org.id,
        orgRole: 'MEMBER',
        membershipStatus: 'PENDING',
        preference: { create: {} },
      },
    });
    await audit(tx, { actor: u, action: 'ORGANIZATION_JOIN_REQUESTED', entityType: 'Organization', entityId: org.id, req });
    return u;
  });
  const leads = await prisma.user.findMany({ where: { organizationId: org.id, orgRole: 'LEAD', membershipStatus: 'APPROVED' }, select: { id: true } });
  await notifyUsers(
    leads.map((l) => l.id),
    { type: 'MEMBER_PENDING', title: `${account.fullName} wants to join ${org.name}`, body: 'Approve or reject them on your organisation page.', data: { organizationId: org.id } },
  );
  const tokens = await issueSession(prisma, user, { userAgent: req.get('user-agent') });
  return { user: publicUser(user), organization: shapeOrg(org), ...tokens };
}

function shapeOrg(o) {
  return {
    id: o.id,
    name: o.name,
    type: o.type,
    area: o.area,
    description: o.description,
    contactPhone: o.contactPhone,
    status: o.status,
    reviewNote: o.reviewNote,
    reviewedAt: o.reviewedAt,
    hasJoinCode: Boolean(o.joinCodeHash),
    createdAt: o.createdAt,
  };
}

const memberSelect = { id: true, fullName: true, email: true, phone: true, role: true, orgRole: true, membershipStatus: true, createdAt: true };

export async function getMyOrganization(user) {
  const me = await prisma.user.findUnique({ where: { id: user.id }, select: { organizationId: true, orgRole: true, membershipStatus: true } });
  if (!me?.organizationId) throw notFound('Organisation membership');
  const org = await prisma.organization.findUnique({
    where: { id: me.organizationId },
    include: {
      members: { select: memberSelect, orderBy: { createdAt: 'asc' } },
      teams: { include: { members: { include: { user: { select: { id: true, fullName: true } } } } } },
    },
  });
  const isLead = me.orgRole === 'LEAD' && me.membershipStatus === 'APPROVED';
  return {
    ...shapeOrg(org),
    myRole: me.orgRole,
    myMembershipStatus: me.membershipStatus,
    isLead,
    // Only an approved lead sees the member list with contact details.
    members: isLead ? org.members : undefined,
    pendingMembers: isLead ? org.members.filter((m) => m.membershipStatus === 'PENDING').length : undefined,
    teams: org.teams.map((t) => ({ id: t.id, name: t.name, availability: t.availability, members: t.members.map((m) => m.user) })),
  };
}

export async function listOrganizations(q) {
  const where = q.status ? { status: q.status } : {};
  const [items, total] = await Promise.all([
    prisma.organization.findMany({
      where,
      include: { members: { where: { orgRole: 'LEAD' }, select: { id: true, fullName: true, email: true, phone: true } }, _count: { select: { members: true, teams: true } } },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.organization.count({ where }),
  ]);
  return {
    items: items.map((o) => ({ ...shapeOrg(o), leads: o.members, memberCount: o._count.members, teamCount: o._count.teams })),
    meta: pageMeta(q, total),
  };
}

async function uniqueTeamName(tx, base) {
  let name = base.slice(0, 70);
  for (let i = 2; await tx.responseTeam.findUnique({ where: { name } }); i += 1) name = `${base.slice(0, 66)} (${i})`;
  return name;
}

export async function approveOrganization(admin, id, { note }, req) {
  const org = await prisma.$transaction(async (tx) => {
    const { count } = await tx.organization.updateMany({
      where: { id, status: { in: ['PENDING', 'SUSPENDED'] } },
      data: { status: 'APPROVED', reviewedById: admin.id, reviewedAt: new Date(), reviewNote: note ?? null },
    });
    const current = await tx.organization.findUnique({ where: { id }, include: { teams: true } });
    if (!current) throw notFound('Organisation');
    if (count === 0) throw invalidTransition(current.status, 'APPROVED', 'Organisation');
    const leads = await tx.user.findMany({ where: { organizationId: id, orgRole: 'LEAD', isActive: true } });
    await tx.user.updateMany({ where: { id: { in: leads.map((l) => l.id) } }, data: { role: Roles.RESPONSE_TEAM, membershipStatus: 'APPROVED' } });
    let team = current.teams[0];
    if (!team) team = await tx.responseTeam.create({ data: { name: await uniqueTeamName(tx, current.name), organizationId: id } });
    for (const l of leads) {
      await tx.teamMember.upsert({
        where: { teamId_userId: { teamId: team.id, userId: l.id } },
        update: {},
        create: { teamId: team.id, userId: l.id, roleInTeam: 'Organisation lead' },
      });
    }
    await audit(tx, { actor: admin, action: 'ORGANIZATION_APPROVED', entityType: 'Organization', entityId: id, after: { note, teamId: team.id, leads: leads.map((l) => l.id) }, req });
    return { ...current, leads };
  });
  await notifyUsers(
    org.leads.map((l) => l.id),
    { type: 'ORGANIZATION_APPROVED', title: `${org.name} is approved`, body: 'You can now see open needs, offer to deliver and invite your members with a join code.', data: { organizationId: id } },
  );
  return getOrganization(id);
}

export async function rejectOrganization(admin, id, { reason }, req) {
  const org = await prisma.$transaction(async (tx) => {
    const { count } = await tx.organization.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'REJECTED', reviewedById: admin.id, reviewedAt: new Date(), reviewNote: reason },
    });
    const current = await tx.organization.findUnique({ where: { id } });
    if (!current) throw notFound('Organisation');
    if (count === 0) throw invalidTransition(current.status, 'REJECTED', 'Organisation');
    await tx.user.updateMany({ where: { organizationId: id, membershipStatus: 'PENDING' }, data: { membershipStatus: 'REJECTED' } });
    await audit(tx, { actor: admin, action: 'ORGANIZATION_REJECTED', entityType: 'Organization', entityId: id, after: { reason }, req });
    return current;
  });
  const leads = await prisma.user.findMany({ where: { organizationId: id, orgRole: 'LEAD' }, select: { id: true } });
  await notifyUsers(
    leads.map((l) => l.id),
    { type: 'ORGANIZATION_REJECTED', title: `${org.name} was not approved`, body: reason, data: { organizationId: id } },
  );
  return getOrganization(id);
}

export async function getOrganization(id) {
  const o = await prisma.organization.findUnique({
    where: { id },
    include: { members: { where: { orgRole: 'LEAD' }, select: { id: true, fullName: true, email: true, phone: true } }, _count: { select: { members: true, teams: true } } },
  });
  if (!o) throw notFound('Organisation');
  return { ...shapeOrg(o), leads: o.members, memberCount: o._count.members, teamCount: o._count.teams };
}

async function requireApprovedLead(user) {
  const me = await prisma.user.findUnique({ where: { id: user.id }, include: { organization: true } });
  if (!me?.organization || me.orgRole !== 'LEAD' || me.membershipStatus !== 'APPROVED') {
    throw forbidden('Only the approved lead of an organisation can do this');
  }
  if (me.organization.status !== 'APPROVED') throw forbidden('Your organisation is not approved');
  return me;
}

// Returns the raw code once; only its hash is stored. Generating a new code invalidates the previous one.
export async function rotateJoinCode(user, req) {
  const me = await requireApprovedLead(user);
  const code = newJoinCode();
  await prisma.organization.update({ where: { id: me.organizationId }, data: { joinCodeHash: sha256(code) } });
  await audit(null, { actor: user, action: 'ORGANIZATION_JOIN_CODE_ROTATED', entityType: 'Organization', entityId: me.organizationId, req });
  return { joinCode: code };
}

export async function decideMember(user, memberId, decision, req) {
  const me = await requireApprovedLead(user);
  if (memberId === user.id) throw badRequest('You cannot change your own membership');
  const result = await prisma.$transaction(async (tx) => {
    const member = await tx.user.findFirst({ where: { id: memberId, organizationId: me.organizationId, orgRole: 'MEMBER' } });
    if (!member) throw notFound('Member');
    const to = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const { count } = await tx.user.updateMany({
      where: { id: memberId, membershipStatus: 'PENDING' },
      data: { membershipStatus: to, ...(to === 'APPROVED' ? { role: Roles.RESPONSE_TEAM } : {}) },
    });
    if (count === 0) throw invalidTransition(member.membershipStatus, to, 'Membership');
    if (to === 'APPROVED') {
      const team = await tx.responseTeam.findFirst({ where: { organizationId: me.organizationId }, orderBy: { createdAt: 'asc' } });
      if (team) {
        await tx.teamMember.upsert({ where: { teamId_userId: { teamId: team.id, userId: memberId } }, update: {}, create: { teamId: team.id, userId: memberId, roleInTeam: 'Member' } });
      }
    }
    await audit(tx, {
      actor: user,
      action: to === 'APPROVED' ? 'ORGANIZATION_MEMBER_APPROVED' : 'ORGANIZATION_MEMBER_REJECTED',
      entityType: 'User',
      entityId: memberId,
      before: { role: member.role, membershipStatus: member.membershipStatus },
      after: { membershipStatus: to },
      req,
    });
    return { member, to };
  });
  await notifyUsers([memberId], {
    type: result.to === 'APPROVED' ? 'MEMBERSHIP_APPROVED' : 'MEMBERSHIP_REJECTED',
    title: result.to === 'APPROVED' ? `You are now a responder with ${me.organization.name}` : `Your request to join ${me.organization.name} was declined`,
    body: result.to === 'APPROVED' ? 'Sign out and in again if your new screens do not appear.' : 'Contact the organisation lead if you think this is a mistake.',
  });
  return getMyOrganization(user);
}
