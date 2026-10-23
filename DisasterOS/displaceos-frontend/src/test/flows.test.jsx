import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, citizen } from './utils.jsx';
import { ApiError } from '../api/client.js';

// Leaflet does not run in jsdom; the map is replaced by a stub that exposes its markers.
vi.mock('../components/map/LeafletMap.jsx', () => ({
  default: ({ markers = [], onPick }) => (
    <div data-testid="map">
      {markers.length} markers
      {onPick && (
        <button type="button" onClick={() => onPick({ latitude: 30.3, longitude: 78.05 })}>
          pick-point
        </button>
      )}
    </div>
  ),
}));

const auth = { user: citizen, status: 'authenticated', isStaff: false, hasRole: (...r) => r.includes(citizen.role) };
vi.mock('../app/AuthContext.jsx', () => ({ useAuth: () => auth, STAFF_ROLES: [] }));
vi.mock('../app/SocketContext.jsx', () => ({ useLiveRecord: () => {}, useSocket: () => ({ status: 'off', subscribe: () => () => {} }) }));

const services = vi.hoisted(() => ({
  inventoryApi: { catalogue: vi.fn(), availability: vi.fn() },
  placesApi: { locations: vi.fn() },
  requestsApi: { create: vi.fn(), get: vi.fn(), tracking: vi.fn(), trackingLinks: vi.fn() },
  trackingApi: {},
}));
vi.mock('../api/services.js', () => services);

import RequestWizard from '../features/requests/RequestWizard.jsx';
import FindHelpPage from '../features/resources/FindHelpPage.jsx';
import RequestDetailPage from '../features/requests/RequestDetailPage.jsx';
import { RequireAuth } from '../components/layout/Layout.jsx';

const CAMP = { id: 'camp-1', name: 'Raipur Relief Camp', type: 'CAMP', area: 'Raipur', latitude: 30.31, longitude: 78.09 };

beforeEach(() => {
  vi.clearAllMocks();
  services.inventoryApi.catalogue.mockResolvedValue({ data: [{ id: 'item-water', name: 'Drinking water can (20 L)', unit: 'cans', category: 'WATER' }], meta: {} });
  services.placesApi.locations.mockResolvedValue([CAMP]);
});

async function fillWizardToReview(user) {
  await user.click(screen.getByRole('radio', { name: /Drinking water/ }));
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await user.type(await screen.findByLabelText(/Drinking water can/), '10');
  await user.type(screen.getByLabelText(/How many people/), '40');
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await user.click(screen.getByRole('radio', { name: /relief camp or shelter/ }));
  await user.selectOptions(await screen.findByLabelText('Camp or shelter'), 'camp-1');
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await user.type(screen.getByLabelText(/Describe the situation/), 'Water tanker has not arrived for two days.');
  await user.click(screen.getByRole('checkbox'));
}

describe('request submission', () => {
  it('sends the backend schema and shows the reference only after the API confirms', async () => {
    const user = userEvent.setup();
    let resolve;
    services.requestsApi.create.mockReturnValue(new Promise((r) => (resolve = r)));
    renderWithProviders(<RequestWizard />);
    await fillWizardToReview(user);
    await user.click(screen.getByRole('button', { name: 'Send request' }));

    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled();
    expect(screen.queryByText('Request received')).not.toBeInTheDocument();
    expect(services.requestsApi.create).toHaveBeenCalledTimes(1);
    const body = services.requestsApi.create.mock.calls[0][0];
    expect(body).toEqual({
      category: 'WATER',
      description: 'Water tanker has not arrived for two days.',
      peopleAffected: 40,
      items: [{ inventoryItemId: 'item-water', quantity: 10 }],
      campId: 'camp-1',
    });
    expect(body).not.toHaveProperty('severity');

    resolve({ id: 'req-1', referenceCode: 'DR-ABC234' });
    expect(await screen.findByText('DR-ABC234')).toBeInTheDocument();
    expect(screen.getByText('Request received')).toBeInTheDocument();
  });

  it('shows the API error and never a success state when submission fails', async () => {
    const user = userEvent.setup();
    services.requestsApi.create.mockRejectedValue(new ApiError({ status: 400, code: 'VALIDATION_ERROR', message: 'Some fields are missing or invalid', details: [{ path: 'items', message: 'Bad item' }] }));
    renderWithProviders(<RequestWizard />);
    await fillWizardToReview(user);
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText('Your request was not sent')).toBeInTheDocument();
    expect(screen.getByText('Bad item')).toBeInTheDocument();
    expect(screen.queryByText(/DR-/)).not.toBeInTheDocument();
  });

  it('blocks progress until required fields are valid', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RequestWizard />);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Choose what you need.')).toBeInTheDocument();
  });
});

describe('GPS consent and manual fallback', () => {
  it('asks for location only after the user clicks, and offers manual entry when denied', async () => {
    const user = userEvent.setup();
    const getCurrentPosition = vi.fn((ok, fail) => fail({ code: 1 }));
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true });
    renderWithProviders(<RequestWizard />);
    await user.click(screen.getByRole('radio', { name: /Drinking water/ }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.type(await screen.findByLabelText(/Drinking water can/), '3');
    await user.type(screen.getByLabelText(/How many people/), '4');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(screen.getByText('Why we ask for your location')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Share my location now/ }));
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Location not shared')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Choose manually' }));
    await user.click(await screen.findByRole('button', { name: 'pick-point' }));
    expect(screen.getByLabelText('Latitude (optional)')).toHaveValue('30.3');
  });
});

describe('nearby resource availability', () => {
  it('shows stock status, straight-line distance and "Distance unavailable" honestly', async () => {
    services.inventoryApi.availability.mockResolvedValue({
      data: [
        { location: { ...CAMP, id: 'w1', name: 'Central Warehouse', type: 'WAREHOUSE' }, item: { id: 'i1', name: 'Ration kit', unit: 'kits', category: 'FOOD' }, available: 410, availabilityStatus: 'AVAILABLE', lastConfirmedAt: new Date().toISOString(), distanceKm: 16.7 },
        { location: { id: 'k3', name: 'Mobile Kitchen', type: 'DISTRIBUTION_POINT', latitude: null, longitude: null }, item: { id: 'i2', name: 'Meal pack', unit: 'packs', category: 'FOOD' }, available: null, availabilityStatus: 'NOT_CONFIRMED', lastConfirmedAt: '2026-01-01T00:00:00Z', distanceKm: null },
      ],
      meta: { staleAfterHours: 48 },
    });
    renderWithProviders(<FindHelpPage />, { route: '/help?category=FOOD' });
    expect(await screen.findByText('Central Warehouse')).toBeInTheDocument();
    expect(screen.getAllByText('Available').some((el) => el.classList.contains('badge'))).toBe(true);
    expect(screen.getByText('Availability not confirmed')).toBeInTheDocument();
    expect(screen.getByText('410 kits')).toBeInTheDocument();
    // No origin chosen yet: distances are not shown as numbers.
    expect(screen.queryByText(/km away/)).not.toBeInTheDocument();
    expect(screen.getByText('Distance unavailable')).toBeInTheDocument();
    expect(services.inventoryApi.availability).toHaveBeenCalledWith(expect.objectContaining({ category: 'FOOD' }));
  });

  it('explains an empty result instead of showing placeholder stock', async () => {
    services.inventoryApi.availability.mockResolvedValue({ data: [], meta: { staleAfterHours: 48 } });
    renderWithProviders(<FindHelpPage />, { route: '/help?category=MEDICINE' });
    expect(await screen.findByText('No location has recorded medicine stock')).toBeInTheDocument();
  });

  it('shows an error state with retry when the API fails', async () => {
    services.inventoryApi.availability.mockRejectedValue(new ApiError({ status: 0, code: 'NETWORK', message: 'down' }));
    renderWithProviders(<FindHelpPage />);
    expect(await screen.findByText('Cannot reach DisplaceOS')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument();
  });
});

describe('tracking', () => {
  const detail = { id: 'r1', referenceCode: 'DR-TRACK1', category: 'FOOD', status: 'DISPATCHED', statusLabel: 'A response team has been assigned', isOwn: true, verified: true, verifiedAt: new Date().toISOString(), peopleAffected: 5, description: 'x', items: [], createdAt: new Date().toISOString() };
  const tracking = (eta) => ({
    request: detail,
    items: [{ requestItemId: 'a', name: 'Ration kit', unit: 'kits', requested: 10, delivered: 6, remaining: 4, onTheWay: 4, reservedNotYetDispatched: 0 }],
    totals: { requested: 10, delivered: 6, remaining: 4 },
    dispatches: [],
    eta,
    lastUpdatedAt: new Date().toISOString(),
    timeline: [{ id: 't1', type: 'CREATED', message: 'Request received', createdAt: new Date().toISOString() }],
    disclaimer: 'Arrival times are estimates.',
  });

  it('shows delivered and remaining quantities and "Arrival time is not available yet" with the reason', async () => {
    services.requestsApi.get.mockResolvedValue(detail);
    services.requestsApi.tracking.mockResolvedValue(tracking({ etaAvailable: false, reason: 'No arrival estimate has been recorded yet' }));
    services.requestsApi.trackingLinks.mockResolvedValue([]);
    renderWithProviders(<RequestDetailPage />, { route: '/requests/r1', path: '/requests/:requestId' });
    expect(await screen.findByText('Arrival time is not available yet')).toBeInTheDocument();
    expect(screen.getByText('No arrival estimate has been recorded yet')).toBeInTheDocument();
    expect(screen.getByText(/6 of 10 kits delivered/)).toBeInTheDocument();
    expect(screen.getByText('4 remaining')).toBeInTheDocument();
  });

  it('labels an available ETA as an estimate', async () => {
    services.requestsApi.get.mockResolvedValue(detail);
    services.requestsApi.tracking.mockResolvedValue(tracking({ etaAvailable: true, eta: new Date(Date.now() + 3600e3).toISOString(), etaSource: 'MANUAL', delayStatus: 'ON_TRACK' }));
    services.requestsApi.trackingLinks.mockResolvedValue([]);
    renderWithProviders(<RequestDetailPage />, { route: '/requests/r1', path: '/requests/:requestId' });
    expect(await screen.findByText(/Estimated arrival: around/)).toBeInTheDocument();
    expect(screen.getByText(/not a guarantee/)).toBeInTheDocument();
  });

  it('shows a not-found state for requests outside the user scope', async () => {
    services.requestsApi.get.mockRejectedValue(new ApiError({ status: 404, code: 'NOT_FOUND', message: 'Request not found' }));
    services.requestsApi.tracking.mockRejectedValue(new ApiError({ status: 404, code: 'NOT_FOUND', message: 'Request not found' }));
    renderWithProviders(<RequestDetailPage />, { route: '/requests/r9', path: '/requests/:requestId' });
    expect(await screen.findByText('Not found')).toBeInTheDocument();
  });
});

describe('role controls', () => {
  it('does not render staff-only screens for a citizen', () => {
    renderWithProviders(
      <RequireAuth roles={['RELIEF_COORDINATOR']}>
        <div>SECRET OPS</div>
      </RequireAuth>,
    );
    expect(screen.queryByText('SECRET OPS')).not.toBeInTheDocument();
    expect(screen.getByText('This area is for other roles')).toBeInTheDocument();
  });

  it('redirects anonymous visitors to sign in', () => {
    const prev = { ...auth };
    Object.assign(auth, { user: null, status: 'anonymous' });
    renderWithProviders(
      <RequireAuth>
        <div>PRIVATE</div>
      </RequireAuth>,
    );
    expect(screen.getByText('LOGIN PAGE')).toBeInTheDocument();
    Object.assign(auth, prev);
  });

  it('hides staff panels and severity from the requester view', async () => {
    services.requestsApi.get.mockResolvedValue({ id: 'r1', referenceCode: 'DR-OWN', category: 'FOOD', status: 'SUBMITTED', statusLabel: 'Request received', severity: 'RED', isOwn: true, peopleAffected: 1, description: 'x', items: [], createdAt: new Date().toISOString() });
    services.requestsApi.tracking.mockResolvedValue({ items: [], dispatches: [], timeline: [], lastUpdatedAt: new Date().toISOString(), eta: { etaAvailable: false } });
    services.requestsApi.trackingLinks.mockResolvedValue([]);
    renderWithProviders(<RequestDetailPage />, { route: '/requests/r1', path: '/requests/:requestId' });
    const header = await screen.findByRole('heading', { name: 'DR-OWN' });
    expect(within(header.closest('header')).queryByText(/Priority/)).not.toBeInTheDocument();
    expect(screen.queryByText('Review this request')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancel request/ })).toBeInTheDocument();
    await waitFor(() => expect(services.requestsApi.trackingLinks).toHaveBeenCalled());
  });
});
