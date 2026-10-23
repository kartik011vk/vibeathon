export const Roles = Object.freeze({
  CITIZEN: 'CITIZEN',
  CAMP_MANAGER: 'CAMP_MANAGER',
  RELIEF_COORDINATOR: 'RELIEF_COORDINATOR',
  INVENTORY_MANAGER: 'INVENTORY_MANAGER',
  RESPONSE_TEAM: 'RESPONSE_TEAM',
  ADMIN: 'ADMIN',
});

export const ALL_ROLES = Object.values(Roles);
export const STAFF_ROLES = ALL_ROLES.filter((r) => r !== Roles.CITIZEN);
export const COORDINATION_ROLES = [Roles.RELIEF_COORDINATOR, Roles.ADMIN];

export const SEVERITY_ORDER = ['NORMAL', 'HIGH', 'RED', 'HYPER_RED'];
export const severityRank = (s) => SEVERITY_ORDER.indexOf(s);
export const maxSeverity = (...levels) =>
  levels.filter(Boolean).reduce((a, b) => (severityRank(b) > severityRank(a) ? b : a), 'NORMAL');

export const SEVERITY_LABELS = Object.freeze({
  NORMAL: 'Routine',
  HIGH: 'High attention',
  RED: 'Critical',
  HYPER_RED: 'Highest priority',
});

// Plain-language request states shown to requesters. These describe the backend state; they add no new states.
export const REQUEST_STATUS_LABELS = Object.freeze({
  SUBMITTED: 'Request received — waiting to be checked',
  VERIFIED: 'Checked — supplies being arranged',
  REJECTED: 'Not approved',
  ALLOCATED: 'Supplies reserved for your request',
  DISPATCHED: 'A response team has been assigned',
  PARTIALLY_DELIVERED: 'Partly delivered',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
});

export const DISPATCH_STATUS_LABELS = Object.freeze({
  CREATED: 'Dispatch created',
  ASSIGNED: 'A response team has been assigned',
  ACCEPTED: 'Team has accepted the delivery',
  IN_TRANSIT: 'Delivery in progress',
  PARTIALLY_DELIVERED: 'Partly delivered',
  DELIVERED: 'Delivered',
  FAILED: 'Delivery could not be completed',
  CANCELLED: 'Dispatch cancelled',
});

export const OPEN_REQUEST_STATUSES = ['SUBMITTED', 'VERIFIED', 'ALLOCATED', 'DISPATCHED', 'PARTIALLY_DELIVERED'];
export const ACTIVE_DISPATCH_STATUSES = ['CREATED', 'ASSIGNED', 'ACCEPTED', 'IN_TRANSIT', 'PARTIALLY_DELIVERED'];
