/**
 * Three.js — 3D response surface (CL vs voltages)
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class ResponseSurfaceScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.mesh = null;
    this.wireframe = null;
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

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;

    const ambient = new THREE.AmbientLight(0x223344, 0.5);
    this.scene.add(ambient);

    const dir = new THREE.DirectionalLight(0x00d4ff, 1);
    dir.position.set(5, 10, 5);
    this.scene.add(dir);

    const grid = new THREE.GridHelper(10, 10, 0x00d4ff, 0x112233);
    grid.material.opacity = 0.1;
    grid.material.transparent = true;
    grid.position.y = -0.01;
    this.scene.add(grid);

    this._addAxes();
    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
    this._animate();
  }

  _addAxes() {
    const labels = [
      { text: 'Lower V', pos: [0, -0.5, 5.5], color: '#ef4444' },
      { text: 'Upper V', pos: [5.5, -0.5, 0], color: '#10b981' },
      { text: 'CL', pos: [-0.8, 3, 0], color: '#00d4ff' },
    ];
    this.axisLabels = labels;
  }

  updateSurface(data, pitch) {
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
    if (this.marker) {
      this.scene.remove(this.marker);
    }

    const lowerVs = [...new Set(data.map((d) => d.lower_v))].sort((a, b) => a - b);
    const upperVs = [...new Set(data.map((d) => d.upper_v))].sort((a, b) => a - b);
    const rows = lowerVs.length;
    const cols = upperVs.length;

    const clValues = data.map((d) => d.cl);
    const clMin = Math.min(...clValues);
    const clMax = Math.max(...clValues);
    const clRange = clMax - clMin || 0.01;

    const geometry = new THREE.PlaneGeometry(10, 10, cols - 1, rows - 1);
    const positions = geometry.attributes.position;

    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const idx = i * cols + j;
        const point = data.find(
          (d) => d.lower_v === lowerVs[i] && d.upper_v === upperVs[j],
        );
        const cl = point ? point.cl : 0;
        const vi = idx;

        positions.setX(vi, (j / (cols - 1) - 0.5) * 10);
        positions.setZ(vi, (i / (rows - 1) - 0.5) * 10);
        positions.setY(vi, ((cl - clMin) / clRange) * 4);
      }
    }

    geometry.computeVertexNormals();

    const colors = [];
    const color = new THREE.Color();
    for (let i = 0; i < positions.count; i++) {
      const y = positions.getY(i);
      const t = y / 4;
      color.setHSL(0.55 - t * 0.35, 0.8, 0.45 + t * 0.15);
      colors.push(color.r, color.g, color.b);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const material = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      metalness: 0.3,
      roughness: 0.4,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.scene.add(this.mesh);

    const wireGeo = new THREE.WireframeGeometry(geometry);
    const wireMat = new THREE.LineBasicMaterial({
      color: 0x00d4ff,
      transparent: true,
      opacity: 0.08,
    });
    this.wireframe = new THREE.LineSegments(wireGeo, wireMat);
    this.scene.add(this.wireframe);

    this.pitchLabel = pitch;
  }

  highlightPoint(lowerV, upperV, cl, data) {
    if (this.marker) this.scene.remove(this.marker);

    const lowerVs = [...new Set(data.map((d) => d.lower_v))].sort((a, b) => a - b);
    const upperVs = [...new Set(data.map((d) => d.upper_v))].sort((a, b) => a - b);
    const clValues = data.map((d) => d.cl);
    const clMin = Math.min(...clValues);
    const clMax = Math.max(...clValues);
    const clRange = clMax - clMin || 0.01;

    const li = lowerVs.reduce(
      (best, v, i) => (Math.abs(v - lowerV) < Math.abs(lowerVs[best] - lowerV) ? i : best),
      0,
    );
    const ui = upperVs.reduce(
      (best, v, i) => (Math.abs(v - upperV) < Math.abs(upperVs[best] - upperV) ? i : best),
      0,
    );

    const x = (ui / (upperVs.length - 1) - 0.5) * 10;
    const z = (li / (lowerVs.length - 1) - 0.5) * 10;
    const y = ((cl - clMin) / clRange) * 4;

    const geo = new THREE.SphereGeometry(0.15, 16, 16);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff3366,
      transparent: true,
      opacity: 0.9,
    });
    this.marker = new THREE.Mesh(geo, mat);
    this.marker.position.set(x, y + 0.2, z);

    const ringGeo = new THREE.RingGeometry(0.2, 0.3, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff3366,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    this.marker.add(ring);

    this.scene.add(this.marker);
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
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    this.controls.update();

    if (this.marker) {
      this.marker.rotation.y += 0.02;
      const scale = 1 + Math.sin(performance.now() * 0.005) * 0.15;
      this.marker.scale.setScalar(scale);
    }

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
  }
}
