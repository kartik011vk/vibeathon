// Genuine WebGL Earth (three.js via React Three Fiber). The surface texture is painted at runtime from
// Natural Earth country polygons in the warm DisplaceOS palette, so geography is real and no blue/green is used.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { linesOf, loadWorld, polygonsOf, unwrapRing } from './worldData.js';
import { latLngToVec, MARKER_KINDS, rotationFor } from './markers.js';

const W = 2048;
const H = 1024;
const px = (lng, lat) => [((lng + 180) / 360) * W, ((90 - lat) / 180) * H];

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

  // Graticule every 15°
  ctx.strokeStyle = 'rgba(255, 239, 207, 0.07)';
  ctx.lineWidth = 1;
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

  const traceRing = (ring, shift) => {
    unwrapRing(ring).forEach(([lng, lat], i) => {
      const [x, y] = px(lng + shift, lat);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
  };

  const land = ctx.createLinearGradient(0, 0, 0, H);
  land.addColorStop(0, '#f7c46a');
  land.addColorStop(0.45, '#f4ae37');
  land.addColorStop(0.7, '#e7913a');
  land.addColorStop(1, '#f2d7a8');
  ctx.fillStyle = land;
  for (const f of world.countries.features) {
    for (const poly of polygonsOf(f.geometry)) {
      for (const shift of [-360, 0, 360]) {
        ctx.beginPath();
        poly.forEach((ring) => traceRing(ring, shift));
        ctx.fill('evenodd');
      }
    }
  }

  ctx.strokeStyle = 'rgba(102, 62, 35, 0.55)';
  ctx.lineWidth = 1.2;
  for (const line of linesOf(world.borders)) {
    for (const shift of [-360, 0, 360]) {
      ctx.beginPath();
      unwrapRing(line).forEach(([lng, lat], i) => {
        const [x, y] = px(lng + shift, lat);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
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

function Marker({ cluster, selected, onSelect }) {
  const ref = useRef();
  const ring = useRef();
  const pos = useMemo(() => latLngToVec(cluster.latitude, cluster.longitude, 1.012), [cluster.latitude, cluster.longitude]);
  const color = MARKER_KINDS[cluster.kind].color;
  const size = 0.022 + Math.min(cluster.items.length, 6) * 0.003;
  const [hovered, setHovered] = useState(false);

  useFrame(({ clock }) => {
    if (ring.current) {
      const t = (clock.elapsedTime * 0.6) % 1;
      ring.current.scale.setScalar(1 + t * 2.2);
      ring.current.material.opacity = 0.7 * (1 - t);
    }
  });

  const normal = useMemo(() => new THREE.Vector3(...pos).normalize(), [pos]);
  const quaternion = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal), [normal]);

  return (
    <group position={pos} quaternion={quaternion}>
      <mesh
        ref={ref}
        scale={selected || hovered ? 1.5 : 1}
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
        <meshBasicMaterial color="#2d221b" transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>
      {(cluster.kind === 'zone' || selected) && (
        <mesh ref={ring}>
          <ringGeometry args={[size * 1.2, size * 1.5, 40]} />
          <meshBasicMaterial color={cluster.kind === 'zone' ? '#dd6f25' : '#f4ae37'} transparent opacity={0.6} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}

function Earth({ clusters, selectedId, onSelect, focus, autoRotate, dragState }) {
  const group = useRef();
  const [texture, setTexture] = useState(null);
  const { invalidate } = useThree();
  const target = useRef(null);
  const atmosphere = useMemo(atmosphereMaterial, []);

  useEffect(() => {
    let alive = true;
    loadWorld().then((world) => {
      if (alive) {
        setTexture(paintEarth(world));
        invalidate();
      }
    });
    return () => {
      alive = false;
    };
  }, [invalidate]);

  useEffect(() => {
    if (focus) target.current = rotationFor(focus.latitude, focus.longitude);
  }, [focus]);

  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    const d = dragState.current;
    if (d.dx || d.dy) {
      target.current = null;
      g.rotation.y += d.dx * 0.006;
      g.rotation.x = THREE.MathUtils.clamp(g.rotation.x + d.dy * 0.004, -1.1, 1.1);
      d.dx = 0;
      d.dy = 0;
    } else if (target.current) {
      // Shortest-path ease towards the focused point.
      let dy = target.current.y - g.rotation.y;
      dy = ((((dy + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
      g.rotation.y += dy * Math.min(1, delta * 3);
      g.rotation.x += (target.current.x - g.rotation.x) * Math.min(1, delta * 3);
      if (Math.abs(dy) < 0.002 && Math.abs(target.current.x - g.rotation.x) < 0.002) target.current = null;
    } else if (autoRotate && !d.active) {
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
          <sphereGeometry args={[1, 96, 96]} />
          {/* Keyed so three.js compiles a new shader once the map exists (adding a map to a live material does not). */}
          {texture ? (
            <meshStandardMaterial key="textured" map={texture} roughness={0.92} metalness={0} />
          ) : (
            <meshStandardMaterial key="plain" color="#4a3426" roughness={1} />
          )}
        </mesh>
        {clusters.map((c) => (
          <Marker key={c.id} cluster={c} selected={c.id === selectedId} onSelect={onSelect} />
        ))}
      </group>
    </>
  );
}

export default function Globe3D({ clusters, selectedId, onSelect, focus, autoRotate = true, controlRef }) {
  const dragState = useRef({ active: false, x: 0, y: 0, dx: 0, dy: 0, moved: 0 });

  // Lets ordinary buttons rotate the globe for keyboard users.
  useEffect(() => {
    if (controlRef) controlRef.current = { rotate: (px) => (dragState.current.dx += px) };
  }, [controlRef]);

  // Custom drag-to-rotate: no wheel/zoom handling, so page scrolling is never captured by the globe.
  const handlers = {
    onPointerDown: (e) => {
      const d = dragState.current;
      d.active = true;
      d.x = e.clientX;
      d.y = e.clientY;
      d.moved = 0;
    },
    onPointerMove: (e) => {
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
    onPointerUp: () => (dragState.current.active = false),
    onPointerLeave: () => (dragState.current.active = false),
  };

  return (
    <div style={{ width: '100%', height: '100%' }} {...handlers}>
      <Canvas
        camera={{ position: [0, 0, 3.05], fov: 42 }}
        dpr={[1, 2]}
        flat
        gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
        onPointerMissed={() => onSelect(null)}
        aria-label="Interactive 3D Earth showing relief locations"
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
        />
      </Canvas>
    </div>
  );
}
