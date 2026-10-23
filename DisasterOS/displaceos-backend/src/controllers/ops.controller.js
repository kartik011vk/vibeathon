// Controllers for alerts, inventory, allocations, teams, dispatches and tracking.
import * as alerts from '../services/alert.service.js';
import * as inventory from '../services/inventory.service.js';
import * as allocations from '../services/allocation.service.js';
import * as teams from '../services/team.service.js';
import * as dispatches from '../services/dispatch.service.js';
import { publicTracking } from '../services/tracking.service.js';
import { created, ok } from '../utils/respond.js';

const p = (req, name) => req.valid.params[name];
const paged = (fn) => async (req, res) => {
  const { items, meta } = await fn(req);
  ok(res, items, meta);
};

export const alertsCtl = {
  create: async (req, res) => created(res, await alerts.createAlert(req.user, req.valid.body, req)),
  list: paged((req) => alerts.listAlerts(req.valid.query)),
  active: async (req, res) => {
    const { items, scope } = await alerts.activeAlerts(req.user);
    ok(res, items, { scope, count: items.length });
  },
  summary: async (req, res) => ok(res, await alerts.summary()),
  get: async (req, res) => ok(res, await alerts.getAlert(p(req, 'alertId'))),
  acknowledge: async (req, res) => ok(res, await alerts.acknowledge(req.user, p(req, 'alertId'), req.valid.body.note, req)),
  escalate: async (req, res) => ok(res, await alerts.escalate(req.user, p(req, 'alertId'), req.valid.body, req)),
  resolve: async (req, res) => ok(res, await alerts.resolve(req.user, p(req, 'alertId'), req.valid.body, req)),
};

export const inventoryCtl = {
  createItem: async (req, res) => created(res, await inventory.createItem(req.user, req.valid.body, req)),
  list: paged((req) => inventory.listItems(req.user, req.valid.query)),
  get: async (req, res) => ok(res, await inventory.getItem(req.user, p(req, 'itemId'))),
  update: async (req, res) => ok(res, await inventory.updateItem(req.user, p(req, 'itemId'), req.valid.body, req)),
  transaction: async (req, res) => created(res, await inventory.recordTransaction(req.user, req.valid.body, req)),
  transactions: paged((req) => inventory.listTransactions(req.user, req.valid.query)),
  lowStock: async (req, res) => {
    const items = await inventory.lowStock(req.user);
    ok(res, items, { count: items.length });
  },
  locations: async (req, res) => ok(res, await inventory.stockLocations(req.user)),
  availability: async (req, res) => {
    const { items, meta } = await inventory.availability(req.valid.query);
    ok(res, items, meta);
  },
};

export const allocationsCtl = {
  create: async (req, res) => created(res, await allocations.createAllocation(req.user, req.valid.body, req)),
  list: paged((req) => allocations.listAllocations(req.user, req.valid.query)),
  get: async (req, res) => ok(res, await allocations.getAllocation(req.user, p(req, 'allocationId'))),
  approve: async (req, res) => ok(res, await allocations.approveAllocation(req.user, p(req, 'allocationId'), req)),
  reject: async (req, res) => ok(res, await allocations.rejectAllocation(req.user, p(req, 'allocationId'), req.valid.body.reason, req)),
  release: async (req, res) => ok(res, await allocations.releaseAllocation(req.user, p(req, 'allocationId'), req.valid.body.reason, req)),
  suggestions: async (req, res) => ok(res, await allocations.suggestions(req.user, req.valid.query.requestId)),
};

export const teamsCtl = {
  create: async (req, res) => created(res, await teams.createTeam(req.user, req.valid.body, req)),
  list: async (req, res) => ok(res, await teams.listTeams(req.user, req.valid.query)),
  get: async (req, res) => ok(res, await teams.getTeam(req.user, p(req, 'teamId'))),
  availability: async (req, res) => ok(res, await teams.setAvailability(req.user, p(req, 'teamId'), req.valid.body.availability, req)),
  location: async (req, res) => ok(res, await teams.setLocation(req.user, p(req, 'teamId'), req.valid.body, req)),
};

export const dispatchesCtl = {
  create: async (req, res) => created(res, await dispatches.createDispatch(req.user, req.valid.body, req)),
  list: paged((req) => dispatches.listDispatches(req.user, req.valid.query)),
  get: async (req, res) => ok(res, await dispatches.getDispatch(req.user, p(req, 'dispatchId'))),
  accept: async (req, res) => ok(res, await dispatches.acceptDispatch(req.user, p(req, 'dispatchId'), req)),
  start: async (req, res) => ok(res, await dispatches.startDispatch(req.user, p(req, 'dispatchId'), req)),
  complete: async (req, res) => ok(res, await dispatches.completeDispatch(req.user, p(req, 'dispatchId'), req.valid.body, req)),
  fail: async (req, res) => ok(res, await dispatches.failDispatch(req.user, p(req, 'dispatchId'), req.valid.body, req)),
  cancel: async (req, res) => ok(res, await dispatches.cancelDispatch(req.user, p(req, 'dispatchId'), req.valid.body, req)),
  tracking: async (req, res) => ok(res, await dispatches.dispatchTracking(req.user, p(req, 'dispatchId'))),
  location: async (req, res) => ok(res, await dispatches.updateLocation(req.user, p(req, 'dispatchId'), req.valid.body, req)),
  eta: async (req, res) => ok(res, await dispatches.setEta(req.user, p(req, 'dispatchId'), req.valid.body, req)),
};

export const publicTrackingCtl = async (req, res) => ok(res, await publicTracking(req.valid.params.token));
