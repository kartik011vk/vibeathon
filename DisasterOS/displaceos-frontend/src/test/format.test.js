import { describe, expect, it } from 'vitest';
import { distanceLabel, REQUEST_STATUS, SEVERITY } from '../lib/format.js';
import { haversineKm, parseCoordinate, validPoint } from '../lib/geo.js';
import { clusterMarkers, latLngToVec, rotationFor } from '../components/globe/markers.js';

describe('distance labelling', () => {
  it('always labels distance as approximate straight-line', () => {
    expect(distanceLabel(4.26)).toBe('approx. 4.3 km away (straight-line distance)');
    expect(distanceLabel(34.1)).toBe('approx. 34 km away (straight-line distance)');
  });
  it('says "Distance unavailable" when distance cannot be computed', () => {
    expect(distanceLabel(null)).toBe('Distance unavailable');
    expect(distanceLabel(undefined)).toBe('Distance unavailable');
    expect(distanceLabel(NaN)).toBe('Distance unavailable');
  });
  it('only computes distance between two valid points', () => {
    expect(haversineKm({ latitude: 30.311, longitude: 78.089 }, { latitude: 30.37, longitude: 77.87 })).toBeCloseTo(22, 0);
    expect(haversineKm({ latitude: 30.3, longitude: 78 }, { latitude: null, longitude: 78 })).toBeNull();
    expect(validPoint({ latitude: 91, longitude: 0 })).toBe(false);
    expect(parseCoordinate('200', 'lng')).toBeNull();
    expect(parseCoordinate('30.123456789', 'lat')).toBe(30.123457);
  });
});

describe('plain-language labels match backend enums', () => {
  it('covers every severity and request status', () => {
    expect(Object.keys(SEVERITY)).toEqual(['NORMAL', 'HIGH', 'RED', 'HYPER_RED']);
    expect(SEVERITY.HYPER_RED.label).toBe('Highest priority');
    expect(Object.keys(REQUEST_STATUS).sort()).toEqual(['ALLOCATED', 'CANCELLED', 'DELIVERED', 'DISPATCHED', 'PARTIALLY_DELIVERED', 'REJECTED', 'SUBMITTED', 'VERIFIED']);
  });
});

describe('globe markers', () => {
  it('skips markers without valid coordinates and clusters nearby ones', () => {
    const clusters = clusterMarkers([
      { id: 'a', kind: 'camp', latitude: 30.31, longitude: 78.09, label: 'A' },
      { id: 'b', kind: 'zone', latitude: 30.37, longitude: 77.87, label: 'B' },
      { id: 'c', kind: 'resource', latitude: 51.5, longitude: -0.12, label: 'C' },
      { id: 'd', kind: 'resource', latitude: null, longitude: null, label: 'no coords' },
    ]);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].items.map((m) => m.id)).toEqual(['a', 'b']);
    expect(clusters[0].kind).toBe('zone');
  });
  it('rotates the globe so a point faces the camera', () => {
    const { x, y } = rotationFor(30, 78);
    const [px, py, pz] = latLngToVec(30, 78);
    // Apply Ry then Rx (three.js XYZ order) and expect the point on +Z.
    const x1 = px * Math.cos(y) + pz * Math.sin(y);
    const z1 = -px * Math.sin(y) + pz * Math.cos(y);
    const y2 = py * Math.cos(x) - z1 * Math.sin(x);
    const z2 = py * Math.sin(x) + z1 * Math.cos(x);
    expect(x1).toBeCloseTo(0, 5);
    expect(y2).toBeCloseTo(0, 5);
    expect(z2).toBeCloseTo(1, 5);
  });
});
