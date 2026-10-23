// Feature service modules. Every function maps 1:1 to a route implemented in displaceos-backend
// (see docs/integration-matrix.md at the project root). No endpoint here is invented.
import { api, getData } from './client.js';

export const authApi = {
  login: (email, password) => api.post('/auth/login', { email, password }, { auth: false }).then((r) => r.data),
  register: (input) => api.post('/auth/register', input, { auth: false }).then((r) => r.data),
  logout: () => api.post('/auth/logout', {}).then((r) => r.data),
  me: () => getData('/auth/me'),
  updateMe: (input) => api.patch('/users/me', input).then((r) => r.data),
};

export const usersApi = {
  list: (q) => api.get('/users', q),
  changeRole: (userId, body) => api.patch(`/users/${userId}/role`, body).then((r) => r.data),
};

export const requestsApi = {
  create: (body) => api.post('/requests', body).then((r) => r.data),
  list: (q) => api.get('/requests', q),
  get: (id) => getData(`/requests/${id}`),
  update: (id, body) => api.patch(`/requests/${id}`, body).then((r) => r.data),
  cancel: (id, reason) => api.post(`/requests/${id}/cancel`, { reason }).then((r) => r.data),
  verify: (id, body) => api.post(`/requests/${id}/verify`, body).then((r) => r.data),
  escalate: (id, body) => api.post(`/requests/${id}/escalate`, body),
  timeline: (id) => getData(`/requests/${id}/timeline`),
  tracking: (id) => getData(`/requests/${id}/tracking`),
  nearby: (q) => api.get('/requests/nearby', q),
  createTrackingLink: (id, ttlHours) => api.post(`/requests/${id}/tracking-tokens`, ttlHours ? { ttlHours } : {}).then((r) => r.data),
  trackingLinks: (id) => getData(`/requests/${id}/tracking-tokens`),
  revokeTrackingLink: (id, tokenId) => api.post(`/requests/${id}/tracking-tokens/${tokenId}/revoke`, {}).then((r) => r.data),
};

export const trackingApi = {
  publicByToken: (token) => getData(`/tracking/${encodeURIComponent(token)}`, undefined, { auth: false }),
  dispatch: (id) => getData(`/dispatches/${id}/tracking`),
};

export const alertsApi = {
  active: () => api.get('/alerts/active'),
  list: (q) => api.get('/alerts', q),
  summary: () => getData('/alerts/summary'),
  get: (id) => getData(`/alerts/${id}`),
  create: (body) => api.post('/alerts', body).then((r) => r.data),
  acknowledge: (id, note) => api.post(`/alerts/${id}/acknowledge`, note ? { note } : {}).then((r) => r.data),
  escalate: (id, body) => api.post(`/alerts/${id}/escalate`, body).then((r) => r.data),
  resolve: (id, note) => api.post(`/alerts/${id}/resolve`, { note }).then((r) => r.data),
};

export const inventoryApi = {
  catalogue: (q) => api.get('/inventory', { pageSize: 100, ...q }),
  item: (id) => getData(`/inventory/${id}`),
  createItem: (body) => api.post('/inventory/items', body).then((r) => r.data),
  updateItem: (id, body) => api.patch(`/inventory/${id}`, body).then((r) => r.data),
  availability: (q) => api.get('/inventory/availability', q),
  locations: () => getData('/inventory/locations'),
  lowStock: () => getData('/inventory/low-stock'),
  transactions: (q) => api.get('/inventory/transactions', q),
  recordTransaction: (body) => api.post('/inventory/transactions', body).then((r) => r.data),
};

export const allocationsApi = {
  list: (q) => api.get('/allocations', q),
  get: (id) => getData(`/allocations/${id}`),
  suggestions: (requestId) => getData('/allocations/suggestions', { requestId }),
  create: (body) => api.post('/allocations', body).then((r) => r.data),
  approve: (id) => api.post(`/allocations/${id}/approve`, {}).then((r) => r.data),
  reject: (id, reason) => api.post(`/allocations/${id}/reject`, { reason }).then((r) => r.data),
  release: (id, reason) => api.post(`/allocations/${id}/release`, { reason }).then((r) => r.data),
};

export const teamsApi = {
  list: (q) => getData('/teams', q),
  get: (id) => getData(`/teams/${id}`),
  create: (body) => api.post('/teams', body).then((r) => r.data),
  setAvailability: (id, availability) => api.patch(`/teams/${id}/availability`, { availability }).then((r) => r.data),
  setLocation: (id, coords) => api.patch(`/teams/${id}/location`, coords).then((r) => r.data),
};

export const dispatchesApi = {
  list: (q) => api.get('/dispatches', q),
  get: (id) => getData(`/dispatches/${id}`),
  create: (body) => api.post('/dispatches', body).then((r) => r.data),
  accept: (id) => api.post(`/dispatches/${id}/accept`, {}).then((r) => r.data),
  start: (id) => api.post(`/dispatches/${id}/start`, {}).then((r) => r.data),
  complete: (id, body) => api.post(`/dispatches/${id}/complete`, body).then((r) => r.data),
  fail: (id, reason) => api.post(`/dispatches/${id}/fail`, { reason }).then((r) => r.data),
  cancel: (id, reason) => api.post(`/dispatches/${id}/cancel`, { reason }).then((r) => r.data),
  updateLocation: (id, coords) => api.patch(`/dispatches/${id}/location`, coords).then((r) => r.data),
  setEta: (id, body) => api.post(`/dispatches/${id}/eta`, body).then((r) => r.data),
};

export const notificationsApi = {
  list: (q) => api.get('/notifications', q),
  markRead: (id) => api.post(`/notifications/${id}/read`, {}).then((r) => r.data),
  preferences: () => getData('/notification-preferences'),
  updatePreferences: (body) => api.patch('/notification-preferences', body).then((r) => r.data),
};

export const placesApi = {
  locations: (q) => getData('/locations', q, { auth: false }),
  location: (id) => getData(`/locations/${id}`, undefined, { auth: false }),
  createLocation: (body) => api.post('/locations', body).then((r) => r.data),
  zones: (q) => getData('/disaster-zones', q, { auth: false }),
  zone: (id) => getData(`/disaster-zones/${id}`, undefined, { auth: false }),
  createZone: (body) => api.post('/disaster-zones', body).then((r) => r.data),
  updateZone: (id, body) => api.patch(`/disaster-zones/${id}`, body).then((r) => r.data),
  mapResources: (q) => getData('/map/resources', q, { auth: false }),
  mapRequests: (q) => getData('/map/requests', q),
  mapTeams: () => getData('/map/teams'),
  routeEstimate: (q) => getData('/routes/estimate', q),
};

export const rulesApi = {
  list: () => getData('/escalation-rules'),
  create: (body) => api.post('/escalation-rules', body).then((r) => r.data),
  update: (id, body) => api.patch(`/escalation-rules/${id}`, body).then((r) => r.data),
};

export const dashboardApi = {
  summary: () => getData('/dashboard/summary'),
  criticalNeeds: () => getData('/dashboard/critical-needs'),
  resourceDistribution: () => getData('/dashboard/resource-distribution'),
  responseTimes: (days = 30) => getData('/dashboard/response-times', { days }),
};

export const auditApi = {
  list: (q) => api.get('/audit-logs', q),
};

export const healthApi = {
  get: () => getData('/health', undefined, { auth: false }),
};
