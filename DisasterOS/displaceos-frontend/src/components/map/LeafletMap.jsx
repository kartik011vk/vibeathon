// Real street map (OpenStreetMap tiles, warm-filtered via CSS) with DisplaceOS markers.
// Tiles need internet access; markers and lists still work if tiles fail to load.
import { useEffect } from 'react';
import { MapContainer, Marker, Popup, TileLayer, Circle, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { validPoint } from '../../lib/geo.js';

const icon = (kind) =>
  L.divIcon({
    className: '',
    html: `<div class="pin pin-${kind}"></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26],
    popupAnchor: [0, -24],
  });

function FitBounds({ points, padKey }) {
  const map = useMap();
  useEffect(() => {
    const valid = points.filter(validPoint);
    if (valid.length === 1) map.setView([valid[0].latitude, valid[0].longitude], 13);
    else if (valid.length > 1) map.fitBounds(L.latLngBounds(valid.map((p) => [p.latitude, p.longitude])), { padding: [36, 36], maxZoom: 14 });
  }, [padKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function ClickToPick({ onPick }) {
  useMapEvents({
    click: (e) => onPick?.({ latitude: Math.round(e.latlng.lat * 1e6) / 1e6, longitude: Math.round(e.latlng.lng * 1e6) / 1e6 }),
  });
  return null;
}

export default function LeafletMap({ markers = [], you, circles = [], onPick, tall, label = 'Map', fallbackCenter = [22.5, 79], fallbackZoom = 4 }) {
  const placed = markers.filter(validPoint);
  const points = [...placed, ...(validPoint(you) ? [you] : [])];
  const key = points.map((p) => `${p.latitude},${p.longitude}`).join('|');
  return (
    <div className={`map-box ${tall ? 'tall' : ''}`} role="region" aria-label={label}>
      <MapContainer center={fallbackCenter} zoom={fallbackZoom} scrollWheelZoom={false} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds points={points} padKey={key} />
        {onPick && <ClickToPick onPick={onPick} />}
        {circles.map((c) => (
          <Circle
            key={c.id}
            center={[c.latitude, c.longitude]}
            radius={c.radiusKm * 1000}
            pathOptions={{ color: '#c2561a', weight: 2, fillColor: '#dd6f25', fillOpacity: 0.12, dashArray: '6 6' }}
          />
        ))}
        {placed.map((m) => (
          <Marker key={m.id} position={[m.latitude, m.longitude]} icon={icon(m.kind ?? 'resource')} title={m.title}>
            {m.popup && <Popup>{m.popup}</Popup>}
          </Marker>
        ))}
        {validPoint(you) && (
          <Marker position={[you.latitude, you.longitude]} icon={icon('you')} title="Your chosen location">
            <Popup>Your chosen location</Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
}
