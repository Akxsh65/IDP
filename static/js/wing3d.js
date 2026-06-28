/**
 * Three.js — NACA 0009 morphing wing visualization + particle background
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const NACA_T = 0.09;
const FLOW_LINE_COUNT = 8;

function naca0009Points(numPoints = 80) {
  const upper = [];
  const lower = [];
  for (let i = 0; i <= numPoints; i++) {
    const xt = i / numPoints;
    const yt =
      5 *
      NACA_T *
      (0.2969 * Math.sqrt(xt) -
        0.126 * xt -
        0.3516 * xt * xt +
        0.2843 * xt * xt * xt -
        0.1015 * xt * xt * xt * xt);
    upper.push(new THREE.Vector2(xt, yt));
    lower.push(new THREE.Vector2(xt, -yt));
  }
  return { upper, lower };
}

function buildAirfoilShape(deflectionNorm = 0) {
  const { upper, lower } = naca0009Points(100);
  const morphStart = 0.6;
  const shape = new THREE.Shape();

  upper.forEach((p, i) => {
    let y = p.y;
    if (p.x >= morphStart) {
      const t = (p.x - morphStart) / (1 - morphStart);
      y += deflectionNorm * t * t * 0.08;
    }
    if (i === 0) shape.moveTo(p.x, y);
    else shape.lineTo(p.x, y);
  });

  for (let i = lower.length - 1; i >= 0; i--) {
    const p = lower[i];
    let y = p.y;
    if (p.x >= morphStart) {
      const t = (p.x - morphStart) / (1 - morphStart);
      y += deflectionNorm * t * t * 0.08;
    }
    shape.lineTo(p.x, y);
  }

  return shape;
}

export class WingScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.deflectionNorm = 0;
    this.targetDeflection = 0;
    this.pitchRad = 0;
    this.targetPitchRad = 0;
    this.flowIntensity = 0.5;
    this.lowerVoltage = -250;
    this.upperVoltage = 750;
    this.wingMesh = null;
    this.mfcUpper = null;
    this.mfcLower = null;
    this.mfcGlows = [];
    this.flowParticles = [];
    this._raf = null;
    this._reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this._init();
  }

  _init() {
    const container = this.canvas.parentElement;
    const w = container.clientWidth;
    const h = container.clientHeight;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x060a14, 0.11);
    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.01, 100);
    this.camera.position.set(0.4, 0.15, 2.35);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
    });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 5;
    this.controls.autoRotate = !this._reducedMotion;
    this.controls.autoRotateSpeed = 0.8;
    this.controls.addEventListener('start', () => {
      this.controls.autoRotate = false;
    });

    this.wingGroup = new THREE.Group();
    this.scene.add(this.wingGroup);

    this._addLights();
    this._addGrid();
    this._addFreestreamGuide();
    this._buildWing(0);
    this._addMFCActuators();
    this._addFlowLines();

    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
    this._animate();
  }

  _addLights() {
    const ambient = new THREE.AmbientLight(0x334466, 0.6);
    this.scene.add(ambient);

    const key = new THREE.DirectionalLight(0x00d4ff, 1.2);
    key.position.set(3, 4, 2);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x7c3aed, 0.5);
    fill.position.set(-2, 1, -1);
    this.scene.add(fill);

    const rim = new THREE.PointLight(0x10b981, 0.8, 10);
    rim.position.set(0, -1, 2);
    this.scene.add(rim);
  }

  _addFreestreamGuide() {
    const dir = new THREE.Vector3(1, 0, 0).normalize();
    const origin = new THREE.Vector3(-1.45, 0.05, 0.15);
    const arrow = new THREE.ArrowHelper(dir, origin, 0.55, 0x22d3ee, 0.07, 0.035);
    arrow.line.material.transparent = true;
    arrow.line.material.opacity = 0.85;
    arrow.cone.material.transparent = true;
    arrow.cone.material.opacity = 0.9;
    this.freestreamArrow = arrow;
    this.scene.add(arrow);
  }

  _addChordReference() {
    if (this.chordGroup) {
      this.wingGroup.remove(this.chordGroup);
      this.chordGroup.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    }

    this.chordGroup = new THREE.Group();
    const chordGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0.42, 0, 0),
      new THREE.Vector3(-0.42, 0, 0),
    ]);
    const chordMat = new THREE.LineDashedMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.45,
      dashSize: 0.04,
      gapSize: 0.03,
    });
    const chordLine = new THREE.Line(chordGeo, chordMat);
    chordLine.computeLineDistances();
    this.chordGroup.add(chordLine);
    this.wingGroup.add(this.chordGroup);
  }

  _addGrid() {
    const grid = new THREE.GridHelper(4, 20, 0x00d4ff, 0x112233);
    grid.material.opacity = 0.15;
    grid.material.transparent = true;
    grid.position.y = -0.35;
    this.scene.add(grid);
  }

  _buildWing(deflectionNorm) {
    if (this.wingMesh) {
      this.wingGroup.remove(this.wingMesh);
      this.wingMesh.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    }

    const shape = buildAirfoilShape(deflectionNorm);
    const extrudeSettings = {
      depth: 0.6,
      bevelEnabled: true,
      bevelThickness: 0.005,
      bevelSize: 0.005,
      bevelSegments: 2,
    };

    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    geometry.center();
    geometry.rotateY(Math.PI / 2);
    geometry.rotateX(-Math.PI / 6);

    const material = new THREE.MeshPhysicalMaterial({
      color: 0x2d6a9f,
      emissive: 0x0a2a44,
      emissiveIntensity: 0.25,
      metalness: 0.55,
      roughness: 0.2,
      clearcoat: 0.85,
      clearcoatRoughness: 0.08,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
    });

    this.wingMesh = new THREE.Mesh(geometry, material);
    this.wingGroup.add(this.wingMesh);

    const edges = new THREE.EdgesGeometry(geometry);
    const edgeMat = new THREE.LineBasicMaterial({
      color: 0x67e8f9,
      transparent: true,
      opacity: 0.55,
    });
    const edgeLines = new THREE.LineSegments(edges, edgeMat);
    this.wingMesh.add(edgeLines);

    this._addChordReference();
    this._addMorphZoneMarker();
    this._addEdgeMarkers();
  }

  _addMorphZoneMarker() {
    if (this.morphZone) {
      this.wingGroup.remove(this.morphZone);
      this.morphZone.geometry?.dispose();
      this.morphZone.material?.dispose();
    }

    const geo = new THREE.PlaneGeometry(0.12, 0.38);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xa78bfa,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.morphZone = new THREE.Mesh(geo, mat);
    this.morphZone.position.set(-0.22, 0, 0.02);
    this.wingGroup.add(this.morphZone);
  }

  _addEdgeMarkers() {
    if (this.edgeMarkers) {
      this.wingGroup.remove(this.edgeMarkers);
      this.edgeMarkers.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    }

    this.edgeMarkers = new THREE.Group();
    const mk = (x, color) => {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.025, 12, 12),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }),
      );
      mesh.position.set(x, 0, 0.08);
      return mesh;
    };
    this.edgeMarkers.add(mk(0.4, 0xfbbf24));
    this.edgeMarkers.add(mk(-0.4, 0xf97316));
    this.wingGroup.add(this.edgeMarkers);
  }

  _addMFCActuators() {
    if (this.mfcGroup) {
      this.wingMesh.remove(this.mfcGroup);
      this.mfcGroup.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    }

    this.mfcGroup = new THREE.Group();
    this.mfcGlows = [];
    const mfcGeo = new THREE.BoxGeometry(0.15, 0.02, 0.08);
    const mfcMat = new THREE.MeshStandardMaterial({
      color: 0x10b981,
      emissive: 0x10b981,
      emissiveIntensity: 0.6,
      metalness: 0.5,
      roughness: 0.3,
    });

    this.mfcUpper = new THREE.Mesh(mfcGeo, mfcMat.clone());
    this.mfcUpper.position.set(0.15, 0.12, 0);
    this.mfcGroup.add(this.mfcUpper);

    this.mfcLower = new THREE.Mesh(mfcGeo, mfcMat.clone());
    this.mfcLower.position.set(0.15, -0.12, 0);
    this.mfcGroup.add(this.mfcLower);

    const glowGeo = new THREE.SphereGeometry(0.03, 16, 16);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x00d4ff,
      transparent: true,
      opacity: 0.6,
    });
    [this.mfcUpper, this.mfcLower].forEach((mfc) => {
      const glow = new THREE.Mesh(glowGeo, glowMat.clone());
      glow.position.copy(mfc.position);
      this.mfcGroup.add(glow);
      this.mfcGlows.push(glow);
    });

    this.wingMesh.add(this.mfcGroup);
  }

  _addFlowLines() {
    if (this.flowGroup) {
      this.scene.remove(this.flowGroup);
      this.flowGroup.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    }

    this.flowGroup = new THREE.Group();
    this.flowPaths = [];
    this.flowParticles = [];

    const lineMat = new THREE.LineBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.18,
    });
    const particleGeo = new THREE.SphereGeometry(0.018, 8, 8);

    for (let i = 0; i < FLOW_LINE_COUNT; i++) {
      const y = (i - (FLOW_LINE_COUNT - 1) / 2) * 0.085;
      const start = new THREE.Vector3(-1.55, y, 0.15);
      const end = new THREE.Vector3(1.55, y, 0.15);

      this.flowPaths.push({ start, end });

      const geo = new THREE.BufferGeometry().setFromPoints([start, end]);
      const line = new THREE.Line(geo, lineMat.clone());
      this.flowGroup.add(line);

      const particleMat = new THREE.MeshBasicMaterial({
        color: 0x67e8f9,
        transparent: true,
        opacity: 0.85,
      });
      const particle = new THREE.Mesh(particleGeo, particleMat);
      particle.userData = { pathIndex: i, phase: i / FLOW_LINE_COUNT };
      this.flowGroup.add(particle);
      this.flowParticles.push(particle);

      const trailMat = particleMat.clone();
      trailMat.opacity = 0.35;
      const trail = new THREE.Mesh(particleGeo, trailMat);
      trail.scale.setScalar(0.55);
      trail.userData = { pathIndex: i, phase: (i / FLOW_LINE_COUNT + 0.35) % 1, isTrail: true };
      this.flowGroup.add(trail);
      this.flowParticles.push(trail);
    }

    this.scene.add(this.flowGroup);
  }

  setDeflection(deflectionMm) {
    this.targetDeflection = Math.max(-1, Math.min(0, deflectionMm / -8.47));
    if (this._reducedMotion) {
      this.deflectionNorm = this.targetDeflection;
      this._buildWing(this.deflectionNorm);
      this._addMFCActuators();
      return;
    }
    if (this._morphRaf) cancelAnimationFrame(this._morphRaf);

    const start = this.deflectionNorm;
    const startTime = performance.now();
    const duration = 800;

    const morph = (now) => {
      const t = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      this.deflectionNorm = start + (this.targetDeflection - start) * eased;
      this._buildWing(this.deflectionNorm);
      this._addMFCActuators();

      if (t < 1) {
        this._morphRaf = requestAnimationFrame(morph);
      } else {
        this._morphRaf = null;
      }
    };
    this._morphRaf = requestAnimationFrame(morph);
  }

  setPitchAngle(pitchDeg) {
    this.targetPitchRad = THREE.MathUtils.degToRad(pitchDeg) * 0.35;
    if (this._reducedMotion) {
      this.pitchRad = this.targetPitchRad;
      this.wingGroup.rotation.z = this.pitchRad;
    }
  }

  setVoltages(lowerV, upperV) {
    this.lowerVoltage = lowerV;
    this.upperVoltage = upperV;
  }

  setFlowIntensity(cl) {
    this.flowIntensity = Math.max(0.15, Math.min(1.5, (cl || 0.1) * 6));
  }

  _resize() {
    const container = this.canvas.parentElement;
    const w = container.clientWidth;
    const h = container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  _animate() {
    this._raf = requestAnimationFrame(() => this._animate());
    const now = performance.now();

    this.controls.update();

    if (!this._reducedMotion) {
      this.pitchRad += (this.targetPitchRad - this.pitchRad) * 0.08;
      this.wingGroup.rotation.z = this.pitchRad;
      this.wingGroup.position.y = Math.sin(now * 0.0012) * 0.014;

      if (this.morphZone?.material) {
        this.morphZone.material.opacity = 0.1 + Math.sin(now * 0.003) * 0.07;
      }

      if (this.edgeMarkers) {
        this.edgeMarkers.children.forEach((marker, i) => {
          const s = 1 + Math.sin(now * 0.004 + i * 1.6) * 0.18;
          marker.scale.setScalar(s);
        });
      }

      if (this.freestreamArrow) {
        const pulse = 0.65 + Math.sin(now * 0.005) * 0.25;
        this.freestreamArrow.line.material.opacity = pulse;
        this.freestreamArrow.cone.material.opacity = pulse + 0.12;
      }
    }

    if (this.mfcUpper) {
      const lowerNorm = Math.abs(this.lowerVoltage) / 500;
      const upperNorm = this.upperVoltage / 1500;
      const pulse = 0.35 + Math.sin(now * 0.004) * 0.25;

      this.mfcUpper.material.emissiveIntensity = 0.3 + upperNorm * 0.9 * pulse;
      this.mfcLower.material.emissiveIntensity = 0.3 + lowerNorm * 0.9 * pulse;

      if (this.mfcGlows[0]) {
        this.mfcGlows[0].material.opacity = 0.3 + upperNorm * 0.5;
        this.mfcGlows[0].scale.setScalar(0.8 + upperNorm * 0.6);
      }
      if (this.mfcGlows[1]) {
        this.mfcGlows[1].material.opacity = 0.3 + lowerNorm * 0.5;
        this.mfcGlows[1].scale.setScalar(0.8 + lowerNorm * 0.6);
      }
    }

    if (!this._reducedMotion && this.flowParticles.length) {
      const speed = 0.0007 * this.flowIntensity;
      this.flowParticles.forEach((particle) => {
        const { pathIndex, phase, isTrail } = particle.userData;
        const path = this.flowPaths[pathIndex];
        if (!path) return;

        particle.userData.phase = (phase + speed * (isTrail ? 0.85 : 1)) % 1;
        const t = particle.userData.phase;
        particle.position.lerpVectors(path.start, path.end, t);

        const trailFade = Math.sin(t * Math.PI);
        const baseOpacity = isTrail ? 0.2 : 0.35;
        const peakOpacity = isTrail ? 0.45 : 0.95;
        particle.material.opacity = baseOpacity + trailFade * (peakOpacity - baseOpacity);
        particle.scale.setScalar((isTrail ? 0.45 : 0.7) + trailFade * (isTrail ? 0.25 : 0.55));
      });

      this.flowGroup.children.forEach((child) => {
        if (child.type === 'Line') {
          child.material.opacity = 0.1 + this.flowIntensity * 0.12;
        }
      });
    }

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    if (this._morphRaf) cancelAnimationFrame(this._morphRaf);
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
  }
}

export class ParticleBackground {
  constructor(canvas) {
    this.canvas = canvas;
    this._reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._init();
  }

  _init() {
    const w = window.innerWidth;
    const h = window.innerHeight;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 100);
    this.camera.position.z = 3;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: true,
    });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

    const count = 1200;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    this.velocities = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 20;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 20;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 10;

      this.velocities[i * 3] = (Math.random() - 0.5) * 0.002;
      this.velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.002;
      this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.001;

      const c = Math.random() > 0.7 ? 0x7c3aed : 0x00d4ff;
      colors[i * 3] = ((c >> 16) & 255) / 255;
      colors[i * 3 + 1] = ((c >> 8) & 255) / 255;
      colors[i * 3 + 2] = (c & 255) / 255;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.025,
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.points = new THREE.Points(geo, mat);
    this.scene.add(this.points);

    this._onResize = () => {
      const nw = window.innerWidth;
      const nh = window.innerHeight;
      this.camera.aspect = nw / nh;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(nw, nh);
    };
    window.addEventListener('resize', this._onResize);
    this._animate();
  }

  _animate() {
    requestAnimationFrame(() => this._animate());

    if (!this._reducedMotion) {
      this.points.rotation.y += 0.0003;
      this.points.rotation.x += 0.0001;

      const positions = this.points.geometry.attributes.position.array;
      for (let i = 0; i < positions.length; i += 3) {
        positions[i] += this.velocities[i];
        positions[i + 1] += this.velocities[i + 1];
        positions[i + 2] += this.velocities[i + 2];

        if (Math.abs(positions[i]) > 10) this.velocities[i] *= -1;
        if (Math.abs(positions[i + 1]) > 10) this.velocities[i + 1] *= -1;
        if (Math.abs(positions[i + 2]) > 5) this.velocities[i + 2] *= -1;
      }
      this.points.geometry.attributes.position.needsUpdate = true;
    }

    this.renderer.render(this.scene, this.camera);
  }
}
