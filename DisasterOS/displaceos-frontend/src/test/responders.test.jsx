import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './utils.jsx';

vi.mock('../components/map/LeafletMap.jsx', () => ({
  default: ({ markers = [] }) => <div data-testid="map">{markers.map((m) => m.title).join(',')}</div>,
}));

const auth = vi.hoisted(() => {
  const a = {
    user: { id: 'u1', fullName: 'Ritu', role: 'RESPONSE_TEAM', teams: [{ id: 'team-1', name: 'Aid Team' }], assignedLocations: [], organization: { name: 'Aid Network' } },
    status: 'authenticated',
    refreshUser: vi.fn(),
    startSession: vi.fn(),
  };
  a.hasRole = (...r) => r.includes(a.user.role);
  return a;
});
vi.mock('../app/AuthContext.jsx', () => ({ useAuth: () => auth, STAFF_ROLES: [] }));

const services = vi.hoisted(() => ({
  offersApi: { openNeeds: vi.fn(), create: vi.fn(), list: vi.fn(), withdraw: vi.fn() },
  suppliesApi: { create: vi.fn() },
  inventoryApi: { catalogue: vi.fn() },
  organizationsApi: { mine: vi.fn(), decideMember: vi.fn(), rotateJoinCode: vi.fn() },
}));
vi.mock('../api/services.js', () => services);

import OpenNeedsPage from '../features/responders/OpenNeedsPage.jsx';
import { DonatePage } from '../features/donations/DonationPages.jsx';
import { OrganizationPage } from '../features/responders/ResponderPages.jsx';

const need = {
  id: 'r1',
  referenceCode: 'DR-NEED01',
  category: 'WATER',
  status: 'VERIFIED',
  severity: 'RED',
  severityLabel: 'Critical',
  peopleAffected: 40,
  vulnerableCount: 6,
  area: 'Raipur Relief Camp, Raipur',
  approximateLocation: { latitude: 30.31, longitude: 78.09 },
  locationPrecision: 'CAMP',
  distanceKm: 8.4,
  items: [{ name: 'Water can', unit: 'cans', remaining: 20 }],
  suppliesReserved: true,
  offersCount: 0,
  offeredByMyTeam: false,
  createdAt: new Date().toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.user.role = 'RESPONSE_TEAM';
});

describe('open needs board', () => {
  it('shows what is needed, where roughly, and lets a team offer to deliver', async () => {
    const user = userEvent.setup();
    services.offersApi.openNeeds.mockResolvedValue({ data: [need], meta: { origin: { label: 'Aid Team base' } } });
    services.offersApi.create.mockResolvedValue({ id: 'o1' });
    renderWithProviders(<OpenNeedsPage />);
    expect(await screen.findByText('DR-NEED01')).toBeInTheDocument();
    expect(screen.getByText(/20 cans — Water can/)).toBeInTheDocument();
    expect(screen.getByText('approx. 8.4 km away (straight-line distance)')).toBeInTheDocument();
    expect(screen.getByText(/shared only with the team that is assigned/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Offer to deliver/ }));
    await user.type(screen.getByLabelText(/Message for the coordinator/), 'Van free now');
    await user.click(screen.getByRole('button', { name: 'Send offer' }));
    await waitFor(() => expect(services.offersApi.create).toHaveBeenCalledWith('r1', { teamId: 'team-1', note: 'Van free now', ownSupplies: false }));
  });

  it('explains an empty board instead of showing placeholders', async () => {
    services.offersApi.openNeeds.mockResolvedValue({ data: [], meta: {} });
    renderWithProviders(<OpenNeedsPage />);
    expect(await screen.findByText('No open needs right now')).toBeInTheDocument();
  });
});

describe('donate supplies', () => {
  it('sends catalogue items with the chosen delivery mode and requires a pickup address for collection', async () => {
    const user = userEvent.setup();
    auth.user.role = 'CITIZEN';
    services.inventoryApi.catalogue.mockResolvedValue({ data: [{ id: 'blanket', name: 'Blanket', unit: 'pieces', category: 'SHELTER' }] });
    services.suppliesApi.create.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<DonatePage />);
    await screen.findByRole('option', { name: /Blanket/ });
    await user.selectOptions(screen.getByLabelText('Item 1'), 'blanket');
    await user.type(screen.getByLabelText('Quantity'), '30');
    await user.click(screen.getByRole('radio', { name: /Please collect them/ }));
    await user.click(screen.getByRole('button', { name: /Send offer/ }));
    expect(screen.getByText('Where should a team collect from?')).toBeInTheDocument();
    expect(services.suppliesApi.create).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Collection address'), 'Shop 4, Main Road');
    await user.click(screen.getByRole('button', { name: /Send offer/ }));
    expect(services.suppliesApi.create.mock.calls[0][0]).toEqual({
      donorName: 'Aid Network',
      deliveryMode: 'PICKUP',
      pickupAddress: 'Shop 4, Main Road',
      lines: [{ inventoryItemId: 'blanket', quantity: 30 }],
    });
    expect(screen.getByRole('button', { name: /Sending/ })).toBeDisabled();
  });
});

describe('organisation page', () => {
  it('tells a pending organisation it is waiting for an administrator', async () => {
    auth.user.role = 'CITIZEN';
    services.organizationsApi.mine.mockResolvedValue({ id: 'o', name: 'New NGO', type: 'NGO', area: 'Dehradun', status: 'PENDING', myRole: 'LEAD', myMembershipStatus: 'PENDING', isLead: false, teams: [], createdAt: new Date().toISOString() });
    renderWithProviders(<OrganizationPage />);
    expect(await screen.findByText('Waiting for an administrator')).toBeInTheDocument();
    expect(screen.queryByText('Invite members')).not.toBeInTheDocument();
  });

  it('lets an approved lead approve a pending member', async () => {
    const user = userEvent.setup();
    const org = {
      id: 'o',
      name: 'Aid Network',
      type: 'NGO',
      area: 'Dehradun',
      status: 'APPROVED',
      myRole: 'LEAD',
      myMembershipStatus: 'APPROVED',
      isLead: true,
      pendingMembers: 1,
      teams: [{ id: 't', name: 'Aid Network', availability: 'AVAILABLE', members: [{ id: 'u1', fullName: 'Ritu' }] }],
      members: [{ id: 'm1', fullName: 'Aman', email: 'aman@x.dev', orgRole: 'MEMBER', membershipStatus: 'PENDING', createdAt: new Date().toISOString() }],
      createdAt: new Date().toISOString(),
    };
    services.organizationsApi.mine.mockResolvedValue(org);
    services.organizationsApi.decideMember.mockResolvedValue({ ...org, pendingMembers: 0, members: [{ ...org.members[0], membershipStatus: 'APPROVED' }] });
    renderWithProviders(<OrganizationPage />);
    expect(await screen.findByText('Invite members')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Approve/ }));
    await waitFor(() => expect(services.organizationsApi.decideMember).toHaveBeenCalledWith('m1', 'APPROVE'));
    // Organisation status badge plus the member's new badge.
    await waitFor(() => expect(screen.getAllByText('Approved')).toHaveLength(2));
  });
});
