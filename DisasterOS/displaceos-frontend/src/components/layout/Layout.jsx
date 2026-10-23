import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell, LogIn, LogOut, Menu, Siren, UserRound, X } from 'lucide-react';
import { SosAlertLayer } from '../../features/sos/SosPages.jsx';
import { useAuth } from '../../app/AuthContext.jsx';
import { useSocket } from '../../app/SocketContext.jsx';
import { notificationsApi } from '../../api/services.js';
import { Loading } from '../ui/index.jsx';
import { ROLE_LABELS } from '../../lib/format.js';

function ConnectionStatus() {
  const { status } = useSocket();
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  if (!online) {
    return (
      <span className="conn conn-off" role="status">
        <span className="dot" /> Offline
      </span>
    );
  }
  if (status === 'off') return null;
  const map = { live: ['conn-live', 'Live updates'], connecting: ['conn-wait', 'Connecting…'], reconnecting: ['conn-wait', 'Reconnecting…'] };
  const [cls, text] = map[status] ?? map.reconnecting;
  return (
    <span className={`conn ${cls}`} role="status" title="Live updates via Socket.IO. Pages also refresh on their own.">
      <span className="dot" /> <span className="hide-sm">{text}</span>
    </span>
  );
}

function NotificationBell() {
  const q = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => notificationsApi.list({ pageSize: 1 }),
    refetchInterval: 60000,
  });
  const unread = q.data?.meta?.unread ?? 0;
  return (
    <Link to="/notifications" className="icon-btn" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
      <Bell size={20} aria-hidden="true" />
      {unread > 0 && <span className="count-dot">{unread > 99 ? '99+' : unread}</span>}
    </Link>
  );
}

export function Header() {
  const { user, isStaff, logout, status } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <header className="site-header">
      <div className="container bar">
        <Link to="/" className="brand" aria-label="DisplaceOS home">
          <span className="brand-mark" aria-hidden="true" />
          DisplaceOS
        </Link>
        <button type="button" className="icon-btn nav-toggle" aria-expanded={open} aria-controls="main-nav" onClick={() => setOpen((o) => !o)}>
          {open ? <X size={20} /> : <Menu size={20} />}
          <span className="visually-hidden">Menu</span>
        </button>
        <nav id="main-nav" className={`nav ${open ? 'open' : ''}`} aria-label="Main">
          <NavLink to="/request">Request supplies</NavLink>
          <NavLink to="/help">Find help</NavLink>
          <NavLink to="/updates">Disaster updates</NavLink>
          <NavLink to="/track">Track</NavLink>
          <NavLink to="/donate">Donate</NavLink>
          {user?.organization && <NavLink to="/organization">My organisation</NavLink>}
          {isStaff && <NavLink to="/ops">Operations</NavLink>}
        </nav>
        <div className="header-tools">
          <Link to="/sos" className="btn btn-sm sos-btn" aria-label="SOS: I need rescue now">
            <Siren size={16} aria-hidden="true" /> SOS
          </Link>
          <ConnectionStatus />
          {user && <NotificationBell />}
          {status === 'authenticated' ? (
            <>
              <Link to="/profile" className="icon-btn" aria-label={`Account: ${user.fullName}, ${ROLE_LABELS[user.role]}`} title={`${user.fullName} · ${ROLE_LABELS[user.role]}`}>
                <UserRound size={20} />
              </Link>
              <button type="button" className="icon-btn hide-sm" onClick={logout} aria-label="Sign out" title="Sign out">
                <LogOut size={20} />
              </button>
            </>
          ) : status === 'anonymous' ? (
            <Link to="/login" className="btn btn-secondary btn-sm">
              <LogIn size={16} /> Sign in
            </Link>
          ) : null}
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container grid grid-3">
        <div>
          <h4>DisplaceOS</h4>
          <p>Coordinating relief supplies between people in need, camps, warehouses and response teams.</p>
        </div>
        <div>
          <h4>In immediate danger?</h4>
          <p>
            DisplaceOS is not an emergency rescue service. Contact your local emergency services — in India, dial <strong>112</strong>.
          </p>
        </div>
        <div>
          <h4>Want to help?</h4>
          <p>
            <a href="/join-responder">Join as a responder</a> (NGOs, rescue teams, government) · <a href="/donate">Donate supplies</a>
          </p>
          <h4>For developers</h4>
          <p>
            <a href="/api/docs" target="_blank" rel="noreferrer">
              API documentation
            </a>
            <br />
            Map data © OpenStreetMap contributors · Natural Earth
          </p>
        </div>
      </div>
    </footer>
  );
}

export default function Layout() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <Header />
      <SosAlertLayer />
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
      <Footer />
    </>
  );
}

// Client-side gate for a better experience only — the backend enforces every permission.
export function RequireAuth({ roles, children }) {
  const { status, user } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <Loading label="Checking your session…" />;
  if (status !== 'authenticated') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (roles && !roles.includes(user.role)) {
    return (
      <div className="container section">
        <div className="card">
          <h2>This area is for other roles</h2>
          <p className="muted">
            You are signed in as a {ROLE_LABELS[user.role].toLowerCase()}. This page is for: {roles.map((r) => ROLE_LABELS[r]).join(', ')}.
          </p>
          <Link className="btn btn-secondary" to="/">
            Go home
          </Link>
        </div>
      </div>
    );
  }
  return children;
}
