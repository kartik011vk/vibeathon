import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, auth, prisma, setup } from './helpers.js';
import { runFeeds, popupWorthy } from '../src/services/hazard.service.js';
import { pointInIndia } from '../src/adapters/hazards/india.js';
import { parseCap } from '../src/adapters/hazards/feeds.js';

let f;
beforeAll(async () => {
  f = await setup();
});
afterAll(() => prisma.$disconnect());

const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();

const USGS = {
  type: 'FeatureCollection',
  features: [
    { id: 'us-india-1', geometry: { type: 'Point', coordinates: [78.4, 30.7, 12] }, properties: { mag: 5.2, place: '23 km NE of Uttarkashi, India', time: now - 10 * 60000, url: 'https://earthquake.usgs.gov/x1', alert: null, tsunami: 0 } },
    { id: 'us-nepal-1', geometry: { type: 'Point', coordinates: [85.3, 27.7, 10] }, properties: { mag: 5.0, place: '10 km S of Kathmandu, Nepal', time: now - 20 * 60000, url: 'https://earthquake.usgs.gov/x2', alert: null, tsunami: 0 } },
    { id: 'us-andaman-1', geometry: { type: 'Point', coordinates: [93.9, 12.1, 30] }, properties: { mag: 4.6, place: 'Andaman Islands, India region', time: now - 3 * 86400000, url: 'https://earthquake.usgs.gov/x3', alert: null, tsunami: 0 } },
  ],
};
const GDACS = {
  features: [
    {
      geometry: { type: 'Point', coordinates: [91.7, 26.1] },
      properties: { eventtype: 'FL', eventid: 77, name: 'Flood in India', description: 'Flood in India', htmldescription: 'Orange flood in Assam', alertlevel: 'Orange', episodealertlevel: 'Green', iscurrent: 'true', fromdate: iso(3600000).slice(0, 19), todate: iso(0).slice(0, 19), affectedcountries: [{ iso3: 'IND' }], severitydata: { severitytext: 'Magnitude 0 ' }, url: { report: 'https://www.gdacs.org/report?77' } },
    },
  ],
};
const cap = (event, severity, area, sender = 'Assam-SDMA') => `<?xml version="1.0"?>
<cap:alert xmlns:cap="urn:oasis:names:tc:emergency:cap:1.2"><cap:identifier>IN-1_1</cap:identifier><cap:sender>${sender}</cap:sender><cap:sent>${iso(600000)}</cap:sent><cap:status>Actual</cap:status><cap:msgType>Alert</cap:msgType>
<cap:info><cap:language>en-IN</cap:language><cap:event>${event}</cap:event><cap:urgency>Immediate</cap:urgency><cap:severity>${severity}</cap:severity><cap:certainty>Observed</cap:certainty>
<cap:effective>${iso(600000)}</cap:effective><cap:expires>${new Date(now + 6 * 3600000).toISOString()}</cap:expires><cap:headline>${event} warning</cap:headline><cap:instruction>Move to higher ground.</cap:instruction>
<cap:area><cap:areaDesc>${area}</cap:areaDesc></cap:area></cap:info></cap:alert>`;
const RSS = `<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>Flood</title><category>Met</category><link>https://sachet.ndma.gov.in/cap?identifier=111</link><author>controlroom@ndma.gov.in (Assam SDMA)</author><guid isPermaLink="false">111</guid></item>
<item><title>Lightning</title><category>Met</category><link>https://sachet.ndma.gov.in/cap?identifier=222</link><author>controlroom@ndma.gov.in (Andhra Pradesh SDMA)</author><guid isPermaLink="false">222</guid></item>
</channel></rss>`;

function fakeFetch({ failGdacs = false } = {}) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const reply = (body, type = 'json') => ({ ok: true, status: 200, json: async () => body, text: async () => (type === 'json' ? JSON.stringify(body) : body) });
    if (url.includes('earthquake.usgs.gov')) return reply(USGS);
    if (url.includes('gdacs.org')) return failGdacs ? { ok: false, status: 503 } : reply(GDACS);
    if (url.includes('rss_india.xml')) return reply(RSS, 'text');
    if (url.includes('identifier=111')) return reply(cap('Flood', 'Severe', 'Kamrup district of Assam'), 'text');
    if (url.includes('identifier=222')) return reply(cap('Lightning', 'Severe', '6 Mandals', 'IMD-Amaravati'), 'text');
    return { ok: false, status: 404 };
  };
  fn.calls = calls;
  return fn;
}

describe('India boundary', () => {
  it('accepts Indian locations and rejects neighbours', () => {
    expect(pointInIndia(28.61, 77.21)).toBe(true); // Delhi
    expect(pointInIndia(11.62, 92.73)).toBe(true); // Port Blair
    expect(pointInIndia(27.7, 85.32)).toBe(false); // Kathmandu
    expect(pointInIndia(31.55, 74.34)).toBe(false); // Lahore
  });
});

describe('feed import', () => {
  it('imports India-only events from all three feeds, de-duplicates, and records feed health', async () => {
    const fetchImpl = fakeFetch({ failGdacs: true });
    const first = await runFeeds({ fetchImpl, announce: false });
    expect(first.summary.USGS).toMatchObject({ ok: true, received: 2, created: 2 });
    expect(first.summary.NDMA_SACHET).toMatchObject({ ok: true, received: 2, created: 2 });
    expect(first.summary.GDACS.ok).toBe(false);
    const events = await prisma.hazardFeedEvent.findMany();
    expect(events.find((e) => e.externalId === 'us-nepal-1')).toBeUndefined();

    const flood = events.find((e) => e.externalId === '111');
    expect(flood).toMatchObject({ source: 'NDMA_SACHET', hazardType: 'FLOOD', severity: 'RED', isOfficial: true, state: 'Assam', instruction: 'Move to higher ground.' });
    expect(flood.areaDescription).toContain('Kamrup district of Assam');

    // Second run: nothing duplicated; known CAP documents are not downloaded again; GDACS recovers.
    const ok = fakeFetch();
    const second = await runFeeds({ fetchImpl: ok, announce: false });
    expect(second.summary.USGS.created).toBe(0);
    expect(second.summary.GDACS).toMatchObject({ ok: true, created: 1 });
    expect(ok.calls.some((u) => u.includes('identifier=111'))).toBe(false);
    expect(await prisma.hazardFeedEvent.count()).toBe(5);

    const status = await api().get('/api/v1/hazards/status');
    expect(status.body.data.every((s) => s.healthy)).toBe(true);
  });

  it('serves the public list with filters, near-me distance and pop-up flags', async () => {
    const res = await api().get('/api/v1/hazards?sinceHours=24');
    expect(res.status).toBe(200);
    expect(res.body.meta.region).toBe('India');
    const titles = res.body.data.map((e) => e.title);
    expect(titles).toContain('Earthquake M5.2');
    expect(titles).not.toContain('Earthquake M4.6'); // 3 days old, outside the 24 h window
    const quake = res.body.data.find((e) => e.title === 'Earthquake M5.2');
    expect(quake).toMatchObject({ hazardType: 'EARTHQUAKE', severity: 'HIGH', popup: true, latitude: 30.7 });

    const lightning = res.body.data.find((e) => e.hazardType === 'LIGHTNING');
    expect(lightning.popup).toBe(false); // severe lightning is listed but does not interrupt every screen
    expect(lightning.state).toBe('Andhra Pradesh'); // taken from the RSS author (state SDMA), not the IMD sender

    const near = await api().get('/api/v1/hazards?latitude=30.3&longitude=78.0&radiusKm=100');
    expect(near.body.data.map((e) => e.title)).toEqual(['Earthquake M5.2']);
    expect(near.body.data[0].distanceKm).toBeGreaterThan(0);

    const floods = await api().get('/api/v1/hazards?type=FLOOD&minSeverity=RED');
    expect(floods.body.data.map((e) => e.source).sort()).toEqual(['GDACS', 'NDMA_SACHET']);
  });

  it('lets coordinators turn a mapped event into a disaster zone, once', async () => {
    const quake = await prisma.hazardFeedEvent.findFirst({ where: { externalId: 'us-india-1' } });
    expect((await api().post(`/api/v1/hazards/${quake.id}/zone`).set(auth(f.tokens.citizen)).send({})).status).toBe(403);
    const res = await api().post(`/api/v1/hazards/${quake.id}/zone`).set(auth(f.tokens.coord)).send({ radiusKm: 40 });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ hazardType: 'EARTHQUAKE', centerLat: 30.7, radiusKm: 40, source: 'USGS live feed', isVerified: false });
    expect((await api().post(`/api/v1/hazards/${quake.id}/zone`).set(auth(f.tokens.coord)).send({})).status).toBe(409);
    const unmapped = await prisma.hazardFeedEvent.findFirst({ where: { externalId: '111' } });
    expect((await api().post(`/api/v1/hazards/${unmapped.id}/zone`).set(auth(f.tokens.coord)).send({})).status).toBe(400);
    expect((await api().post('/api/v1/hazards/refresh').set(auth(f.tokens.citizen))).status).toBe(403);
  });
});

describe('alert rules', () => {
  it('ignores CAP test/exercise messages and decides pop-ups by impact', () => {
    expect(parseCap(cap('Flood', 'Severe', 'x').replace('<cap:status>Actual</cap:status>', '<cap:status>Exercise</cap:status>'))).toBeNull();
    expect(popupWorthy({ source: 'NDMA_SACHET', hazardType: 'CYCLONE', severity: 'RED' })).toBe(true);
    expect(popupWorthy({ source: 'NDMA_SACHET', hazardType: 'THUNDERSTORM', severity: 'RED' })).toBe(false);
    expect(popupWorthy({ source: 'NDMA_SACHET', hazardType: 'THUNDERSTORM', severity: 'HYPER_RED' })).toBe(true);
    expect(popupWorthy({ source: 'USGS', hazardType: 'EARTHQUAKE', severity: 'NORMAL', magnitude: 4.0 })).toBe(false);
    expect(popupWorthy({ source: 'GDACS', hazardType: 'DROUGHT', severity: 'NORMAL' })).toBe(false);
  });
});
