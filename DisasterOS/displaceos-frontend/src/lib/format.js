// Plain-language labels for backend enums. These translate states; they never invent new ones.
export const SEVERITY = {
  NORMAL: { label: 'Routine', long: 'Routine information' },
  HIGH: { label: 'High attention', long: 'High attention' },
  RED: { label: 'Critical', long: 'Critical' },
  HYPER_RED: { label: 'Highest priority', long: 'Highest priority' },
};
export const SEVERITIES = ['NORMAL', 'HIGH', 'RED', 'HYPER_RED'];

export const CATEGORIES = [
  { value: 'FOOD', label: 'Food' },
  { value: 'WATER', label: 'Drinking water' },
  { value: 'MEDICINE', label: 'Medicine' },
  { value: 'SHELTER', label: 'Shelter' },
  { value: 'HYGIENE', label: 'Hygiene supplies' },
  { value: 'CLOTHING', label: 'Clothing' },
  { value: 'OTHER', label: 'Something else' },
];
export const categoryLabel = (v) => CATEGORIES.find((c) => c.value === v)?.label ?? v;

export const REQUEST_STATUS = {
  SUBMITTED: 'Request received',
  VERIFIED: 'Checked — supplies being arranged',
  REJECTED: 'Not approved',
  ALLOCATED: 'Supplies reserved',
  DISPATCHED: 'A response team has been assigned',
  PARTIALLY_DELIVERED: 'Partly delivered',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

export const DISPATCH_STATUS = {
  CREATED: 'Dispatch created',
  ASSIGNED: 'Team assigned',
  ACCEPTED: 'Team accepted',
  IN_TRANSIT: 'Delivery in progress',
  PARTIALLY_DELIVERED: 'Partly delivered',
  DELIVERED: 'Delivery run finished',
  FAILED: 'Could not be completed',
  CANCELLED: 'Cancelled',
};

export const AVAILABILITY = {
  AVAILABLE: 'Available',
  LIMITED: 'Limited stock',
  NOT_AVAILABLE: 'Not available',
  NOT_CONFIRMED: 'Availability not confirmed',
};

export const LOCATION_TYPES = {
  CAMP: 'Relief camp',
  WAREHOUSE: 'Warehouse',
  DISTRIBUTION_POINT: 'Distribution point',
  SHELTER: 'Shelter',
  MEDICAL_POINT: 'Medical point',
  OTHER: 'Other',
};

export const ROLE_LABELS = {
  CITIZEN: 'Citizen / requester',
  CAMP_MANAGER: 'Camp manager',
  RELIEF_COORDINATOR: 'Relief coordinator',
  INVENTORY_MANAGER: 'Inventory manager',
  RESPONSE_TEAM: 'Response team',
  ADMIN: 'Administrator',
};

export const HAZARD_LABELS = {
  FLOOD: 'Flood',
  EARTHQUAKE: 'Earthquake',
  CYCLONE: 'Cyclone',
  LANDSLIDE: 'Landslide',
  WILDFIRE: 'Wildfire',
  HEATWAVE: 'Heatwave',
  DROUGHT: 'Drought',
  CONFLICT: 'Conflict',
  OTHER: 'Other hazard',
};

const dtf = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const tf = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

export function formatDateTime(v) {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : dtf.format(d);
}
export function formatTime(v) {
  if (!v) return '—';
  return tf.format(new Date(v));
}

export function timeAgo(v) {
  if (!v) return 'never';
  const diff = Date.now() - new Date(v).getTime();
  const abs = Math.abs(diff);
  const m = Math.round(abs / 60000);
  const suffix = diff >= 0 ? 'ago' : 'from now';
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ${suffix}`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ${suffix}`;
  return `${Math.round(h / 24)} days ${suffix}`;
}

export function minutesLabel(min) {
  if (min == null) return 'No data yet';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// Straight-line only. Never presented as road distance.
export function distanceLabel(km) {
  if (km == null || !Number.isFinite(km)) return 'Distance unavailable';
  return `approx. ${km < 10 ? km.toFixed(1) : Math.round(km)} km away (straight-line distance)`;
}

export const num = (n) => (n == null ? '—' : new Intl.NumberFormat().format(n));
