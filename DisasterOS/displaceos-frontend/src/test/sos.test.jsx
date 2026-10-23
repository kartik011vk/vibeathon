import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './utils.jsx';

vi.mock('../components/map/LeafletMap.jsx', () => ({ default: () => <div data-testid="map" /> }));

const auth = vi.hoisted(() => {
  const a = { user: null, status: 'anonymous', isStaff: false };
  a.hasRole = (...r) => Boolean(a.user && r.includes(a.user.role));
  return a;
});
vi.mock('../app/AuthContext.jsx', () => ({ useAuth: () => auth, STAFF_ROLES: [] }));
vi.mock('../app/SocketContext.jsx', () => ({ useLiveRecord: () => {}, useSocket: () => ({ status: 'off', subscribe: () => () => {} }) }));

const services = vi.hoisted(() => ({
  sosApi: { active: vi.fn(), respond: vi.fn() },
  dispatchesApi: { complete: vi.fn(), list: vi.fn() },
  receiptApi: { confirm: vi.fn() },
  requestsApi: { get: vi.fn(), tracking: vi.fn(), trackingLinks: vi.fn() },
  placesApi: {},
  teamsApi: {},
  trackingApi: {},
}));
vi.mock('../api/services.js', () => services);

import { SosAlertLayer } from '../features/sos/SosPages.jsx';
import RequestDetailPage from '../features/requests/RequestDetailPage.jsx';

const publicSos = { id: 's1', referenceCode: 'SOS-ABCDE', status: 'ACTIVE', areaLabel: 'about 2 km from Raipur Relief Camp', peopleCount: 2, createdAt: new Date().toISOString() };

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  auth.user = null;
  auth.status = 'anonymous';
});

describe('SOS pop-up', () => {
  it('shows anyone a red alert with the area and a 112 button, without private details', async () => {
    services.sosApi.active.mockResolvedValue({ data: [publicSos], meta: { scope: 'public' } });
    renderWithProviders(<SosAlertLayer />);
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /2 people need rescue about 2 km from Raipur Relief Camp/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Call 112/ })).toHaveAttribute('href', 'tel:112');
    expect(screen.queryByRole('button', { name: /I'm responding/ })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'I understand' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    // The strip stays so the emergency is still visible.
    expect(screen.getByText(/^Emergency: about 2 km from Raipur Relief Camp/)).toBeInTheDocument();
  });

  it('gives responders the message, contact and an "I\'m responding" button', async () => {
    auth.user = { id: 'r1', role: 'RESPONSE_TEAM', fullName: 'Ritu' };
    auth.status = 'authenticated';
    services.sosApi.active.mockResolvedValue({
      data: [{ ...publicSos, latitude: 30.3, longitude: 78.0, message: 'Trapped on the roof', requester: { fullName: 'Priya', phone: '+91 90000 00001' } }],
      meta: { scope: 'responder' },
    });
    services.sosApi.respond.mockResolvedValue({ referenceCode: 'SOS-ABCDE' });
    renderWithProviders(<SosAlertLayer />);
    expect(await screen.findByText('“Trapped on the roof”')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '+91 90000 00001' })).toHaveAttribute('href', 'tel:+919000000001');
    await userEvent.setup().click(screen.getByRole('button', { name: /I'm responding/ }));
    await waitFor(() => expect(services.sosApi.respond.mock.calls[0][0]).toBe('s1'));
  });

  it('shows nothing when there is no open SOS', async () => {
    services.sosApi.active.mockResolvedValue({ data: [], meta: {} });
    renderWithProviders(<SosAlertLayer />);
    await waitFor(() => expect(services.sosApi.active).toHaveBeenCalled());
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

describe('delivery completion', () => {
  const base = {
    id: 'q1',
    referenceCode: 'DR-DONE01',
    category: 'FOOD',
    statusLabel: 'Delivered',
    isOwn: true,
    verified: true,
    verifiedAt: new Date().toISOString(),
    peopleAffected: 4,
    description: 'x',
    items: [],
    createdAt: new Date().toISOString(),
  };
  const tracking = {
    items: [{ requestItemId: 'a', name: 'Ration kit', unit: 'kits', requested: 4, delivered: 4, remaining: 0 }],
    dispatches: [{ id: 'd1', status: 'DELIVERED', team: { name: 'Aid Team' }, lines: [], location: {}, eta: {}, updatedAt: new Date().toISOString(), lastHandover: { at: new Date().toISOString(), locationCheck: 'VERIFIED', distanceM: 40 } }],
    timeline: [],
    lastUpdatedAt: new Date().toISOString(),
    eta: { etaAvailable: false },
  };

  it('shows the verified hand-over and lets the recipient confirm receipt', async () => {
    auth.user = { id: 'u1', role: 'CITIZEN' };
    auth.status = 'authenticated';
    services.requestsApi.get.mockResolvedValue({ ...base, status: 'DELIVERED' });
    services.requestsApi.tracking.mockResolvedValue(tracking);
    services.requestsApi.trackingLinks.mockResolvedValue([]);
    services.receiptApi.confirm.mockResolvedValue({});
    renderWithProviders(<RequestDetailPage />, { route: '/requests/q1', path: '/requests/:requestId' });
    expect(await screen.findByText(/Hand-over location verified \(40 m\)/)).toBeInTheDocument();
    expect(screen.getByText(/verified by the team's phone/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: /Yes, I received them/ }));
    await waitFor(() => expect(services.receiptApi.confirm).toHaveBeenCalledWith('q1', undefined));
  });
});
