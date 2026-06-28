/**
 * Three.js — 3D response surface (CL vs voltages)
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const AXIS_COLORS = {
  upperV: 0x10b981,
  lowerV: 0xef4444,
  cl: 0x00d4ff,
  cd: 0xf97316,
};

const SURFACE_SPAN = 10;
const CL_HEIGHT = 4;

// Fixed physical ranges — do NOT min-max normalize per surface (that makes CL/CD look identical).
const COEFF_DISPLAY_BOUNDS = {
  cl: { min: 0, max: 0.35 },
  cd: { min: 0.01, max: 0.16 },
};

const WIREFRAME_COLORS = {
  cl: 0x00d4ff,
  cd: 0xf97316,
};

function pickTicks(values, count = 5) {
  if (values.length <= count) return values;
  const indices = [];
  for (let i = 0; i < count; i++) {
    indices.push(Math.round((i / (count - 1)) * (values.length - 1)));
  }
  return [...new Set(indices.map((i) => values[i]))];
}

function formatVoltage(v) {
  return `${Math.round(v)}`;
}

function formatExact(value, decimals = 5) {
  return Number(value).toFixed(decimals);
}

function formatCoeff(v, mode) {
  return mode === 'cd' ? v.toFixed(4) : v.toFixed(3);
}

export class ResponseSurfaceScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.mesh = null;
    this.wireframe = null;
    this.axesGroup = null;
    this.markerTrail = [];
    this.coefficientMode = 'cl';
    this._previousCoefficientMode = 'cl';
    this.pitchLabel = 8;
    this.surfaceData = null;
    this._reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._morphRaf = null;
    this._init();
  }

  _init() {
    const container = this.canvas.parentElement;
    const w = container.clientWidth || 800;
    const h = container.clientHeight || 420;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 100);
    this.camera.position.set(8, 6, 8);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
    });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(w, h);
    this.labelRenderer.domElement.className = 'surface-label-layer';
    container.appendChild(this.labelRenderer.domElement);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;

    const ambient = new THREE.AmbientLight(0x223344, 0.5);
    this.scene.add(ambient);

    const dir = new THREE.DirectionalLight(0x00d4ff, 1);
    dir.position.set(5, 10, 5);
    this.scene.add(dir);

    const grid = new THREE.GridHelper(SURFACE_SPAN, 10, 0x10b981, 0x112233);
    grid.material.opacity = 0.12;
    grid.material.transparent = true;
    grid.position.set(0, -0.01, 0);
    this.scene.add(grid);

    this.scanPlane = this._createScanPlane();
    this.scene.add(this.scanPlane);

    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
    this._animate();
  }

  _createScanPlane() {
    const geo = new THREE.PlaneGeometry(SURFACE_SPAN + 0.2, SURFACE_SPAN + 0.2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x00d4ff,
      transparent: true,
      opacity: 0.04,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const plane = new THREE.Mesh(geo, mat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = 0.01;
    return plane;
  }

  _makeLabel(text, className) {
    const el = document.createElement('div');
    el.className = className;
    el.textContent = text;
    return new CSS2DObject(el);
  }

  _findGridPoint(data, lowerV, upperV) {
    return data.find(
      (d) => Math.abs(d.lower_v - lowerV) < 0.5 && Math.abs(d.upper_v - upperV) < 0.5,
    );
  }

  _coeffToHeight(val, mode) {
    const { min, max } = COEFF_DISPLAY_BOUNDS[mode === 'cd' ? 'cd' : 'cl'];
    const clamped = Math.max(min, Math.min(max, val));
    return ((clamped - min) / (max - min)) * CL_HEIGHT;
  }

  _colorForCoeff(val, mode) {
    const { min, max } = COEFF_DISPLAY_BOUNDS[mode === 'cd' ? 'cd' : 'cl'];
    const t = Math.max(0, Math.min(1, (val - min) / (max - min)));
    const color = new THREE.Color();
    if (mode === 'cd') {
      color.setHSL(0.07 + t * 0.06, 0.9, 0.38 + t * 0.18);
    } else {
      color.setHSL(0.52 - t * 0.12, 0.85, 0.42 + t * 0.12);
    }
    return color;
  }

  _makeMarkerAnnotation(lowerV, upperV, value, mode = 'cl') {
    const wrapper = document.createElement('div');
    wrapper.className = 'surface-marker-annotation';
    const dot = document.createElement('span');
    dot.className = 'surface-marker-pin';
    const text = document.createElement('span');
    text.className = 'surface-marker-label';
    const coeffLabel = mode === 'cd' ? formatCoeff(value, 'cd') : formatCoeff(value, 'cl');
    text.textContent = `(${formatExact(lowerV, 0)}, ${formatExact(upperV, 0)}, ${coeffLabel})`;
    wrapper.appendChild(dot);
    wrapper.appendChild(text);
    return new CSS2DObject(wrapper);
  }

  _buildMarkerVisuals() {
    // No 3D sphere — CSS2DObject above is the reliable on-screen pin.
    // Just return an empty group so the rest of the logic is unchanged.
    return new THREE.Group();
  }

  _removeMarker() {
    if (this.markerGroup) {
      this.markerGroup.traverse((child) => {
        if (child.element?.parentNode) {
          child.element.parentNode.removeChild(child.element);
        }
      });
      this.scene.remove(this.markerGroup);
      this.markerGroup = null;
      this.markerLabel = null;
    }
    if (this.markerTrail?.length) {
      this.markerTrail.forEach((t) => {
        this.scene.remove(t);
        t.geometry?.dispose();
        t.material?.dispose();
      });
    }
    this.markerTrail = [];
  }

  _addLine(start, end, color, opacity = 1) {
    const geo = new THREE.BufferGeometry().setFromPoints([start, end]);
    const mat = new THREE.LineBasicMaterial({
      color,
      transparent: opacity < 1,
      opacity,
    });
    const line = new THREE.Line(geo, mat);
    this.axesGroup.add(line);
    return line;
  }

  _addTickLine(start, end, color) {
    this._addLine(start, end, color, 0.85);
  }

  _clearAxes() {
    if (!this.axesGroup) return;
    this.axesGroup.traverse((child) => {
      if (child.element?.parentNode) {
        child.element.parentNode.removeChild(child.element);
      }
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    this.scene.remove(this.axesGroup);
    this.axesGroup = null;
  }

  _buildAxes(meta) {
    this._clearAxes();

    const { lowerVs, upperVs, valueMin, valueMax, coefficientMode } = meta;
    const mode = coefficientMode ?? 'cl';
    const yColor = mode === 'cd' ? AXIS_COLORS.cd : AXIS_COLORS.cl;
    const yLabel = mode === 'cd' ? 'C_D' : 'C_L';
    const half = SURFACE_SPAN / 2;
    const origin = new THREE.Vector3(-half, 0, -half);

    this.axesGroup = new THREE.Group();

    this._addLine(origin, new THREE.Vector3(half + 0.6, 0, -half), AXIS_COLORS.upperV);
    this._addLine(origin, new THREE.Vector3(-half, 0, half + 0.6), AXIS_COLORS.lowerV);
    this._addLine(origin, new THREE.Vector3(-half, CL_HEIGHT + 0.5, -half), yColor);

    const upperTitle = this._makeLabel('Upper MFC Voltage (V)', 'surface-label surface-label--title surface-label--upper');
    upperTitle.position.set(half + 1.1, 0.05, -half);
    this.axesGroup.add(upperTitle);

    const lowerTitle = this._makeLabel('Lower MFC Voltage (V)', 'surface-label surface-label--title surface-label--lower');
    lowerTitle.position.set(-half, 0.05, half + 1.1);
    this.axesGroup.add(lowerTitle);

    const coeffTitle = this._makeLabel(
      yLabel,
      `surface-label surface-label--title surface-label--${mode}`,
    );
    coeffTitle.position.set(-half - 0.55, CL_HEIGHT + 0.55, -half);
    this.axesGroup.add(coeffTitle);

    // Upper V ticks (X axis)
    pickTicks(upperVs, 5).forEach((voltage) => {
      const j = upperVs.indexOf(voltage);
      const x = (j / (upperVs.length - 1) - 0.5) * SURFACE_SPAN;
      const tickBase = new THREE.Vector3(x, 0, -half);
      this._addTickLine(tickBase, new THREE.Vector3(x, 0.18, -half), AXIS_COLORS.upperV);

      const tickLabel = this._makeLabel(formatVoltage(voltage), 'surface-label surface-label--tick surface-label--upper');
      tickLabel.position.set(x, -0.35, -half - 0.55);
      this.axesGroup.add(tickLabel);
    });

    // Lower V ticks (Z axis)
    pickTicks(lowerVs, 5).forEach((voltage) => {
      const i = lowerVs.indexOf(voltage);
      const z = (i / (lowerVs.length - 1) - 0.5) * SURFACE_SPAN;
      const tickBase = new THREE.Vector3(-half, 0, z);
      this._addTickLine(tickBase, new THREE.Vector3(-half - 0.18, 0, z), AXIS_COLORS.lowerV);

      const tickLabel = this._makeLabel(formatVoltage(voltage), 'surface-label surface-label--tick surface-label--lower');
      tickLabel.position.set(-half - 0.75, -0.35, z);
      this.axesGroup.add(tickLabel);
    });

    // CL ticks (Y axis)
    const bounds = COEFF_DISPLAY_BOUNDS[mode];
    pickTicks(
      [bounds.min, bounds.min + (bounds.max - bounds.min) * 0.25,
        bounds.min + (bounds.max - bounds.min) * 0.5,
        bounds.min + (bounds.max - bounds.min) * 0.75, bounds.max],
      5,
    ).forEach((val) => {
      const y = this._coeffToHeight(val, mode);
      const tickBase = new THREE.Vector3(-half, y, -half);
      this._addTickLine(tickBase, new THREE.Vector3(-half - 0.18, y, -half), yColor);

      const tickLabel = this._makeLabel(
        formatCoeff(val, mode),
        `surface-label surface-label--tick surface-label--${mode}`,
      );
      tickLabel.position.set(-half - 0.95, y, -half - 0.1);
      this.axesGroup.add(tickLabel);
    });

    this.scene.add(this.axesGroup);
    this._updateValueRangeLegend(valueMin, valueMax, mode);
  }

  _updateValueRangeLegend(valueMin, valueMax, mode = 'cl') {
    const el = document.getElementById('surfaceClRange');
    if (!el) return;
    const label = mode === 'cd' ? 'C_D' : 'C_L';
    if (!Number.isFinite(valueMin) || !Number.isFinite(valueMax)) {
      el.textContent = `${label} range: —`;
      return;
    }
    el.textContent = `${label} range: ${formatCoeff(valueMin, mode)} – ${formatCoeff(valueMax, mode)}`;
  }

  _buildGeometry(data, mode = 'cl') {
    const key = mode === 'cd' ? 'cd' : 'cl';
    const lowerVs = [...new Set(data.map((d) => d.lower_v))].sort((a, b) => a - b);
    const upperVs = [...new Set(data.map((d) => d.upper_v))].sort((a, b) => a - b);
    const rows = lowerVs.length;
    const cols = upperVs.length;

    const coeffValues = data.map((d) => d[key]);
    const dataMin = Math.min(...coeffValues);
    const dataMax = Math.max(...coeffValues);

    const geometry = new THREE.PlaneGeometry(SURFACE_SPAN, SURFACE_SPAN, cols - 1, rows - 1);
    const positions = geometry.attributes.position;
    const colors = [];

    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const idx = i * cols + j;
        const point = this._findGridPoint(data, lowerVs[i], upperVs[j]);
        const val = point ? point[key] : COEFF_DISPLAY_BOUNDS[mode].min;
        const y = this._coeffToHeight(val, mode);

        positions.setX(idx, (j / (cols - 1) - 0.5) * SURFACE_SPAN);
        positions.setZ(idx, (i / (rows - 1) - 0.5) * SURFACE_SPAN);
        positions.setY(idx, y);

        const color = this._colorForCoeff(val, mode);
        colors.push(color.r, color.g, color.b);
      }
    }

    geometry.computeVertexNormals();
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const bounds = COEFF_DISPLAY_BOUNDS[mode];
    return {
      geometry,
      valueMin: dataMin,
      valueMax: dataMax,
      valueRange: dataMax - dataMin || 0.01,
      displayMin: bounds.min,
      displayMax: bounds.max,
      lowerVs,
      upperVs,
      coefficientMode: mode,
      coefficientKey: key,
    };
  }

  _applyGeometry(geometry, mode = this.coefficientMode) {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
    }
    if (this.wireframe) {
      this.scene.remove(this.wireframe);
      this.wireframe.geometry.dispose();
      this.wireframe.material.dispose();
    }

    const material = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      metalness: 0.3,
      roughness: 0.4,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.renderOrder = 0;
    this.scene.add(this.mesh);

    const wireGeo = new THREE.WireframeGeometry(geometry);
    const wireColor = WIREFRAME_COLORS[mode === 'cd' ? 'cd' : 'cl'];
    const wireMat = new THREE.LineBasicMaterial({
      color: wireColor,
      transparent: true,
      opacity: 0.12,
    });
    this.wireframe = new THREE.LineSegments(wireGeo, wireMat);
    this.scene.add(this.wireframe);
  }

  setCoefficientMode(mode) {
    const next = mode === 'cd' ? 'cd' : 'cl';
    if (next === this.coefficientMode) return;
    this.coefficientMode = next;
    if (this.surfaceData) {
      this.updateSurface(this.surfaceData, this.pitchLabel, this.coefficientMode, { instant: true });
    }
    this._updateSurfaceLegend(next);
  }

  _updateSurfaceLegend(mode) {
    const yKey = document.querySelector('.axis-key--y');
    const markerKey = document.querySelector('.axis-key--marker');
    const title = document.getElementById('surfaceCardTitle');
    if (yKey) yKey.innerHTML = `<i></i> Y · C<sub>${mode === 'cd' ? 'D' : 'L'}</sub>`;
    if (markerKey) markerKey.innerHTML = `<i></i> (Lower V, Upper V, C<sub>${mode === 'cd' ? 'D' : 'L'}</sub>)`;
    if (title) {
      title.innerHTML = `3D Response Surface — C<sub>${mode === 'cd' ? 'D' : 'L'}</sub> vs Voltages`;
    }
    if (yKey) {
      yKey.classList.toggle('axis-key--cd', mode === 'cd');
      yKey.classList.toggle('axis-key--cl', mode !== 'cd');
    }
  }

  updateSurface(data, pitch, mode = this.coefficientMode, options = {}) {
    if (this._morphRaf) cancelAnimationFrame(this._morphRaf);

    const nextMode = mode === 'cd' ? 'cd' : 'cl';
    const modeChanged = nextMode !== this._previousCoefficientMode;
    this.coefficientMode = nextMode;
    this._previousCoefficientMode = nextMode;

    const built = this._buildGeometry(data, this.coefficientMode);
    this.surfaceMeta = built;
    this.pitchLabel = pitch;
    this.surfaceData = data;

    const pitchEl = document.getElementById('surfacePitchLabel');
    if (pitchEl) pitchEl.textContent = `${pitch}° AoA`;

    this._buildAxes(built);
    this._updateSurfaceLegend(this.coefficientMode);

    const instant = options.instant || modeChanged;

    if (!this.mesh || this._reducedMotion || instant) {
      this._applyGeometry(built.geometry, this.coefficientMode);
      return;
    }

    const oldPositions = this.mesh.geometry.attributes.position.array.slice();
    const newPositions = built.geometry.attributes.position.array;
    const startTime = performance.now();
    const duration = 700;

    this._applyGeometry(built.geometry, this.coefficientMode);
    const targetPositions = this.mesh.geometry.attributes.position.array;

    for (let i = 0; i < targetPositions.length; i++) {
      targetPositions[i] = oldPositions[i] ?? newPositions[i];
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();

    const wireColor = WIREFRAME_COLORS[this.coefficientMode];

    const morph = (now) => {
      const t = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - t, 3);

      for (let i = 0; i < targetPositions.length; i++) {
        targetPositions[i] = oldPositions[i] + (newPositions[i] - oldPositions[i]) * eased;
      }

      this.mesh.geometry.attributes.position.needsUpdate = true;
      this.mesh.geometry.computeVertexNormals();

      if (this.wireframe) {
        this.scene.remove(this.wireframe);
        this.wireframe.geometry.dispose();
        this.wireframe.material.dispose();
        const wireGeo = new THREE.WireframeGeometry(this.mesh.geometry);
        const wireMat = new THREE.LineBasicMaterial({
          color: wireColor,
          transparent: true,
          opacity: 0.12,
        });
        this.wireframe = new THREE.LineSegments(wireGeo, wireMat);
        this.scene.add(this.wireframe);
      }

      this._repositionMarkerToSurface();

      if (t < 1) {
        this._morphRaf = requestAnimationFrame(morph);
      } else {
        this._morphRaf = null;
      }
    };

    this._morphRaf = requestAnimationFrame(morph);
  }

  _getCoeffFromPoint(point) {
    if (!point) return 0;
    return this.coefficientMode === 'cd' ? point.cd : point.cl;
  }

  // Call after updateSurface completes to reanchor the marker to the new mesh.
  _repositionMarkerToSurface() {
    if (!this.markerGroup || !this.surfaceMeta || !this._lastMarkerPos) return;
    const { lowerVs, upperVs } = this.surfaceMeta;
    const x = this._lastMarkerPos.x;
    const z = this._lastMarkerPos.z;

    const ui = Math.round((x / SURFACE_SPAN + 0.5) * (upperVs.length - 1));
    const li = Math.round((z / SURFACE_SPAN + 0.5) * (lowerVs.length - 1));
    const nearestLowerV = lowerVs[Math.max(0, Math.min(li, lowerVs.length - 1))];
    const nearestUpperV = upperVs[Math.max(0, Math.min(ui, upperVs.length - 1))];

    // Find matching CL from live surface data.
    const point = this._findGridPoint(this.surfaceData, nearestLowerV, nearestUpperV);
    if (!point) return;

    const coeff = this._getCoeffFromPoint(point);
    const newY = this._coeffToHeight(coeff, this.coefficientMode);
    this.markerGroup.position.setY(newY);
    this._lastMarkerPos.setY(newY);

    if (this.markerLabel?.element) {
      const label = this.markerLabel.element.querySelector('.surface-marker-label');
      if (label) {
        label.textContent = `(${formatExact(nearestLowerV, 0)}, ${formatExact(nearestUpperV, 0)}, ${formatCoeff(coeff, this.coefficientMode)})`;
      }
    }
  }

  highlightPoint(lowerV, upperV, coeffValue, data) {
    this._removeMarker();

    const meta = this.surfaceMeta;
    if (!meta) return;

    const { lowerVs, upperVs, coefficientKey } = meta;
    const key = coefficientKey ?? (this.coefficientMode === 'cd' ? 'cd' : 'cl');

    // Find the closest grid indices for the requested voltages.
    const li = lowerVs.reduce(
      (best, v, i) => (Math.abs(v - lowerV) < Math.abs(lowerVs[best] - lowerV) ? i : best),
      0,
    );
    const ui = upperVs.reduce(
      (best, v, i) => (Math.abs(v - upperV) < Math.abs(upperVs[best] - upperV) ? i : best),
      0,
    );

    // Compute (x, y, z) using the EXACT same formula as the mesh builder,
    // so the marker sits flush on the surface vertex — no world-space Y offset.
    const x = (ui / (upperVs.length - 1) - 0.5) * SURFACE_SPAN;
    const z = (li / (lowerVs.length - 1) - 0.5) * SURFACE_SPAN;

    const gridPoint = this._findGridPoint(data, lowerVs[li], upperVs[ui]);
    const coeff = gridPoint ? gridPoint[key] : coeffValue;
    const y = this._coeffToHeight(coeff, this.coefficientMode);

    // Snap immediately — no lerp so the dot never leaves the surface mid-move.
    this.markerGroup = new THREE.Group();
    this.markerGroup.position.set(x, y, z);

    this.markerGroup.add(this._buildMarkerVisuals());

    this.markerLabel = this._makeMarkerAnnotation(lowerV, upperV, coeff, this.coefficientMode);
    this.markerGroup.add(this.markerLabel);

    this.scene.add(this.markerGroup);

    // Store for reference (used by nothing now but kept for future use).
    this._lastMarkerPos = new THREE.Vector3(x, y, z);
  }

  _resize() {
    const container = this.canvas.parentElement;
    if (!container) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    this.controls.update();

    const now = performance.now();

    if (this.scanPlane && !this._reducedMotion) {
      this.scanPlane.position.z = Math.sin(now * 0.001) * 5;
      this.scanPlane.material.opacity = 0.02 + Math.abs(Math.sin(now * 0.0015)) * 0.04;
    }

    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }

  dispose() {
    if (this._morphRaf) cancelAnimationFrame(this._morphRaf);
    this._removeMarker();
    this._clearAxes();
    window.removeEventListener('resize', this._onResize);
    this.labelRenderer.domElement.remove();
    this.renderer.dispose();
  }
}
