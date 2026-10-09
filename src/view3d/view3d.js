// 3D plot of the route with exaggerated altitude, direction arrows and clickable distance markers.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { makeProjection } from '../geo/geo.js';
import { sampleAtDistance } from '../geo/process.js';
import { distanceMarkers } from '../stats/summary.js';
import { rampRGB, speedRange } from '../ui/colors.js';
import { cssVar, Disposer } from '../ui/dom.js';
import { markerInfoHTML, Popover } from '../ui/popover.js';
import { distanceUnit, formatPace, splitLength } from '../units.js';
import { IMAGERY, latToPx, loadImagery, lonToPx } from './imagery.js';

const WORLD = 100; // horizontal extent normalised to this many scene units

/**
 * @param {HTMLElement} root
 * @param {{workout:object, track:object, units:string, exaggeration:'auto'|number, satellite?:boolean, onSatelliteChange?:(on:boolean)=>void}} opts
 */
export function mountView3D(root, { workout, track, units, exaggeration = 'auto', satellite = true, onSatelliteChange }) {
  const d = new Disposer();
  let disposed = false;
  d.add(() => {
    disposed = true;
  });
  root.innerHTML = `
    <div class="view3d">
      <div class="view3d-hint">Drag to orbit · pinch to zoom · two fingers to pan</div>
      <div class="view3d-attrib" hidden>${IMAGERY.attribution}</div>
      <div class="view3d-controls">
        <button class="chip" data-act="satellite" aria-pressed="false">Satellite</button>
        <label for="exag">Vertical</label>
        <input id="exag" type="range" min="1" max="10" step="0.5" />
        <output for="exag"></output>
      </div>
    </div>`;
  const host = root.querySelector('.view3d');
  if (track.n < 2) {
    host.innerHTML = '<div class="map-offline">Not enough GPS points for a 3D view.</div>';
    return () => d.dispose();
  }

  // ---- Geometry basis ---------------------------------------------------------------------
  const n = track.n;
  const proj = makeProjection((workout.summary.bbox[1] + workout.summary.bbox[3]) / 2, (workout.summary.bbox[0] + workout.summary.bbox[2]) / 2);
  const ex = new Float64Array(n);
  const ny = new Float64Array(n);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const [x, y] = proj.toXY(track.lat[i], track.lon[i]);
    ex[i] = x;
    ny[i] = y;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const extentM = Math.max(50, maxX - minX, maxY - minY);
  const scale = WORLD / extentM;
  const minAlt = workout.summary.minAlt ?? 0;
  const vRange = Math.max(1, (workout.summary.maxAlt ?? minAlt) - minAlt);
  const autoExag = Math.min(10, Math.max(1, Math.round(((0.25 * extentM) / vRange) * 2) / 2));
  let exag = exaggeration === 'auto' ? autoExag : Number(exaggeration) || autoExag;

  const toScene = (i, e = exag) =>
    new THREE.Vector3(ex[i] * scale, (Math.max(0, (Number.isFinite(track.alt[i]) ? track.alt[i] : minAlt) - minAlt)) * scale * e, -ny[i] * scale);
  const toSceneLL = (lat, lon, alt, e = exag) => {
    const [x, y] = proj.toXY(lat, lon);
    return new THREE.Vector3(x * scale, Math.max(0, (Number.isFinite(alt) ? alt : minAlt) - minAlt) * scale * e, -y * scale);
  };

  // ---- Renderer, scene, camera ------------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  host.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const bg = new THREE.Color(cssVar('--bg') || '#0d1217');
  scene.background = bg;
  const isDark = bg.getHSL({ h: 0, s: 0, l: 0 }).l < 0.4;

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
  const center = new THREE.Vector3(((minX + maxX) / 2) * scale, 0, (-(minY + maxY) / 2) * scale);
  camera.position.set(center.x - WORLD * 0.55, WORLD * 0.75, center.z + WORLD * 0.95);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(center);
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minDistance = 5;
  controls.maxDistance = WORLD * 5;
  controls.enableDamping = false;
  controls.update();

  const group = new THREE.Group();
  scene.add(group);

  // Static ground grid.
  const gridSize = Math.ceil((WORLD * 1.3) / 10) * 10;
  const grid = new THREE.GridHelper(gridSize, 13, isDark ? 0x3a4652 : 0xb9c3cc, isDark ? 0x222c35 : 0xdde3e9);
  grid.position.set(center.x, 0, center.z);
  scene.add(grid);

  // Satellite ground plane, loaded on demand. Each vertex gets UVs from its own Web Mercator
  // position, so the imagery lines up exactly with the locally projected route.
  const ground = { mesh: null, texture: null, loading: false };
  let satOn = satellite;
  const satBtn = root.querySelector('[data-act="satellite"]');
  const attribution = root.querySelector('.view3d-attrib');

  function applyGround() {
    const showing = satOn && Boolean(ground.mesh);
    if (ground.mesh) ground.mesh.visible = satOn;
    grid.visible = !showing;
    attribution.hidden = !showing;
    satBtn.setAttribute('aria-pressed', String(satOn));
    render();
  }

  async function loadGround() {
    if (ground.mesh || ground.loading) return;
    ground.loading = true;
    satBtn.disabled = true;
    const pad = Math.max(200, extentM * 0.12);
    const x0 = minX - pad;
    const x1 = maxX + pad;
    const y0 = minY - pad;
    const y1 = maxY + pad;
    const [south, west] = proj.toLatLon(x0, y0);
    const [north, east] = proj.toLatLon(x1, y1);
    try {
      const maxPx = Math.min(4096, renderer.capabilities.maxTextureSize);
      const img = await loadImagery([west, south, east, north], { maxPx, isCancelled: () => disposed });
      if (disposed) return;
      const geom = new THREE.PlaneGeometry((x1 - x0) * scale, (y1 - y0) * scale, 48, 48);
      geom.rotateX(-Math.PI / 2);
      geom.translate(((x0 + x1) / 2) * scale, -0.03, (-(y0 + y1) / 2) * scale);
      const pos = geom.attributes.position;
      const uv = geom.attributes.uv;
      for (let i = 0; i < pos.count; i++) {
        const [lat, lon] = proj.toLatLon(pos.getX(i) / scale, -pos.getZ(i) / scale);
        uv.setXY(
          i,
          (lonToPx(lon, img.z) - img.originX) / img.canvas.width,
          1 - (latToPx(lat, img.z) - img.originY) / img.canvas.height
        );
      }
      uv.needsUpdate = true;
      const tex = new THREE.CanvasTexture(img.canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      // Slightly dimmed so the speed-coloured route stays the hero.
      const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0xd9d9d9 });
      ground.mesh = new THREE.Mesh(geom, mat);
      ground.mesh.renderOrder = -1;
      ground.texture = tex;
      scene.add(ground.mesh);
    } catch (e) {
      if (disposed) return;
      console.warn('3D imagery', e);
      flashHint('Satellite imagery unavailable offline');
      satOn = false;
    } finally {
      ground.loading = false;
      if (!disposed) {
        satBtn.disabled = false;
        applyGround();
      }
    }
  }

  function flashHint(text) {
    root.querySelector('.view3d-hint')?.remove();
    const hint = document.createElement('div');
    hint.className = 'view3d-hint';
    hint.textContent = text;
    host.appendChild(hint);
    setTimeout(() => hint.remove(), 3500);
  }

  satBtn.addEventListener('click', () => {
    satOn = !satOn;
    onSatelliteChange?.(satOn);
    if (satOn && !ground.mesh) loadGround();
    else applyGround();
  });

  d.add(() => {
    if (ground.mesh) {
      ground.mesh.geometry.dispose();
      ground.mesh.material.dispose();
      ground.texture.dispose();
    }
  });

  const [vmin, vmax] = speedRange(track);
  const accent = new THREE.Color(cssVar('--accent', root) || '#f2672e');
  const lineMaterial = new LineMaterial({ linewidth: 4, vertexColors: true, worldUnits: false });
  const shadowMaterial = new THREE.LineBasicMaterial({ color: isDark ? 0x000000 : 0x5d6b78, transparent: true, opacity: isDark ? 0.55 : 0.35 });
  const curtainMaterial = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false });
  const arrowMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 });
  d.add(() => [lineMaterial, shadowMaterial, curtainMaterial, arrowMaterial].forEach((m) => m.dispose()));

  // Markers (sprites keep a constant on-screen size).
  const splitLen = splitLength(units);
  const unit = distanceUnit(units);
  const markerData = distanceMarkers(track, splitLen);
  const first = sampleAtDistance(track, 0);
  const last = sampleAtDistance(track, track.dist[n - 1]);
  const textures = [];
  const sprites = [];
  const makeSprite = (label, fill, data, title) => {
    const tex = markerTexture(label, fill);
    textures.push(tex);
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: false });
    const sp = new THREE.Sprite(mat);
    sp.scale.set(0.04, 0.04, 1);
    sp.center.set(0.5, 0.5);
    sp.renderOrder = 10;
    sp.userData = { data, title };
    sprites.push(sp);
    scene.add(sp);
  };
  for (const m of markerData) {
    const prev = markerData[m.k - 2];
    const splitTime = m.active - (prev ? prev.active : 0);
    makeSprite(String(m.k), `#${accent.getHexString()}`, { ...m, extra: [['Split pace', formatPace(splitLen / Math.max(1, splitTime), units)]] }, `${m.k} ${unit}`);
  }
  makeSprite('S', '#1f9d55', first, 'Start');
  makeSprite('F', '#111111', last, 'Finish');
  d.add(() => {
    textures.forEach((t) => t.dispose());
    sprites.forEach((s) => s.material.dispose());
  });

  // ---- Build (re-run when exaggeration changes) -------------------------------------------
  function build() {
    group.children.forEach((c) => c.geometry?.dispose());
    group.clear();

    // Track line coloured by speed.
    const step = Math.max(1, Math.floor(n / 4000));
    let segStart = 0;
    const flushSegment = (from, to) => {
      if (to - from < 2) return;
      const pos = [];
      const col = [];
      const sh = [];
      for (let i = from; i < to; i += step) {
        const p = toScene(i);
        pos.push(p.x, p.y, p.z);
        const [r, g, b] = rampRGB((track.speed[i] - vmin) / (vmax - vmin));
        col.push(r / 255, g / 255, b / 255);
        sh.push(p.x, 0.02, p.z);
      }
      const geom = new LineGeometry();
      geom.setPositions(pos);
      geom.setColors(col);
      const line = new Line2(geom, lineMaterial);
      line.computeLineDistances();
      group.add(line);
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute(sh, 3));
      group.add(new THREE.Line(sg, shadowMaterial));

      // Curtain from the track down to the ground.
      const verts = [];
      for (let k = 0; k + 3 < pos.length; k += 3) {
        const [x0, y0, z0, x1, y1, z1] = pos.slice(k, k + 6);
        verts.push(x0, y0, z0, x0, 0, z0, x1, y1, z1, x1, y1, z1, x0, 0, z0, x1, 0, z1);
      }
      const cg = new THREE.BufferGeometry();
      cg.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      const curtain = new THREE.Mesh(cg, curtainMaterial);
      curtain.renderOrder = 1;
      group.add(curtain);
    };
    for (let i = 1; i <= n; i++) {
      if (i === n || track.seg[i] !== track.seg[segStart]) {
        flushSegment(segStart, i);
        segStart = i;
      }
    }

    // Direction arrows: small cones every ~1/30 of the route.
    const total = track.dist[n - 1];
    const count = Math.max(4, Math.min(60, Math.round(total / Math.max(50, total / 30))));
    const cone = new THREE.ConeGeometry(0.55, 1.7, 10);
    cone.translate(0, 0.85, 0);
    const arrows = new THREE.InstancedMesh(cone, arrowMaterial, count);
    const up = new THREE.Vector3(0, 1, 0);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let k = 0; k < count; k++) {
      const dist = ((k + 0.5) / count) * total;
      const a = sampleAtDistance(track, Math.max(0, dist - 8));
      const b = sampleAtDistance(track, Math.min(total, dist + 8));
      const pa = toSceneLL(a.lat, a.lon, a.alt);
      const pb = toSceneLL(b.lat, b.lon, b.alt);
      const dir = pb.clone().sub(pa);
      if (dir.lengthSq() < 1e-9) dir.set(1, 0, 0);
      q.setFromUnitVectors(up, dir.normalize());
      const c = sampleAtDistance(track, dist);
      const mid = toSceneLL(c.lat, c.lon, c.alt);
      mid.y += 0.6;
      m4.compose(mid, q, new THREE.Vector3(1, 1, 1));
      arrows.setMatrixAt(k, m4);
    }
    arrows.renderOrder = 5;
    group.add(arrows);

    for (const sp of sprites) {
      const s = sp.userData.data;
      const p = toSceneLL(s.lat, s.lon, s.alt);
      sp.position.set(p.x, p.y + 1.2, p.z);
    }
    render();
  }

  // ---- Interaction ------------------------------------------------------------------------
  const popover = new Popover(host);
  let popTarget = null;
  const placePopover = () => {
    if (!popTarget || !popover.open) return;
    const v = popTarget.position.clone().project(camera);
    const w = host.clientWidth;
    const h = host.clientHeight;
    popover.move(((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h);
  };
  popover.onClose = () => {
    popTarget = null;
  };

  const raycaster = new THREE.Raycaster();
  let downAt = null;
  const onDown = (e) => {
    downAt = [e.clientX, e.clientY];
  };
  const onUp = (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(sprites, false);
    if (hits.length) {
      const sp = hits[0].object;
      popTarget = sp;
      popover.show(0, 0, markerInfoHTML({ title: sp.userData.title, sample: sp.userData.data, units }));
      placePopover();
    } else {
      popover.close();
    }
  };
  renderer.domElement.addEventListener('pointerdown', onDown);
  renderer.domElement.addEventListener('pointerup', onUp);

  let frame = 0;
  function render() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      renderer.render(scene, camera);
      placePopover();
    });
  }
  controls.addEventListener('change', render);

  // Initial framing is tuned for a landscape view; pull back on narrow (portrait) screens so
  // the whole route fits horizontally. Only applies until the user moves the camera.
  const baseOffset = camera.position.clone().sub(center);
  let userMoved = false;
  controls.addEventListener('start', () => {
    userMoved = true;
  });
  const fitCamera = (aspect) => {
    if (userMoved) return;
    const factor = Math.max(1, 1.25 / aspect);
    camera.position.copy(center).addScaledVector(baseOffset, factor);
    controls.update();
  };

  const resize = () => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    fitCamera(camera.aspect);
    camera.updateProjectionMatrix();
    lineMaterial.resolution.set(w, h);
    render();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);

  const slider = root.querySelector('#exag');
  const output = root.querySelector('output');
  slider.value = String(exag);
  output.textContent = `${exag}×`;
  slider.addEventListener('input', () => {
    exag = Number(slider.value);
    output.textContent = `${exag}×`;
    build();
  });

  setTimeout(() => root.querySelector('.view3d-hint')?.remove(), 4000);

  build();
  resize();
  satBtn.setAttribute('aria-pressed', String(satOn));
  if (satOn) loadGround();

  d.add(() => {
    cancelAnimationFrame(frame);
    ro.disconnect();
    controls.dispose();
    popover.close(false);
    group.children.forEach((c) => c.geometry?.dispose());
    grid.geometry.dispose();
    grid.material.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  });
  return () => d.dispose();
}

function markerTexture(label, fill) {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.beginPath();
  g.arc(s / 2, s / 2, s / 2 - 5, 0, Math.PI * 2);
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = '#ffffff';
  g.stroke();
  g.fillStyle = '#ffffff';
  g.font = `700 ${label.length > 2 ? 20 : 26}px "Google Sans Variable", system-ui, Roboto, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, s / 2, s / 2 + 1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

