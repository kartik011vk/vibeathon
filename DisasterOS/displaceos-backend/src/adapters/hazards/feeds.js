// Live hazard feed adapters, limited to India. Each returns normalised events:
//   { source, externalId, hazardType, title, areaDescription, state, latitude, longitude, severity, sourceSeverity,
//     magnitude, isOfficial, startsAt, expiresAt, sourceUrl, instruction }
// `fetchImpl` is injectable so tests run on recorded fixtures without network access.
import { XMLParser } from 'fast-xml-parser';
import { INDIA_BBOX, inIndiaBbox, pointInIndia } from './india.js';

const UA = { 'User-Agent': 'DisplaceOS/1.0 (disaster relief coordination)', Accept: '*/*' };
const TIMEOUT_MS = 20000;

async function get(fetchImpl, url, as = 'json') {
  const res = await fetchImpl(url, { headers: UA, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}`);
  return as === 'json' ? res.json() : res.text();
}

const isoDay = (msAgo) => new Date(Date.now() - msAgo).toISOString().slice(0, 10);

// ─── USGS earthquakes ─────────────────────────────────────────────────────
const PAGER = { green: 'NORMAL', yellow: 'HIGH', orange: 'RED', red: 'HYPER_RED' };
function quakeSeverity(mag, pagerAlert) {
  if (pagerAlert && PAGER[pagerAlert]) return PAGER[pagerAlert];
  if (mag >= 6.5) return 'HYPER_RED';
  if (mag >= 5.5) return 'RED';
  if (mag >= 4.5) return 'HIGH';
  return 'NORMAL';
}

export const usgs = {
  source: 'USGS',
  label: 'USGS earthquakes',
  async fetchEvents({ fetchImpl = fetch } = {}) {
    const url =
      'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&orderby=time' +
      `&starttime=${isoDay(7 * 86400000)}&minmagnitude=3` +
      `&minlatitude=${INDIA_BBOX.minLat}&maxlatitude=${INDIA_BBOX.maxLat}&minlongitude=${INDIA_BBOX.minLng}&maxlongitude=${INDIA_BBOX.maxLng}`;
    const data = await get(fetchImpl, url);
    return data.features
      .filter((f) => {
        const [lng, lat] = f.geometry.coordinates;
        return pointInIndia(lat, lng) || /\bIndia\b/i.test(f.properties.place ?? '');
      })
      .map((f) => {
        const p = f.properties;
        const [lng, lat, depth] = f.geometry.coordinates;
        const mag = Math.round(p.mag * 10) / 10;
        return {
          source: 'USGS',
          externalId: f.id,
          hazardType: 'EARTHQUAKE',
          title: `Earthquake M${mag}${p.tsunami ? ' (tsunami flag)' : ''}`,
          areaDescription: `${p.place ?? 'India region'}${Number.isFinite(depth) ? ` · depth ${Math.round(depth)} km` : ''}`,
          state: null,
          latitude: lat,
          longitude: lng,
          severity: quakeSeverity(mag, p.alert),
          sourceSeverity: `M${mag}${p.alert ? ` · PAGER ${p.alert}` : ''}`,
          magnitude: mag,
          isOfficial: false,
          startsAt: new Date(p.time),
          expiresAt: null,
          sourceUrl: p.url,
          instruction: null,
        };
      });
  },
};

// ─── GDACS multi-hazard ───────────────────────────────────────────────────
const GDACS_TYPES = { EQ: 'EARTHQUAKE', FL: 'FLOOD', TC: 'CYCLONE', DR: 'DROUGHT', VO: 'VOLCANO', WF: 'WILDFIRE', TS: 'TSUNAMI' };
const GDACS_LEVEL = { Green: 'NORMAL', Orange: 'RED', Red: 'HYPER_RED' };
// GDACS times are UTC without a zone suffix.
const gdacsDate = (s) => (s ? new Date(/Z$|[+-]\d\d:\d\d$/.test(s) ? s : `${s}Z`) : null);

export const gdacs = {
  source: 'GDACS',
  label: 'GDACS (UN / EU disaster alerts)',
  async fetchEvents({ fetchImpl = fetch } = {}) {
    const url = `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?country=India&fromdate=${isoDay(45 * 86400000)}`;
    const data = await get(fetchImpl, url);
    return (data.features ?? [])
      .filter((f) => {
        const p = f.properties;
        const [lng, lat] = f.geometry?.coordinates ?? [];
        return (p.affectedcountries ?? []).some((c) => c.iso3 === 'IND') || p.iso3 === 'IND' || pointInIndia(lat, lng);
      })
      .map((f) => {
        const p = f.properties;
        const [lng, lat] = f.geometry.coordinates;
        const ended = p.iscurrent === 'false' || p.iscurrent === false;
        const sev = p.severitydata?.severitytext?.trim();
        return {
          source: 'GDACS',
          externalId: `${p.eventtype}-${p.eventid}`,
          hazardType: GDACS_TYPES[p.eventtype] ?? 'OTHER',
          title: p.name || p.description || 'GDACS event in India',
          areaDescription: p.htmldescription || p.description || null,
          state: null,
          latitude: inIndiaBbox(lat, lng) ? lat : null,
          longitude: inIndiaBbox(lat, lng) ? lng : null,
          severity: GDACS_LEVEL[p.alertlevel || p.episodealertlevel] ?? 'NORMAL',
          sourceSeverity: `${p.alertlevel} alert${sev && !/^Magnitude 0/.test(sev) ? ` · ${sev}` : ''}`,
          magnitude: null,
          isOfficial: false,
          startsAt: gdacsDate(p.fromdate) ?? new Date(),
          expiresAt: ended ? gdacsDate(p.todate) : null,
          sourceUrl: p.url?.report ?? null,
          instruction: null,
        };
      });
  },
};

// ─── NDMA SACHET (official, Government of India CAP feed) ─────────────────
const CAP_SEVERITY = { Extreme: 'HYPER_RED', Severe: 'RED', Moderate: 'HIGH', Minor: 'NORMAL' };
const SACHET_TYPES = [
  [/earthquake/i, 'EARTHQUAKE'],
  [/tsunami/i, 'TSUNAMI'],
  [/cyclone|depression|storm surge/i, 'CYCLONE'],
  [/flood|inundation|dam/i, 'FLOOD'],
  [/landslide|avalanche|mudslide/i, 'LANDSLIDE'],
  [/thunder/i, 'THUNDERSTORM'],
  [/lightning/i, 'LIGHTNING'],
  [/heavy rain|rainfall|cloudburst|rain/i, 'HEAVY_RAIN'],
  [/heat ?wave|hot/i, 'HEATWAVE'],
  [/cold ?wave|frost|snow/i, 'COLD_WAVE'],
  [/fire/i, 'WILDFIRE'],
  [/drought/i, 'DROUGHT'],
];
const sachetType = (event) => SACHET_TYPES.find(([re]) => re.test(event ?? ''))?.[1] ?? 'OTHER';
const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, trimValues: true });
const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

function stateFrom(sender, author) {
  const fromAuthor = /\(([^)]+?)\s*(?:SDMA|State Disaster)/i.exec(author ?? '')?.[1];
  const fromSender = /^(.+?)-SDMA$/i.exec(sender ?? '')?.[1];
  const s = fromAuthor ?? fromSender ?? null;
  // "Andhra-Pradesh" and "Andhra Pradesh" are the same state.
  return s && !/^(IMD|NDMA|INCOIS|CWC|GSI)/i.test(s) ? s.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() : null;
}

// One-word CAP event names read better with context: "Lightning" → "Lightning warning",
// "Squally" (an adjective) → "Squally weather warning".
const HAZARD_NOUNS = /^(lightning|flood|floods|cyclone|earthquake|thunderstorm|heatwave|landslide|tsunami|rain|rainfall|snowfall|avalanche|cloudburst|drought|fog|hailstorm|duststorm)$/i;
export function capTitle(raw) {
  if (raw.split(/\s+/).length > 1 || /warning|alert|watch/i.test(raw)) return raw;
  return HAZARD_NOUNS.test(raw) ? `${raw} warning` : `${raw} weather warning`;
}

export function parseCap(xml, { link, author, id } = {}) {
  const alert = parser.parse(xml).alert;
  if (!alert || alert.status !== 'Actual') return null;
  const infos = asArray(alert.info);
  const info = infos.find((i) => /^en/i.test(i.language ?? '')) ?? infos[0];
  if (!info) return null;
  const areas = asArray(info.area);
  const rawEvent = String(info.event ?? 'Alert').trim();
  const event = capTitle(rawEvent);
  return {
    source: 'NDMA_SACHET',
    externalId: String(id ?? alert.identifier),
    hazardType: sachetType(rawEvent),
    title: event,
    areaDescription: [String(info.headline ?? '').trim(), areas.map((a) => a.areaDesc).filter(Boolean).join('; ')].filter(Boolean).join(' — ') || null,
    state: stateFrom(alert.sender, author),
    latitude: null,
    longitude: null,
    severity: CAP_SEVERITY[info.severity] ?? 'NORMAL',
    sourceSeverity: [info.severity, info.urgency, info.certainty].filter(Boolean).join(' · '),
    magnitude: null,
    isOfficial: true,
    startsAt: new Date(info.effective ?? info.onset ?? alert.sent),
    expiresAt: info.expires ? new Date(info.expires) : null,
    sourceUrl: link ?? null,
    instruction: info.instruction ? String(info.instruction) : null,
    cancelled: alert.msgType === 'Cancel',
  };
}

export const sachet = {
  source: 'NDMA_SACHET',
  label: 'NDMA SACHET (Government of India)',
  // Only CAP documents for identifiers not seen before are downloaded, at most `maxNew` per run.
  async fetchEvents({ fetchImpl = fetch, knownIds = new Set(), maxNew = 40 } = {}) {
    const rss = parser.parse(await get(fetchImpl, 'https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml', 'text'));
    const items = asArray(rss.rss?.channel?.item);
    const idOf = (it) => String(it.guid?.['#text'] ?? it.guid ?? '');
    const fresh = items.filter((it) => idOf(it) && !knownIds.has(idOf(it)));
    const out = [];
    const queue = fresh.slice(0, maxNew);
    const worker = async () => {
      while (queue.length) {
        const it = queue.shift();
        try {
          const xml = await get(fetchImpl, it.link, 'text');
          const ev = parseCap(xml, { link: it.link, author: it.author, id: idOf(it) });
          if (ev) out.push(ev);
        } catch {
          // One unreachable CAP document must not stop the rest of the feed.
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return out;
  },
};

export const FEEDS = [sachet, usgs, gdacs];
