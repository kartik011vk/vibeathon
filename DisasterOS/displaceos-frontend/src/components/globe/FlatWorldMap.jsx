// 2D fallback: the same Natural Earth geography as an SVG equirectangular map with keyboard-accessible markers.
// Used when WebGL is unavailable, when the user prefers reduced motion, or when chosen manually.
import { useEffect, useState } from 'react';
import { loadWorld, polygonsOf, unwrapRing } from './worldData.js';
import { MARKER_KINDS } from './markers.js';

const W = 1000;
const H = 500;
const px = (lng, lat) => [((lng + 180) / 360) * W, ((90 - lat) / 180) * H];

function ringPath(ring) {
  return (
    unwrapRing(ring)
      .map(([lng, lat], i) => {
        const [x, y] = px(lng, lat);
        return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join('') + 'Z'
  );
}

export default function FlatWorldMap({ clusters, selectedId, onSelect }) {
  const [paths, setPaths] = useState(null);
  useEffect(() => {
    let alive = true;
    loadWorld().then((w) => {
      if (!alive) return;
      setPaths(w.land.features.flatMap((f) => polygonsOf(f.geometry).map((poly) => poly.map(ringPath).join(''))));
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <svg className="flat-map" viewBox={`0 0 ${W} ${H}`} role="group" aria-label="World map of relief locations">
      <title>World map showing DisplaceOS locations</title>
      {paths?.map((d, i) => (
        <path key={i} d={d} fill="#f4ae37" fillRule="evenodd" stroke="#663e23" strokeWidth="0.4" />
      ))}
      {!paths && (
        <text x={W / 2} y={H / 2} textAnchor="middle" fill="#ffefcf" fontSize="18">
          Loading map…
        </text>
      )}
      {clusters.map((c) => {
        const [x, y] = px(c.longitude, c.latitude);
        const selected = c.id === selectedId;
        return (
          <g
            key={c.id}
            tabIndex={0}
            role="button"
            aria-label={`${c.items.length} place${c.items.length > 1 ? 's' : ''}: ${c.items.map((m) => m.label).join(', ')}`}
            aria-pressed={selected}
            onClick={() => onSelect(c)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(c))}
            style={{ cursor: 'pointer' }}
          >
            <circle cx={x} cy={y} r={selected ? 11 : 8} fill={MARKER_KINDS[c.kind].color} stroke="#2d221b" strokeWidth="2.5" />
            {c.items.length > 1 && (
              <text x={x} y={y + 4} textAnchor="middle" fontSize="10" fontWeight="700" fill="#2d221b">
                {c.items.length}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
