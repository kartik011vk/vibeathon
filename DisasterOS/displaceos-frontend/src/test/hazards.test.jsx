import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './utils.jsx';

vi.mock('../components/map/LeafletMap.jsx', () => ({ default: ({ markers = [] }) => <div data-testid="map">{markers.length} mapped</div> }));
const auth = vi.hoisted(() => {
  const a = { user: null, status: 'anonymous' };
  a.hasRole = (...r) => Boolean(a.user && r.includes(a.user.role));
  return a;
});
vi.mock('../app/AuthContext.jsx', () => ({ useAuth: () => auth, STAFF_ROLES: [] }));
const services = vi.hoisted(() => ({ hazardsApi: { list: vi.fn(), refresh: vi.fn(), createZone: vi.fn() } }));
vi.mock('../api/services.js', () => services);

import LiveIndiaFeed, { HazardPopup } from '../features/hazards/LiveIndiaFeed.jsx';

const now = Date.now();
const quake = { id: 'h1', source: 'USGS', hazardType: 'EARTHQUAKE', title: 'Earthquake M5.2', areaDescription: '23 km NE of Uttarkashi, India', state: null, latitude: 30.7, longitude: 78.4, severity: 'HIGH', sourceSeverity: 'M5.2', isOfficial: false, startsAt: new Date(now - 600000).toISOString(), expiresAt: null, sourceUrl: 'https://earthquake.usgs.gov/x', popup: true };
const flood = { id: 'h2', source: 'NDMA_SACHET', hazardType: 'FLOOD', title: 'Flood', areaDescription: 'Flood warning — Kamrup district of Assam', state: 'Assam', latitude: null, longitude: null, severity: 'RED', sourceSeverity: 'Severe · Immediate', isOfficial: true, startsAt: new Date(now - 300000).toISOString(), expiresAt: new Date(now + 3600000).toISOString(), instruction: 'Move to higher ground.', popup: true };
const lightning = { ...flood, id: 'h3', hazardType: 'LIGHTNING', title: 'Lightning', state: 'Andhra Pradesh', severity: 'RED', popup: false };
const feeds = [
  { source: 'NDMA_SACHET', healthy: true, lastSuccessAt: new Date().toISOString(), lastAttemptAt: new Date().toISOString() },
  { source: 'USGS', healthy: true, lastSuccessAt: new Date().toISOString(), lastAttemptAt: new Date().toISOString() },
  { source: 'GDACS', healthy: false, lastSuccessAt: null, lastAttemptAt: new Date().toISOString() },
];

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  auth.user = null;
});

describe('live India feed', () => {
  it('lists alerts with their source, marks official ones, and reports an unreachable feed', async () => {
    services.hazardsApi.list.mockResolvedValue({ data: [quake, flood], meta: { feeds, region: 'India' } });
    renderWithProviders(<LiveIndiaFeed />);
    expect(await screen.findByText('Earthquake M5.2')).toBeInTheDocument();
    expect(screen.getByText(/Official · NDMA · Government of India/)).toBeInTheDocument();
    expect(screen.getByText('· area only, not mapped')).toBeInTheDocument();
    expect(screen.getByText(/Move to higher ground/)).toBeInTheDocument();
    expect(await screen.findByTestId('map')).toHaveTextContent('1 mapped');
    expect(screen.getByText(/^unreachable/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create disaster zone' })).not.toBeInTheDocument();
  });

  it('filters by hazard group and official source', async () => {
    const user = userEvent.setup();
    services.hazardsApi.list.mockResolvedValue({ data: [], meta: { feeds } });
    renderWithProviders(<LiveIndiaFeed />);
    await user.click(await screen.findByRole('button', { name: 'Floods & cyclones' }));
    await user.click(screen.getByLabelText(/Official government alerts only/));
    await waitFor(() =>
      expect(services.hazardsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ type: ['FLOOD', 'CYCLONE', 'LANDSLIDE'], source: 'NDMA_SACHET', activeOnly: true })),
    );
    expect(await screen.findByText(/No matching alerts are active in India right now/)).toBeInTheDocument();
  });

  it('offers coordinators a "Create disaster zone" button for mapped events', async () => {
    auth.user = { role: 'RELIEF_COORDINATOR' };
    services.hazardsApi.list.mockResolvedValue({ data: [quake, flood], meta: { feeds } });
    services.hazardsApi.createZone.mockResolvedValue({ name: 'Earthquake M5.2' });
    renderWithProviders(<LiveIndiaFeed />);
    const btns = await screen.findAllByRole('button', { name: 'Create disaster zone' });
    expect(btns).toHaveLength(1);
    await userEvent.setup().click(btns[0]);
    await waitFor(() => expect(services.hazardsApi.createZone).toHaveBeenCalledWith('h1'));
  });
});

describe('hazard pop-up', () => {
  it('pops up new high-impact alerts only, and remembers dismissals', async () => {
    services.hazardsApi.list.mockResolvedValue({ data: [quake, lightning], meta: { feeds } });
    renderWithProviders(<HazardPopup />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Earthquake M5.2');
    expect(screen.queryByText(/Lightning — Andhra Pradesh/)).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Dismiss alert' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('dos-hazard-dismissed'))).toEqual(['h1']);
  });
});
