import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Building2, ClipboardList, Gift, HandHeart, MapPin, PackageSearch, PhoneCall, Radio, Route, ShieldCheck, Truck } from 'lucide-react';
import { alertsApi, hazardsApi, placesApi } from '../../api/services.js';
import GlobeSection from '../../components/globe/GlobeSection.jsx';
import { SeverityBadge } from '../../components/ui/index.jsx';
import { timeAgo } from '../../lib/format.js';
import { useAuth } from '../../app/AuthContext.jsx';

function AlertStrip() {
  const q = useQuery({ queryKey: ['alerts', 'active', 'public'], queryFn: () => alertsApi.active(), refetchInterval: 120000 });
  if (q.isPending) return <div className="skeleton" style={{ height: 48, marginTop: 8 }} aria-label="Loading alerts" />;
  if (q.isError) {
    return <p className="small muted">Current alerts could not be loaded. You can still request supplies and find help.</p>;
  }
  const alerts = q.data.data;
  if (!alerts.length) return <p className="small muted">No active disaster alerts have been published on DisplaceOS.</p>;
  const top = alerts[0];
  return (
    <Link to="/updates" className="notice notice-warn" style={{ textDecoration: 'none', color: 'inherit' }}>
      <SeverityBadge severity={top.severity} />
      <span>
        <strong>{top.title}</strong>
        <span className="small muted">
          {' '}
          · updated {timeAgo(top.updatedAt)}
          {alerts.length > 1 ? ` · ${alerts.length - 1} more alert${alerts.length > 2 ? 's' : ''}` : ''}
        </span>
      </span>
    </Link>
  );
}

function LiveIndiaStrip() {
  const q = useQuery({ queryKey: ['hazards', 'home'], queryFn: () => hazardsApi.list({ activeOnly: true, sinceHours: 72, limit: 300 }), refetchInterval: 120000 });
  if (!q.data) return null;
  const items = q.data.data;
  if (!items.length) return null;
  const worst = [...items].sort((a, b) => ['NORMAL', 'HIGH', 'RED', 'HYPER_RED'].indexOf(b.severity) - ['NORMAL', 'HIGH', 'RED', 'HYPER_RED'].indexOf(a.severity))[0];
  const states = [...new Set(items.map((e) => e.state).filter(Boolean))];
  return (
    <Link to="/updates#live" className="notice notice-info" style={{ textDecoration: 'none', color: 'inherit', marginTop: 10 }}>
      <SeverityBadge severity={worst.severity} />
      <span>
        <strong>{items.length} live alerts across India</strong>
        <span className="small muted">
          {' '}
          · {states.length ? `${states.slice(0, 4).join(', ')}${states.length > 4 ? ` and ${states.length - 4} more` : ''}` : 'see map'} · most serious: {worst.title}{worst.state ? ` (${worst.state})` : ''}
        </span>
      </span>
    </Link>
  );
}

function LiveFacts() {
  const resources = useQuery({ queryKey: ['map', 'resources'], queryFn: () => placesApi.mapResources() });
  const zones = useQuery({ queryKey: ['zones', 'open'], queryFn: () => placesApi.zones({ status: 'ACTIVE,MONITORING' }) });
  const alerts = useQuery({ queryKey: ['alerts', 'active', 'public'], queryFn: () => alertsApi.active() });
  if (resources.isError || zones.isError || alerts.isError) return null;
  if (resources.isPending || zones.isPending || alerts.isPending) return null;
  const points = resources.data.length;
  const withStock = resources.data.filter((r) => r.categories.length > 0).length;
  const facts = [
    { value: zones.data.length, label: zones.data.length === 1 ? 'disaster zone being tracked' : 'disaster zones being tracked' },
    { value: alerts.data.data.length, label: 'public alerts active' },
    { value: points, label: 'mapped relief locations' },
    { value: withStock, label: 'with confirmed stock right now' },
  ];
  return (
    <section className="section-tight" aria-label="Current figures">
      <div className="container">
        <div className="grid grid-4">
          {facts.map((f) => (
            <div key={f.label} className="stat">
              <div className="stat-value">{f.value}</div>
              <div className="stat-label">{f.label}</div>
            </div>
          ))}
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>
          Figures come straight from the DisplaceOS database when this page loads.
        </p>
      </div>
    </section>
  );
}

const STEPS = [
  { icon: ClipboardList, title: 'Tell us what you need', body: 'Choose the supply, how many people it is for and where you are. It takes about two minutes.' },
  { icon: ShieldCheck, title: 'Relief staff check it', body: 'A coordinator or camp manager verifies the request and sets its priority. You are told either way.' },
  { icon: PackageSearch, title: 'Stock is reserved', body: 'Supplies are set aside at a warehouse or distribution point so nobody else can take them.' },
  { icon: Truck, title: 'A team delivers', body: 'A response team brings the supplies. You can follow each step and see what has arrived and what is still to come.' },
];

const PROMISES = [
  'We only show stock that a warehouse or camp has actually recorded — old counts are marked "not confirmed".',
  'Distances are labelled as straight-line estimates. We never present them as road routes or safe paths.',
  'Arrival times appear only when a team enters one, and are always shown as estimates.',
  'Your exact location is shared only with relief staff handling your request.',
];

export default function HomePage() {
  const { user } = useAuth();
  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <div className="eyebrow">Disaster relief coordination</div>
            <h1>Find help. Request supplies. Track delivery.</h1>
            <p className="lead">
              DisplaceOS connects families, relief camps, warehouses and response teams so food, water, medicine and shelter reach the people who need them.
            </p>
            <div className="hero-actions">
              <Link to="/request" className="action-tile primary">
                <HandHeart size={22} aria-hidden="true" />
                Request supplies
                <span className="muted">Food, water, medicine, shelter</span>
              </Link>
              <Link to="/help" className="action-tile">
                <MapPin size={22} aria-hidden="true" />
                Find nearby help
                <span className="muted">Camps and supply points</span>
              </Link>
              <Link to="/track" className="action-tile">
                <Route size={22} aria-hidden="true" />
                Track my request
                <span className="muted">See what is on the way</span>
              </Link>
            </div>
            <AlertStrip />
            <LiveIndiaStrip />
          </div>
          <GlobeSection />
        </div>
      </section>

      <LiveFacts />

      <section className="section section-alt">
        <div className="container">
          <div className="eyebrow">How it works</div>
          <h2>From request to doorstep, every step is recorded</h2>
          <div className="grid grid-4" style={{ marginTop: 24 }}>
            {STEPS.map((s, i) => (
              <div key={s.title} className="card">
                <div className="choice-icon" style={{ marginBottom: 12, width: 44, height: 44, borderRadius: 12, background: 'var(--pale)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--orange-deep)' }}>
                  <s.icon size={22} aria-hidden="true" />
                </div>
                <div className="small muted">Step {i + 1}</div>
                <h3>{s.title}</h3>
                <p className="small" style={{ marginBottom: 0 }}>
                  {s.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="eyebrow">Want to help?</div>
          <h2>Rescue teams, NGOs, government offices and donors</h2>
          <p className="lead">Requests only matter if someone can fulfil them. DisplaceOS gives the people who deliver their own accounts and tools.</p>
          <div className="grid grid-2" style={{ marginTop: 20 }}>
            <div className="card stack">
              <div className="row">
                <Building2 size={24} color="var(--orange-deep)" aria-hidden="true" />
                <h3 style={{ margin: 0 }}>Respond as an organisation</h3>
              </div>
              <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                <li>Register your NGO, rescue team or government department — an administrator verifies you.</li>
                <li>See verified needs near you (without the family's private details) and offer to deliver.</li>
                <li>Accept dispatches, record exactly what you handed over, and share your live location so families can see you on the map.</li>
                <li>Invite your volunteers with a join code; you approve each one.</li>
              </ul>
              <Link to="/join-responder" className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>
                <Radio size={16} /> Join as a responder
              </Link>
            </div>
            <div className="card stack">
              <div className="row">
                <Gift size={24} color="var(--orange-deep)" aria-hidden="true" />
                <h3 style={{ margin: 0 }}>Donate supplies</h3>
              </div>
              <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                <li>Offer food, water, medicine, blankets or hygiene kits — from one family or a whole company.</li>
                <li>Staff tell you which warehouse or camp to bring them to, or arrange collection.</li>
                <li>Follow your donation until it is counted into stock, and see deliveries made from that location afterwards.</li>
              </ul>
              <Link to="/donate" className="btn btn-secondary" style={{ alignSelf: 'flex-start' }}>
                <Gift size={16} /> Donate supplies
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="section section-alt">
        <div className="container grid grid-2" style={{ alignItems: 'start' }}>
          <div>
            <div className="eyebrow">Honest information</div>
            <h2>What you see here is what we actually know</h2>
            <p className="lead">During an emergency, wrong information is worse than none. DisplaceOS is built to say "we don't know yet" rather than guess.</p>
            <ul className="list">
              {PROMISES.map((p) => (
                <li key={p} className="list-item row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                  <ShieldCheck size={20} color="var(--orange-deep)" aria-hidden="true" style={{ flexShrink: 0, marginTop: 3 }} />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="stack">
            <div className="card notice-strong" style={{ background: 'var(--ink)', color: 'var(--cream)' }}>
              <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                <PhoneCall size={26} color="var(--amber)" aria-hidden="true" style={{ flexShrink: 0 }} />
                <div>
                  <h3 style={{ color: 'var(--cream)' }}>In immediate danger?</h3>
                  <p style={{ marginBottom: 0 }}>
                    DisplaceOS arranges relief supplies. It cannot send rescue. Call your local emergency services straight away — in India, the national emergency number is{' '}
                    <strong style={{ color: 'var(--amber)' }}>112</strong>.
                  </p>
                </div>
              </div>
            </div>
            <div className="card">
              <h3>{user ? `Welcome back, ${user.fullName.split(' ')[0]}` : 'Working at a camp, warehouse or response team?'}</h3>
              <p className="muted">
                {user
                  ? 'Your requests and any updates from relief staff are in one place.'
                  : 'Staff accounts are created by an administrator. Sign in to see the verification queue, stock and dispatch tools for your role.'}
              </p>
              <Link to={user ? (user.role === 'CITIZEN' ? '/track' : '/ops') : '/login'} className="btn btn-secondary">
                {user ? (user.role === 'CITIZEN' ? 'My requests' : 'Open operations') : 'Sign in'} <ArrowRight size={16} />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
