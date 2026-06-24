/**
 * Three.js — NACA 0009 morphing wing visualization + particle background
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const NACA_T = 0.09;

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
    this.wingMesh = null;
    this.mfcUpper = null;
    this.mfcLower = null;
    this._raf = null;

    this._init();
  }

  _init() {
    const container = this.canvas.parentElement;
    const w = container.clientWidth;
    const h = container.clientHeight;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 100);
    this.camera.position.set(1.8, 0.6, 2.2);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
    });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 5;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.8;

    this._addLights();
    this._addGrid();
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

  _addGrid() {
    const grid = new THREE.GridHelper(4, 20, 0x00d4ff, 0x112233);
    grid.material.opacity = 0.15;
    grid.material.transparent = true;
    grid.position.y = -0.35;
    this.scene.add(grid);
  }

  _buildWing(deflectionNorm) {
    if (this.wingMesh) {
      this.scene.remove(this.wingMesh);
      this.wingMesh.geometry.dispose();
      this.wingMesh.material.dispose();
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
      color: 0x1a3a5c,
      metalness: 0.7,
      roughness: 0.25,
      clearcoat: 0.8,
      clearcoatRoughness: 0.1,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
    });

    this.wingMesh = new THREE.Mesh(geometry, material);
    this.scene.add(this.wingMesh);

    const edges = new THREE.EdgesGeometry(geometry);
    const edgeMat = new THREE.LineBasicMaterial({
      color: 0x00d4ff,
      transparent: true,
      opacity: 0.3,
    });
    const edgeLines = new THREE.LineSegments(edges, edgeMat);
    this.wingMesh.add(edgeLines);
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
    });

    this.wingMesh.add(this.mfcGroup);
  }

  _addFlowLines() {
    const points = [];
    for (let i = 0; i < 12; i++) {
      const y = (i - 6) * 0.06;
      points.push(new THREE.Vector3(-1.5, y, 0));
      points.push(new THREE.Vector3(1.5, y + (Math.random() - 0.5) * 0.02, 0));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({
      color: 0x00d4ff,
      transparent: true,
      opacity: 0.12,
    });
    this.flowLines = new THREE.LineSegments(geo, mat);
    this.flowLines.position.z = 0.35;
    this.scene.add(this.flowLines);
  }

  setDeflection(deflectionMm) {
    this.targetDeflection = Math.max(-1, Math.min(0, deflectionMm / -8.47));
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
    this.controls.update();

    if (this.mfcUpper) {
      const pulse = 0.4 + Math.sin(performance.now() * 0.003) * 0.3;
      this.mfcUpper.material.emissiveIntensity = pulse;
      this.mfcLower.material.emissiveIntensity = pulse;
    }

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
  }
}

export class ParticleBackground {
  constructor(canvas) {
    this.canvas = canvas;
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

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 20;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 20;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 10;

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
    this.points.rotation.y += 0.0003;
    this.points.rotation.x += 0.0001;
    this.renderer.render(this.scene, this.camera);
  }
}
