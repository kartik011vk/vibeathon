import { Navigate, NavLink, Outlet } from 'react-router-dom';
import { BellRing, Boxes, ClipboardList, Gift, HandHeart, LayoutDashboard, LifeBuoy, Settings2, Truck } from 'lucide-react';
import { useAuth } from '../../app/AuthContext.jsx';
import { ROLE_LABELS } from '../../lib/format.js';

const LINKS = [
  { to: '/ops/sos', label: 'SOS board', icon: LifeBuoy, roles: ['RESPONSE_TEAM', 'RELIEF_COORDINATOR', 'ADMIN', 'CAMP_MANAGER'] },
  { to: '/ops/overview', label: 'Overview', icon: LayoutDashboard, roles: ['RELIEF_COORDINATOR', 'ADMIN', 'CAMP_MANAGER'] },
  { to: '/ops/requests', label: 'Requests', icon: ClipboardList, roles: ['RELIEF_COORDINATOR', 'ADMIN', 'CAMP_MANAGER', 'INVENTORY_MANAGER', 'RESPONSE_TEAM'] },
  { to: '/ops/alerts', label: 'Alerts', icon: BellRing, roles: ['RELIEF_COORDINATOR', 'ADMIN', 'CAMP_MANAGER', 'INVENTORY_MANAGER', 'RESPONSE_TEAM'] },
  { to: '/ops/inventory', label: 'Inventory', icon: Boxes, roles: ['INVENTORY_MANAGER', 'RELIEF_COORDINATOR', 'ADMIN'] },
  { to: '/ops/needs', label: 'Open needs', icon: HandHeart, roles: ['RESPONSE_TEAM', 'RELIEF_COORDINATOR', 'ADMIN'] },
  { to: '/ops/dispatch', label: 'Dispatch', icon: Truck, roles: ['RESPONSE_TEAM', 'RELIEF_COORDINATOR', 'ADMIN'] },
  { to: '/ops/donations', label: 'Donations', icon: Gift, roles: ['RELIEF_COORDINATOR', 'ADMIN', 'INVENTORY_MANAGER'] },
  { to: '/ops/admin', label: 'Administration', icon: Settings2, roles: ['ADMIN'] },
];

export const OPS_HOME = {
  RELIEF_COORDINATOR: '/ops/overview',
  ADMIN: '/ops/overview',
  CAMP_MANAGER: '/ops/overview',
  INVENTORY_MANAGER: '/ops/inventory',
  RESPONSE_TEAM: '/ops/needs',
};

export function OpsIndex() {
  const { user } = useAuth();
  return <Navigate to={OPS_HOME[user.role] ?? '/'} replace />;
}

export default function OpsLayout() {
  const { user } = useAuth();
  const links = LINKS.filter((l) => l.roles.includes(user.role));
  return (
    <div className="container ops-layout">
      <aside>
        <div className="small muted" style={{ marginBottom: 8 }}>
          <strong style={{ color: 'var(--ink)' }}>{user.fullName}</strong>
          <br />
          {ROLE_LABELS[user.role]}
          {user.assignedLocations?.length > 0 && <> · {user.assignedLocations.map((l) => l.name.replace(' (demo)', '')).join(', ')}</>}
          {user.teams?.length > 0 && <> · {user.teams.map((t) => t.name).join(', ')}</>}
        </div>
        <nav className="ops-side" aria-label="Operations">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to}>
              <l.icon size={18} aria-hidden="true" /> {l.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div style={{ minWidth: 0 }}>
        <Outlet />
      </div>
    </div>
  );
}
