// Genuine WebGL Earth (three.js via React Three Fiber), styled like a warm map app:
//   - land painted from Natural Earth 1:50m countries, each country in one of several warm tones
//   - crisp vector coastlines and country borders; state/province borders fade in as you zoom
//   - place names with level of detail: big countries when far away, more countries and cities when zoomed in,
//     never overlapping and hidden behind the horizon
//   - zoom with the buttons, pinch, or Ctrl/⌘ + scroll (plain scrolling always scrolls the page)
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { lineSegmentPositions, loadAdmin1, loadDetailedWorld, loadPlaces, polygonsOf, unwrapRing } from './worldData.js';
import { latLngToVec, MARKER_KINDS, rotationFor } from './markers.js';

export const DIST = { default: 3.05, min: 1.14, max: 3.4 };
const W = 4096;
const H = 2048;
const px = (lng, lat) => [((lng + 180) / 360) * W, ((90 - lat) / 180) * H];
const LAND_TONES = ['#f4ae37', '#f0a23a', '#f6bb55', '#eb9a44', '#f2b347'];

function paintEarth(world) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const sea = ctx.createLinearGradient(0, 0, 0, H);
  sea.addColorStop(0, '#3a2a1f');
  sea.addColorStop(0.5, '#563c2a');
  sea.addColorStop(1, '#3a2a1f');
  ctx.fillStyle = sea;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(255, 239, 207, 0.06)';
  ctx.lineWidth = 1.5;
  for (let lng = -180; lng <= 180; lng += 15) {
    const [x] = px(lng, 0);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let lat = -75; lat <= 75; lat += 15) {
    const [, y] = px(0, lat);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  world.countries.features.forEach((f, idx) => {
    ctx.fillStyle = LAND_TONES[idx % LAND_TONES.length];
    for (const poly of polygonsOf(f.geometry)) {
      for (const shift of [-360, 0, 360]) {
        ctx.beginPath();
        for (const ring of poly) {
          unwrapRing(ring).forEach(([lng, lat], i) => {
            const [x, y] = px(lng + shift, lat);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.closePath();
        }
        ctx.fill('evenodd');
      }
    }
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

const atmosphereMaterial = () =>
  new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    uniforms: { glow: { value: new THREE.Color('#f4ae37') } },
    vertexShader: `varying vec3 vNormal; void main(){ vNormal = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 glow; varying vec3 vNormal; void main(){ float i = pow(0.72 - dot(vNormal, vec3(0.0,0.0,1.0)), 3.0); gl_FragColor = vec4(glow, 1.0) * i; }`,
  });

function Lines({ positions, color, opacity, radius = 1 }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return g;
  }, [positions]);
  return (
    <lineSegments geometry={geometry} scale={radius}>
      <lineBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
    </lineSegments>
  );
}

function AdminLines() {
  const [positions, setPositions] = useState(null);
  const ref = useRef();
  const { camera } = useThree();
  const requested = useRef(false);
  useFrame(() => {
    const d = camera.position.z;
    if (!requested.current && d < 2.3) {
      requested.current = true;
      loadAdmin1().then((lines) => setPositions(lineSegmentPositions(lines, 1.0025, latLngToVec)));
    }
    if (ref.current) {
      const o = THREE.MathUtils.clamp((2.15 - d) / 0.5, 0, 1) * 0.55;
      ref.current.material.opacity = o;
      ref.current.visible = o > 0.01;
    }
  });
  const geometry = useMemo(() => {
    if (!positions) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return g;
  }, [positions]);
  if (!geometry) return null;
  return (
    <lineSegments ref={ref} geometry={geometry}>
      <lineBasicMaterial color="#663e23" transparent opacity={0} depthWrite={false} />
    </lineSegments>
  );
}

function Marker({ cluster, selected, onSelect }) {
  const group = useRef();
  const ring = useRef();
  const pos = useMemo(() => latLngToVec(cluster.latitude, cluster.longitude, 1.004), [cluster.latitude, cluster.longitude]);
  const color = MARKER_KINDS[cluster.kind].color;
  const size = 0.02 + Math.min(cluster.items.length, 6) * 0.003;
  const [hovered, setHovered] = useState(false);
  const normal = useMemo(() => new THREE.Vector3(...pos).normalize(), [pos]);
  const quaternion = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal), [normal]);

  useFrame(({ clock, camera }) => {
    // Keep markers a similar size on screen at any zoom.
    const s = Math.max(0.12, (camera.position.z - 1) / (DIST.default - 1)) * (selected || hovered ? 1.45 : 1);
    group.current?.scale.setScalar(s);
    if (ring.current) {
      const t = (clock.elapsedTime * 0.6) % 1;
      ring.current.scale.setScalar(1 + t * 2.2);
      ring.current.material.opacity = 0.7 * (1 - t);
    }
  });

  return (
    <group position={pos} quaternion={quaternion}>
      <group ref={group}>
        <mesh
          onClick={(e) => {
            e.stopPropagation();
            onSelect(cluster);
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            setHovered(true);
            document.body.style.cursor = 'pointer';
          }}
          onPointerOut={() => {
            setHovered(false);
            document.body.style.cursor = '';
          }}
        >
          <sphereGeometry args={[size, 16, 16]} />
          <meshBasicMaterial color={color} />
        </mesh>
        <mesh>
          <ringGeometry args={[size * 1.15, size * 1.45, 32]} />
          <meshBasicMaterial color="#2d221b" transparent opacity={0.7} side={THREE.DoubleSide} />
        </mesh>
        {(cluster.kind === 'zone' || selected) && (
          <mesh ref={ring}>
            <ringGeometry args={[size * 1.2, size * 1.5, 40]} />
            <meshBasicMaterial color={cluster.kind === 'zone' ? '#dd6f25' : '#f4ae37'} transparent opacity={0.6} side={THREE.DoubleSide} />
          </mesh>
        )}
      </group>
    </group>
  );
}

// Natural Earth draws some disputed areas as separate polygons; they are not labelled as countries here.
const UNLABELLED = new Set(['Siachen Glacier']);

// Level of detail: which labels are eligible at a given camera distance.
function lod(d) {
  if (d > 2.7) return { minArea: 1_400_000, cityRank: -1, maxLabels: 22 };
  if (d > 2.2) return { minArea: 380_000, cityRank: 1, maxLabels: 40 };
  if (d > 1.75) return { minArea: 60_000, cityRank: 3, maxLabels: 60 };
  if (d > 1.45) return { minArea: 8_000, cityRank: 5, maxLabels: 80 };
  if (d > 1.25) return { minArea: 0, cityRank: 7, maxLabels: 100 };
  return { minArea: 0, cityRank: 10, maxLabels: 120 };
}

// Projects place names to screen space every other frame and writes them into a pooled DOM layer.
function LabelLayer({ layerRef, globeRef, pinned }) {
  const { camera, size } = useThree();
  const [data, setData] = useState(null);
  const pool = useRef([]);
  const frame = useRef(0);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    let alive = true;
    loadPlaces().then((p) => {
      if (!alive) return;
      setData({
        countries: p.countries.filter(([name]) => !UNLABELLED.has(name)).map(([name, lat, lng, area]) => ({ name, area, kind: 'country', base: new THREE.Vector3(...latLngToVec(lat, lng, 1.004)) })),
        cities: p.cities.map(([name, lat, lng, rank, , capital]) => ({ name, rank, capital, kind: 'city', base: new THREE.Vector3(...latLngToVec(lat, lng, 1.004)) })),
      });
    });
    return () => {
      alive = false;
    };
  }, []);

  useFrame(() => {
    frame.current += 1;
    const layer = layerRef.current;
    if (!layer || !data || !globeRef.current || frame.current % 2) return;
    const d = camera.position.z;
    const { minArea, cityRank, maxLabels } = lod(d);
    const m = globeRef.current.matrixWorld;
    const horizon = 1 / d + 0.04;
    const placed = [];
    const out = [];

    const consider = (item, priority) => {
      if (out.length >= maxLabels) return;
      tmp.copy(item.base).applyMatrix4(m);
      if (tmp.z / tmp.length() < horizon) return;
      tmp.project(camera);
      const x = ((tmp.x + 1) / 2) * size.width;
      const y = ((1 - tmp.y) / 2) * size.height;
      if (x < 0 || y < 0 || x > size.width || y > size.height) return;
      const country = item.kind === 'country';
      const big = country && (item.area > 2_000_000 || (d < 1.75 && item.area > 300_000));
      const fs = country ? (big ? 12 : 10.5) : item.capital === 2 || item.rank <= 1 ? 11.5 : 10.5;
      const w = item.name.length * fs * (country ? 0.72 : 0.56) + (country ? 0 : 10);
      const h = fs + 4;
      const box = country ? [x - w / 2, y - h / 2, x + w / 2, y + h / 2] : [x - 4, y - h / 2, x + w, y + h / 2];
      for (const b of placed) if (box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]) return;
      placed.push(box);
      out.push({ item, x, y, fs, big, priority });
    };

    // A place the user searched for is always labelled first.
    if (pinned?.name) {
      if (!pinned.base) pinned.base = new THREE.Vector3(...latLngToVec(pinned.latitude, pinned.longitude, 1.004));
      consider({ name: pinned.name, kind: 'city', capital: 0, rank: 0, pinned: true, base: pinned.base });
    }
    // Capitals and major cities first when zoomed in; large countries first when zoomed out.
    const countryFirst = d > 1.9;
    const countries = data.countries.filter((c) => c.area >= minArea);
    const cities = cityRank >= 0 ? data.cities.filter((c) => c.rank <= cityRank) : [];
    if (countryFirst) {
      countries.forEach((c) => consider(c));
      cities.forEach((c) => consider(c));
    } else {
      cities.filter((c) => c.capital === 2 || c.rank <= 2).forEach((c) => consider(c));
      countries.filter((c) => c.area > 150_000).forEach((c) => consider(c));
      cities.filter((c) => !(c.capital === 2 || c.rank <= 2)).forEach((c) => consider(c));
      countries.filter((c) => c.area <= 150_000).forEach((c) => consider(c));
    }

    while (pool.current.length < out.length) {
      const el = document.createElement('span');
      layer.appendChild(el);
      pool.current.push(el);
    }
    pool.current.forEach((el, i) => {
      const o = out[i];
      if (!o) {
        if (el.style.display !== 'none') el.style.display = 'none';
        return;
      }
      const cls = o.item.kind === 'country' ? `glabel country${o.big ? ' big' : ''}` : `glabel city${o.item.capital === 2 ? ' capital' : ''}${o.item.pinned ? ' pinned' : ''}`;
      if (el.className !== cls) el.className = cls;
      if (el.textContent !== o.item.name) el.textContent = o.item.name;
      el.style.display = '';
      el.style.fontSize = `${o.fs}px`;
      el.style.transform = o.item.kind === 'country' ? `translate(${o.x}px, ${o.y}px) translate(-50%, -50%)` : `translate(${o.x - 3}px, ${o.y}px) translate(0, -50%)`;
    });
  });
  return null;
}

function Earth({ clusters, selectedId, onSelect, focus, autoRotate, dragState, zoomState, layerRef, onZoomBucket }) {
  const group = useRef();
  const [texture, setTexture] = useState(null);
  const [lines, setLines] = useState(null);
  const { invalidate, camera } = useThree();
  const target = useRef(null);
  const lastBucket = useRef(null);
  const atmosphere = useMemo(atmosphereMaterial, []);

  useEffect(() => {
    let alive = true;
    loadDetailedWorld().then((world) => {
      if (!alive) return;
      setTexture(paintEarth(world));
      setLines({
        coast: lineSegmentPositions(world.coast.coordinates, 1.0015, latLngToVec),
        borders: lineSegmentPositions(world.borders.coordinates, 1.0018, latLngToVec),
      });
      invalidate();
    });
    return () => {
      alive = false;
    };
  }, [invalidate]);

  useEffect(() => {
    if (!focus) return;
    target.current = rotationFor(focus.latitude, focus.longitude);
    if (focus.distance) zoomState.current.target = focus.distance;
  }, [focus, zoomState]);

  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    // Zoom easing
    const z = zoomState.current;
    z.target = THREE.MathUtils.clamp(z.target, DIST.min, DIST.max);
    camera.position.z += (z.target - camera.position.z) * Math.min(1, delta * 6);
    const d = camera.position.z;
    const bucket = d > 2.6 ? 0 : d > 2.0 ? 1 : d > 1.55 ? 2 : d > 1.3 ? 3 : 4;
    if (bucket !== lastBucket.current) {
      lastBucket.current = bucket;
      onZoomBucket?.(bucket);
    }
    const speed = (d - 1) / (DIST.default - 1);

    const drag = dragState.current;
    if (drag.dx || drag.dy) {
      target.current = null;
      g.rotation.y += drag.dx * 0.006 * speed;
      g.rotation.x = THREE.MathUtils.clamp(g.rotation.x + drag.dy * 0.004 * speed, -1.35, 1.35);
      drag.dx = 0;
      drag.dy = 0;
    } else if (target.current) {
      let dy = target.current.y - g.rotation.y;
      dy = ((((dy + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
      g.rotation.y += dy * Math.min(1, delta * 3);
      g.rotation.x += (target.current.x - g.rotation.x) * Math.min(1, delta * 3);
      if (Math.abs(dy) < 0.001 && Math.abs(target.current.x - g.rotation.x) < 0.001) target.current = null;
    } else if (autoRotate && !drag.active && d > 2.6) {
      g.rotation.y += delta * 0.07;
    }
  });

  return (
    <>
      <mesh material={atmosphere} scale={1.13}>
        <sphereGeometry args={[1, 64, 64]} />
      </mesh>
      <group ref={group} rotation={[0.45, -2.85, 0]}>
        <mesh>
          <sphereGeometry args={[1, 128, 128]} />
          {/* Keyed so three.js compiles a new shader once the map exists (adding a map to a live material does not). */}
          {texture ? (
            <meshStandardMaterial key="textured" map={texture} roughness={0.92} metalness={0} />
          ) : (
            <meshStandardMaterial key="plain" color="#4a3426" roughness={1} />
          )}
        </mesh>
        {lines && (
          <>
            <Lines positions={lines.coast} color="#4a2d18" opacity={0.55} />
            <Lines positions={lines.borders} color="#4a2d18" opacity={0.85} />
          </>
        )}
        <AdminLines />
        {clusters.map((c) => (
          <Marker key={c.id} cluster={c} selected={c.id === selectedId} onSelect={onSelect} />
        ))}
      </group>
      <LabelLayer layerRef={layerRef} globeRef={group} pinned={focus?.name ? focus : null} />
    </>
  );
}

export default function Globe3D({ clusters, selectedId, onSelect, focus, autoRotate = true, controlRef, onZoomBucket }) {
  const dragState = useRef({ active: false, x: 0, y: 0, dx: 0, dy: 0, moved: 0 });
  const zoomState = useRef({ target: DIST.default });
  const pointers = useRef(new Map());
  const pinch = useRef(null);
  const layerRef = useRef(null);
  const boxRef = useRef(null);
  const [hint, setHint] = useState(false);

  useEffect(() => {
    if (controlRef) {
      controlRef.current = {
        rotate: (px) => (dragState.current.dx += px),
        zoomBy: (f) => (zoomState.current.target *= f),
        resetZoom: () => (zoomState.current.target = DIST.default),
      };
    }
  }, [controlRef]);

  // Ctrl/⌘ + wheel zooms; a plain wheel keeps scrolling the page (never trapped).
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    let timer;
    const onWheel = (e) => {
      if (!(e.ctrlKey || e.metaKey)) {
        setHint(true);
        clearTimeout(timer);
        timer = setTimeout(() => setHint(false), 1400);
        return;
      }
      e.preventDefault();
      zoomState.current.target *= Math.exp(e.deltaY * 0.0015);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      clearTimeout(timer);
    };
  }, []);

  const handlers = {
    onPointerDown: (e) => {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const d = dragState.current;
      d.active = true;
      d.x = e.clientX;
      d.y = e.clientY;
      d.moved = 0;
      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), start: zoomState.current.target };
      }
    },
    onPointerMove: (e) => {
      if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch.current && pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        zoomState.current.target = pinch.current.start * (pinch.current.dist / Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)));
        dragState.current.moved += 10;
        return;
      }
      const d = dragState.current;
      if (!d.active) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      d.dx += dx;
      d.dy += dy;
      d.moved += Math.abs(dx) + Math.abs(dy);
      d.x = e.clientX;
      d.y = e.clientY;
    },
    onPointerUp: (e) => {
      pointers.current.delete(e.pointerId);
      if (pointers.current.size < 2) pinch.current = null;
      if (!pointers.current.size) dragState.current.active = false;
    },
    onPointerLeave: (e) => {
      pointers.current.delete(e.pointerId);
      pinch.current = null;
      dragState.current.active = false;
    },
  };

  return (
    <div ref={boxRef} style={{ position: 'relative', width: '100%', height: '100%' }} {...handlers}>
      <Canvas
        camera={{ position: [0, 0, DIST.default], fov: 42, near: 0.01 }}
        dpr={[1, 2]}
        flat
        gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
        onPointerMissed={() => onSelect(null)}
        aria-label="Interactive 3D Earth with country borders, place names and relief locations"
        role="img"
      >
        <ambientLight intensity={1.15} color="#fff3e0" />
        <directionalLight position={[-3, 2.5, 4]} intensity={1.6} color="#fff1d6" />
        <directionalLight position={[3, -1, -2]} intensity={0.35} color="#f4ae37" />
        <Earth
          clusters={clusters}
          selectedId={selectedId}
          onSelect={(c) => dragState.current.moved < 6 && onSelect(c)}
          focus={focus}
          autoRotate={autoRotate}
          dragState={dragState}
          zoomState={zoomState}
          layerRef={layerRef}
          onZoomBucket={onZoomBucket}
        />
      </Canvas>
      <div ref={layerRef} className="globe-labels" aria-hidden="true" />
      {hint && <div className="globe-hint">Hold Ctrl (⌘ on Mac) and scroll to zoom</div>}
    </div>
  );
}
