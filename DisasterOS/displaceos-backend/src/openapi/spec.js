// OpenAPI 3.0 document. Request schemas are generated from the same Zod validators the routes use,
// so documented input rules cannot drift from enforced ones.
import { zodToJsonSchema } from 'zod-to-json-schema';
import * as authV from '../validators/auth.validators.js';
import * as reqV from '../validators/request.validators.js';
import * as v from '../validators/ops.validators.js';
import { reasonBody } from '../validators/common.js';
import * as rv from '../validators/responder.validators.js';

const js = (schema) => {
  const { $schema, ...rest } = zodToJsonSchema(schema, { target: 'openApi3', $refStrategy: 'none' });
  return rest;
};

// Turns a Zod object (query) schema into OpenAPI query parameters.
function queryParams(schema) {
  const s = js(schema);
  const props = s.properties ?? s.allOf?.[0]?.properties ?? {};
  return Object.entries(props).map(([name, p]) => ({ name, in: 'query', required: false, schema: p }));
}

const pathParam = (name) => ({ name, in: 'path', required: true, schema: { type: 'string', format: 'uuid' } });

const ROLE_NOTE = (roles) => (roles ? `\n\n**Roles:** ${roles.join(', ')}` : '');

const errorRef = (description) => ({ description, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } });
const okResponse = (description = 'Success') => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Success' } } },
});

function op({ summary, tag, auth = true, roles, body, query, params = [], status = 200, description = '', errors = [] }) {
  const o = {
    tags: [tag],
    summary,
    description: description + ROLE_NOTE(roles),
    parameters: [...params.map(pathParam), ...(query ? queryParams(query) : [])],
    responses: {
      [status]: okResponse(status === 201 ? 'Created' : 'Success'),
      400: errorRef('VALIDATION_ERROR'),
      ...(auth ? { 401: errorRef('UNAUTHORIZED'), 403: errorRef('FORBIDDEN') } : {}),
      ...Object.fromEntries(errors.map(([code, d]) => [code, errorRef(d)])),
      429: errorRef('RATE_LIMITED'),
      500: errorRef('INTERNAL_ERROR'),
    },
  };
  if (auth) o.security = [{ bearerAuth: [] }];
  if (body) o.requestBody = { required: true, content: { 'application/json': { schema: js(body) } } };
  return o;
}

const COORD = ['RELIEF_COORDINATOR', 'ADMIN'];
const NF = [404, 'NOT_FOUND'];
const ST = [409, 'INVALID_STATE_TRANSITION / CONFLICT'];
const STOCK = [409, 'INSUFFICIENT_STOCK / CONFLICT'];

const paths = {
  '/health': { get: op({ summary: 'Service health (no secrets)', tag: 'Health', auth: false }) },

  '/auth/register': { post: op({ summary: 'Register a citizen account', tag: 'Auth', auth: false, body: authV.registerBody, status: 201, description: 'Always creates a CITIZEN. Any role field is ignored. Refresh token is set as an httpOnly cookie (`dos_refresh`).', errors: [[409, 'CONFLICT (email exists)']] }) },
  '/auth/login': { post: op({ summary: 'Log in', tag: 'Auth', auth: false, body: authV.loginBody, description: 'Returns a short-lived access token. Refresh token is an httpOnly cookie, or in the body when `tokenDelivery` is `body`.' }) },
  '/auth/refresh': { post: op({ summary: 'Rotate refresh token and get a new access token', tag: 'Auth', auth: false, body: authV.refreshBody, description: 'Reads the refresh cookie (or body token). Reusing a rotated token revokes the whole session family.' }) },
  '/auth/logout': { post: op({ summary: 'Revoke the current session family', tag: 'Auth', auth: false }) },
  '/auth/me': { get: op({ summary: 'Current user with assigned locations and teams', tag: 'Auth' }) },
  '/users/me': { patch: op({ summary: 'Update own profile', tag: 'Users', body: authV.updateMeBody }) },
  '/users': { get: op({ summary: 'List users (paginated)', tag: 'Users', roles: COORD, query: authV.listUsersQuery, description: 'Coordinators only see staff accounts.' }) },
  '/users/{userId}/role': { patch: op({ summary: 'Change role, scope and active flag (audited)', tag: 'Users', roles: ['ADMIN'], params: ['userId'], body: authV.changeRoleBody, errors: [NF] }) },

  '/requests': {
    post: op({ summary: 'Create a relief request', tag: 'Requests', roles: ['CITIZEN', 'CAMP_MANAGER', ...COORD], body: reqV.createRequestBody, status: 201, description: 'Severity is suggested by server rules; clients cannot set it.' }),
    get: op({ summary: 'List requests in your scope', tag: 'Requests', query: reqV.listRequestsQuery }),
  },
  '/requests/nearby': { get: op({ summary: 'Requests near a point (straight-line distance)', tag: 'Requests', roles: ['staff roles'], query: reqV.nearbyQuery }) },
  '/requests/{requestId}': {
    get: op({ summary: 'Request detail', tag: 'Requests', params: ['requestId'], errors: [NF], description: 'Out-of-scope requests return 404.' }),
    patch: op({ summary: 'Update permitted fields', tag: 'Requests', params: ['requestId'], body: reqV.updateRequestBody, errors: [NF, ST] }),
  },
  '/requests/{requestId}/cancel': { post: op({ summary: 'Cancel with reason', tag: 'Requests', params: ['requestId'], body: reasonBody, errors: [NF, ST] }) },
  '/requests/{requestId}/verify': { post: op({ summary: 'Verify or reject (optional severity override by coordinator)', tag: 'Requests', roles: [...COORD, 'CAMP_MANAGER'], params: ['requestId'], body: reqV.verifyBody, errors: [NF, ST] }) },
  '/requests/{requestId}/escalate': { post: op({ summary: 'Apply (coordinator) or request (requester/camp manager) escalation', tag: 'Requests', params: ['requestId'], body: reqV.escalateBody, errors: [NF, ST], description: '`meta.escalationApplied` tells whether severity changed.' }) },
  '/requests/{requestId}/timeline': { get: op({ summary: 'Append-only timeline (requesters see public events only)', tag: 'Requests', params: ['requestId'], errors: [NF] }) },
  '/requests/{requestId}/tracking': { get: op({ summary: 'Tracking: state, delivered/remaining, dispatches, ETA, timeline', tag: 'Tracking', params: ['requestId'], errors: [NF] }) },
  '/requests/{requestId}/tracking-tokens': {
    post: op({ summary: 'Create a public tracking link (token returned once)', tag: 'Tracking', params: ['requestId'], body: reqV.trackingTokenBody, status: 201 }),
    get: op({ summary: 'List tracking links (metadata only)', tag: 'Tracking', params: ['requestId'] }),
  },
  '/requests/{requestId}/tracking-tokens/{tokenId}/revoke': { post: op({ summary: 'Revoke a tracking link', tag: 'Tracking', params: ['requestId', 'tokenId'], errors: [NF] }) },
  '/tracking/{token}': { get: { ...op({ summary: 'Public minimal tracking by link token', tag: 'Tracking', auth: false, errors: [NF] }), parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }] } },

  '/alerts': {
    post: op({ summary: 'Create an alert', tag: 'Alerts', roles: COORD, body: v.createAlertBody, status: 201 }),
    get: op({ summary: 'List alerts', tag: 'Alerts', roles: ['staff roles'], query: v.listAlertsQuery }),
  },
  '/alerts/active': { get: op({ summary: 'Open alerts (public sees zone-level alerts only)', tag: 'Alerts', auth: false, description: 'Optional bearer token widens the scope for staff.' }) },
  '/alerts/summary': { get: op({ summary: 'Open alerts by severity and status', tag: 'Alerts', roles: ['staff roles'] }) },
  '/alerts/{alertId}': { get: op({ summary: 'Alert detail', tag: 'Alerts', roles: ['staff roles'], params: ['alertId'], errors: [NF] }) },
  '/alerts/{alertId}/acknowledge': { post: op({ summary: 'Acknowledge', tag: 'Alerts', roles: [...COORD, 'CAMP_MANAGER'], params: ['alertId'], body: v.ackBody, errors: [NF, ST] }) },
  '/alerts/{alertId}/escalate': { post: op({ summary: 'Raise severity with reason', tag: 'Alerts', roles: COORD, params: ['alertId'], body: v.alertEscalateBody, errors: [NF, ST] }) },
  '/alerts/{alertId}/resolve': { post: op({ summary: 'Resolve with note', tag: 'Alerts', roles: COORD, params: ['alertId'], body: v.resolveBody, errors: [NF, ST] }) },

  '/inventory': { get: op({ summary: 'Item catalogue (staff also get balances)', tag: 'Inventory', auth: false, query: v.listItemsQuery }) },
  '/inventory/items': { post: op({ summary: 'Create catalogue item', tag: 'Inventory', roles: ['INVENTORY_MANAGER', 'ADMIN'], body: v.createItemBody, status: 201 }) },
  '/inventory/{itemId}': {
    get: op({ summary: 'Item detail', tag: 'Inventory', params: ['itemId'], errors: [NF] }),
    patch: op({ summary: 'Update item', tag: 'Inventory', roles: ['INVENTORY_MANAGER', 'ADMIN'], params: ['itemId'], body: v.updateItemBody, errors: [NF] }),
  },
  '/inventory/transactions': {
    post: op({ summary: 'Record RECEIPT / ADJUSTMENT / CONSUMPTION at an assigned location', tag: 'Inventory', roles: ['INVENTORY_MANAGER', 'ADMIN'], body: v.transactionBody, status: 201, errors: [STOCK], description: 'RESERVATION and RELEASE are produced by the allocation and dispatch workflows.' }),
    get: op({ summary: 'Transaction ledger', tag: 'Inventory', roles: ['INVENTORY_MANAGER', ...COORD], query: v.listTransactionsQuery }),
  },
  '/inventory/low-stock': { get: op({ summary: 'Balances at or below threshold', tag: 'Inventory', roles: ['INVENTORY_MANAGER', ...COORD] }) },
  '/inventory/locations': { get: op({ summary: 'Stock locations with totals', tag: 'Inventory', roles: ['staff roles'] }) },
  '/inventory/availability': { get: op({ summary: 'Public availability with freshness status and straight-line distance', tag: 'Inventory', auth: false, query: v.availabilityQuery, description: 'availabilityStatus: AVAILABLE | LIMITED | NOT_AVAILABLE | NOT_CONFIRMED (stale or never counted).' }) },

  '/allocations': {
    post: op({ summary: 'Propose an allocation', tag: 'Allocations', roles: COORD, body: v.createAllocationBody, status: 201, errors: [ST] }),
    get: op({ summary: 'List allocations', tag: 'Allocations', roles: [...COORD, 'INVENTORY_MANAGER', 'CAMP_MANAGER'], query: v.listAllocationsQuery }),
  },
  '/allocations/suggestions': { get: op({ summary: 'Explainable rule-based sourcing suggestions', tag: 'Allocations', roles: [...COORD, 'INVENTORY_MANAGER'], query: v.suggestionsQuery }) },
  '/allocations/{allocationId}': { get: op({ summary: 'Allocation detail', tag: 'Allocations', params: ['allocationId'], errors: [NF] }) },
  '/allocations/{allocationId}/approve': { post: op({ summary: 'Approve and atomically reserve stock', tag: 'Allocations', roles: [...COORD, 'INVENTORY_MANAGER (source location)'], params: ['allocationId'], errors: [NF, STOCK] }) },
  '/allocations/{allocationId}/reject': { post: op({ summary: 'Reject a proposal', tag: 'Allocations', params: ['allocationId'], body: reasonBody, errors: [NF, ST] }) },
  '/allocations/{allocationId}/release': { post: op({ summary: 'Release reserved stock', tag: 'Allocations', params: ['allocationId'], body: reasonBody, errors: [NF, ST] }) },

  '/teams': {
    post: op({ summary: 'Create response team', tag: 'Teams', roles: COORD, body: v.createTeamBody, status: 201 }),
    get: op({ summary: 'List teams (exact location for coordinators/own team only)', tag: 'Teams', roles: ['staff roles'], query: v.listTeamsQuery }),
  },
  '/teams/{teamId}': { get: op({ summary: 'Team detail', tag: 'Teams', params: ['teamId'], errors: [NF] }) },
  '/teams/{teamId}/availability': { patch: op({ summary: 'Set availability', tag: 'Teams', roles: ['RESPONSE_TEAM (own team)', ...COORD], params: ['teamId'], body: v.availabilityBody }) },
  '/teams/{teamId}/location': { patch: op({ summary: 'Report team position', tag: 'Teams', roles: ['RESPONSE_TEAM (own team)', ...COORD], params: ['teamId'], body: v.coordsBody }) },

  '/dispatches': {
    post: op({ summary: 'Create dispatch from an APPROVED allocation and assign a team', tag: 'Dispatch', roles: COORD, body: v.createDispatchBody, status: 201, errors: [ST] }),
    get: op({ summary: 'List dispatches in scope', tag: 'Dispatch', query: v.listDispatchesQuery }),
  },
  '/dispatches/{dispatchId}': { get: op({ summary: 'Dispatch detail', tag: 'Dispatch', params: ['dispatchId'], errors: [NF] }) },
  '/dispatches/{dispatchId}/accept': { post: op({ summary: 'ASSIGNED → ACCEPTED', tag: 'Dispatch', roles: ['RESPONSE_TEAM (assigned)'], params: ['dispatchId'], errors: [NF, ST] }) },
  '/dispatches/{dispatchId}/start': { post: op({ summary: 'ACCEPTED → IN_TRANSIT', tag: 'Dispatch', roles: ['RESPONSE_TEAM (assigned)', ...COORD], params: ['dispatchId'], errors: [NF, ST] }) },
  '/dispatches/{dispatchId}/complete': { post: op({ summary: 'Record partial or full delivery; final=true closes the run', tag: 'Dispatch', roles: ['RESPONSE_TEAM (assigned)', ...COORD], params: ['dispatchId'], body: v.completeBody, errors: [NF, ST, STOCK] }) },
  '/dispatches/{dispatchId}/fail': { post: op({ summary: 'Mark failed and release remaining stock', tag: 'Dispatch', roles: ['RESPONSE_TEAM (assigned)', ...COORD], params: ['dispatchId'], body: v.failBody, errors: [NF, ST] }) },
  '/dispatches/{dispatchId}/cancel': { post: op({ summary: 'Cancel before transit (reservation kept for re-dispatch)', tag: 'Dispatch', roles: COORD, params: ['dispatchId'], body: v.failBody, errors: [NF, ST] }) },
  '/dispatches/{dispatchId}/tracking': { get: op({ summary: 'Dispatch tracking with ETA history and delivery events', tag: 'Tracking', params: ['dispatchId'], errors: [NF] }) },
  '/dispatches/{dispatchId}/location': { patch: op({ summary: 'Team reports current position', tag: 'Tracking', roles: ['RESPONSE_TEAM (assigned)'], params: ['dispatchId'], body: v.coordsBody, errors: [NF, ST] }) },
  '/dispatches/{dispatchId}/eta': { post: op({ summary: 'Manual ETA (or eta:null for "unavailable") with reason; history is append-only', tag: 'Tracking', roles: ['RESPONSE_TEAM (assigned)', ...COORD], params: ['dispatchId'], body: v.etaBody, errors: [NF, ST] }) },

  '/notifications': { get: op({ summary: 'Own in-app notifications', tag: 'Notifications', query: v.listNotificationsQuery }) },
  '/notifications/{notificationId}/read': { post: op({ summary: 'Mark as read', tag: 'Notifications', params: ['notificationId'], errors: [NF] }) },
  '/notification-preferences': {
    get: op({ summary: 'Own preferences', tag: 'Notifications' }),
    patch: op({ summary: 'Update preferences', tag: 'Notifications', body: v.preferencesBody }),
  },
  '/escalation-rules': {
    get: op({ summary: 'Built-in and custom severity rules', tag: 'Alerts', roles: COORD }),
    post: op({ summary: 'Create custom rule', tag: 'Alerts', roles: COORD, body: v.createRuleBody, status: 201 }),
  },
  '/escalation-rules/{ruleId}': { patch: op({ summary: 'Update custom rule', tag: 'Alerts', roles: COORD, params: ['ruleId'], body: v.updateRuleBody, errors: [NF] }) },

  '/locations': {
    get: op({ summary: 'Active public locations', tag: 'Locations', auth: false, query: v.listLocationsQuery }),
    post: op({ summary: 'Create location', tag: 'Locations', roles: ['ADMIN'], body: v.createLocationBody, status: 201 }),
  },
  '/locations/{locationId}': { get: op({ summary: 'Location detail', tag: 'Locations', auth: false, params: ['locationId'], errors: [NF] }) },
  '/disaster-zones': {
    get: op({ summary: 'Disaster zones with source and verification flag', tag: 'Locations', auth: false, query: v.listZonesQuery }),
    post: op({ summary: 'Create zone', tag: 'Locations', roles: COORD, body: v.createZoneBody, status: 201 }),
  },
  '/disaster-zones/{zoneId}': {
    get: op({ summary: 'Zone detail with public alerts', tag: 'Locations', auth: false, params: ['zoneId'], errors: [NF] }),
    patch: op({ summary: 'Update zone', tag: 'Locations', roles: COORD, params: ['zoneId'], body: v.updateZoneBody, errors: [NF] }),
  },
  '/map/resources': { get: op({ summary: 'Map-ready resource points with supply availability', tag: 'Map', auth: false, query: v.mapResourcesQuery }) },
  '/map/requests': { get: op({ summary: 'Map-ready requests in your scope', tag: 'Map', query: v.mapRequestsQuery }) },
  '/map/teams': { get: op({ summary: 'Team positions (coordinators; teams see their own)', tag: 'Map', roles: ['RESPONSE_TEAM', ...COORD] }) },
  '/routes/estimate': { get: op({ summary: 'Road route estimate — returns available:false when no routing provider is configured', tag: 'Map', query: v.routeEstimateQuery }) },

  '/dashboard/summary': { get: op({ summary: 'Operational counts from the database', tag: 'Dashboard', roles: COORD }) },
  '/dashboard/critical-needs': { get: op({ summary: 'Open HIGH/RED/HYPER_RED requests', tag: 'Dashboard', roles: [...COORD, 'CAMP_MANAGER'] }) },
  '/dashboard/resource-distribution': { get: op({ summary: 'Stock and delivery totals by category and location', tag: 'Dashboard', roles: [...COORD, 'INVENTORY_MANAGER'] }) },
  '/dashboard/response-times': { get: op({ summary: 'Average/median stage durations', tag: 'Dashboard', roles: COORD, query: v.responseTimesQuery }) },
  '/organizations/register': { post: op({ summary: 'Register a responder organisation (pending until an admin approves)', tag: 'Responders', auth: false, body: rv.registerOrgBody, status: 201, description: 'Creates the organisation and its lead account. The lead has no responder powers until approval.' }) },
  '/organizations/join': { post: op({ summary: 'Join an approved organisation with its join code (membership pending)', tag: 'Responders', auth: false, body: rv.joinOrgBody, status: 201, errors: [NF] }) },
  '/organizations/mine': { get: op({ summary: 'Your organisation, status, teams (and members if you are the lead)', tag: 'Responders', errors: [NF] }) },
  '/organizations/mine/join-code': { post: op({ summary: 'Generate a new join code (shown once; replaces the old one)', tag: 'Responders', roles: ['approved organisation lead'] }) },
  '/organizations/mine/members/{userId}/decision': { post: op({ summary: 'Approve or reject a pending member', tag: 'Responders', roles: ['approved organisation lead'], params: ['userId'], body: rv.memberDecisionBody, errors: [NF, ST] }) },
  '/organizations': { get: op({ summary: 'List organisations', tag: 'Responders', roles: COORD, query: rv.listOrgsQuery }) },
  '/organizations/{organizationId}': { get: op({ summary: 'Organisation detail', tag: 'Responders', roles: COORD, params: ['organizationId'], errors: [NF] }) },
  '/organizations/{organizationId}/approve': { post: op({ summary: 'Approve: leads become RESPONSE_TEAM and a team is created', tag: 'Responders', roles: ['ADMIN'], params: ['organizationId'], body: rv.approveOrgBody, errors: [NF, ST] }) },
  '/organizations/{organizationId}/reject': { post: op({ summary: 'Reject a pending organisation', tag: 'Responders', roles: ['ADMIN'], params: ['organizationId'], body: rv.supplyReasonBody, errors: [NF, ST] }) },
  '/requests/open-needs': { get: op({ summary: 'Verified requests that still need a delivery (no requester identity; ~1 km location)', tag: 'Responders', roles: ['RESPONSE_TEAM', ...COORD], query: rv.openNeedsQuery }) },
  '/requests/{requestId}/offers': {
    post: op({ summary: 'Offer to deliver a request on behalf of your team', tag: 'Responders', roles: ['RESPONSE_TEAM'], params: ['requestId'], body: rv.createOfferBody, status: 201, errors: [NF, [409, 'CONFLICT (already offered)']] }),
    get: op({ summary: 'Offers on a request (teams see their own)', tag: 'Responders', roles: ['RESPONSE_TEAM', ...COORD], params: ['requestId'] }),
  },
  '/requests/{requestId}/offers/{offerId}/withdraw': { post: op({ summary: 'Withdraw your team offer', tag: 'Responders', roles: ['RESPONSE_TEAM'], params: ['requestId', 'offerId'], errors: [NF, ST] }) },
  '/supply-offers': {
    post: op({ summary: 'Offer supplies as a donor', tag: 'Donations', body: rv.createSupplyBody, status: 201 }),
    get: op({ summary: 'Your offers (staff: all offers)', tag: 'Donations', query: rv.listSupplyQuery }),
  },
  '/supply-offers/{offerId}': { get: op({ summary: 'Offer detail with history and impact after arrival', tag: 'Donations', params: ['offerId'], errors: [NF] }) },
  '/supply-offers/{offerId}/accept': { post: op({ summary: 'Accept and choose the receiving stock location', tag: 'Donations', roles: [...COORD, 'INVENTORY_MANAGER'], params: ['offerId'], body: rv.acceptSupplyBody, errors: [NF, ST] }) },
  '/supply-offers/{offerId}/receive': { post: op({ summary: 'Record counted quantities as stock receipts', tag: 'Donations', roles: ['INVENTORY_MANAGER (receiving location)', 'ADMIN'], params: ['offerId'], body: rv.receiveSupplyBody, errors: [NF, ST] }) },
  '/supply-offers/{offerId}/reject': { post: op({ summary: 'Decline an offer', tag: 'Donations', roles: [...COORD, 'INVENTORY_MANAGER'], params: ['offerId'], body: rv.supplyReasonBody, errors: [NF, ST] }) },
  '/supply-offers/{offerId}/cancel': { post: op({ summary: 'Withdraw your own offer', tag: 'Donations', params: ['offerId'], body: rv.supplyReasonBody, errors: [NF, ST] }) },
  '/sos': { post: op({ summary: 'Send an emergency rescue SOS (broadcast to every open screen)', tag: 'Emergency', body: rv.raiseSosBody, status: 201, errors: [[409, 'CONFLICT (you already have an active SOS)']] }) },
  '/sos/active': { get: op({ summary: 'Open SOS calls. Public: area only. Responders and staff: exact position, message, contact', tag: 'Emergency', auth: false }) },
  '/sos/mine': { get: op({ summary: 'Your own SOS calls', tag: 'Emergency' }) },
  '/sos/{sosId}': { get: op({ summary: 'SOS detail with history', tag: 'Emergency', params: ['sosId'], errors: [NF] }) },
  '/sos/{sosId}/location': { patch: op({ summary: 'The person who sent the SOS updates their position', tag: 'Emergency', params: ['sosId'], body: rv.sosLocationBody, errors: [NF, ST] }) },
  '/sos/{sosId}/respond': { post: op({ summary: 'Take the SOS (one responder at a time)', tag: 'Emergency', roles: ['RESPONSE_TEAM', 'CAMP_MANAGER', ...COORD], params: ['sosId'], errors: [NF, [409, 'CONFLICT (already being handled)']] }) },
  '/sos/{sosId}/resolve': { post: op({ summary: 'Close as rescued, not found or false alarm; responder position is checked against the SOS location', tag: 'Emergency', roles: ['responding user', ...COORD], params: ['sosId'], body: rv.resolveSosBody, errors: [NF, ST] }) },
  '/sos/{sosId}/cancel': { post: op({ summary: 'The person reports they are safe (or a coordinator closes it)', tag: 'Emergency', params: ['sosId'], body: rv.supplyReasonBody, errors: [NF, ST] }) },
  '/requests/{requestId}/confirm-receipt': { post: op({ summary: 'Requester confirms the supplies were received', tag: 'Tracking', roles: ['requester'], params: ['requestId'], body: rv.confirmReceiptBody, errors: [NF, ST] }) },
  '/audit-logs': { get: op({ summary: 'Audit log', tag: 'Audit', roles: ['ADMIN'], query: v.auditQuery }) },
};

export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'DisplaceOS API',
    version: '1.0.0',
    description:
      'Disaster-relief coordination API. All responses use `{ success, data, meta }` or `{ success:false, error:{code,message,details}, requestId }`.\n\n' +
      'Real-time: Socket.IO on the same origin, `auth: { token }`. Events: request:created, request:updated, request:verified, alert:created, alert:updated, allocation:updated, ' +
      'dispatch:assigned, dispatch:started, dispatch:updated, dispatch:location_updated, dispatch:eta_updated, dispatch:delayed, dispatch:partially_delivered, dispatch:completed, ' +
      'notification:created, inventory:updated, team:updated, zone:updated. Clients call `subscribe` with `{type:"request"|"dispatch", id}` to watch a record; the server checks scope.',
  },
  servers: [{ url: '/api/v1' }],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: {
      Success: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: {},
          meta: { type: 'object', description: 'Pagination: page, pageSize, total, totalPages' },
        },
      },
      Error: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: {
            type: 'object',
            properties: {
              code: {
                type: 'string',
                enum: ['VALIDATION_ERROR', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'INVALID_STATE_TRANSITION', 'INSUFFICIENT_STOCK', 'RATE_LIMITED', 'PAYLOAD_TOO_LARGE', 'NOT_CONFIGURED', 'INTERNAL_ERROR'],
              },
              message: { type: 'string' },
              details: { type: 'array', items: { type: 'object' } },
            },
          },
          requestId: { type: 'string' },
        },
      },
    },
  },
  paths,
};
