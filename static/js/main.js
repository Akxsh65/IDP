/**
 * IDP Morphing Wing — Main Application Controller
 */
import { WingScene, ParticleBackground } from './wing3d.js';
import { ResponseSurfaceScene } from './surface3d.js';
import { MlpForwardAnimation } from './mlpAnimation.js';

const appState = {
  constraints: {},
  cl_max: {},
  predictions: [],
  recommendations: [],
  charts: {},
  surfaceData: null,
  wingScene: null,
  surfaceScene: null,
  livePreviewEnabled: true,
  livePreviewTimer: null,
  isLiveUpdating: false,
  parityLoaded: false,
  isSweeping: false,
  surfaceLoadSeq: 0,
  surfaceLoadTimer: null,
  surfaceCoefficientMode: 'cl',
  mlpAnimation: null,
  sessionMaxLD: null,
};

const CHART_COLORS = {
  cyan: 'rgba(0, 212, 255, 0.8)',
  purple: 'rgba(124, 58, 237, 0.8)',
  green: 'rgba(16, 185, 129, 0.8)',
  red: 'rgba(239, 68, 68, 0.8)',
  grid: 'rgba(255, 255, 255, 0.06)',
  text: '#94a3b8',
};

Chart.defaults.color = CHART_COLORS.text;
Chart.defaults.borderColor = CHART_COLORS.grid;
Chart.defaults.font.family = "'Outfit', sans-serif";

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('currentYear').textContent = new Date().getFullYear();

  initTabs();
  initRevealObserver();
  initSliderFills();
  initEventListeners();
  initPipelineObserver();

  const bgCanvas = document.getElementById('bgCanvas');
  if (bgCanvas) new ParticleBackground(bgCanvas);

  await loadConstraints();
  initWing3D();
  await initializeCharts();
  initDeflectionProfile();
  initSweepChart();
  initSweepPlayer();
  initSurfaceModeToggle();
  initMlpAnimation();
  initEfficiencyGauge(3.47);
  await loadResponseSurface();
  scheduleLivePreview();

  setTimeout(hideLoader, 1800);
});

function hideLoader() {
  document.getElementById('loader').classList.add('hidden');
  document.querySelectorAll('.reveal').forEach((el, i) => {
    setTimeout(() => el.classList.add('visible'), (el.dataset.delay || i * 80) | 0);
  });
}

// ===== TABS =====
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach((b) => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');

      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      const panel = document.getElementById(tab);
      panel.classList.add('active');

      panel.querySelectorAll('.reveal:not(.visible)').forEach((el, i) => {
        setTimeout(() => el.classList.add('visible'), i * 80);
      });

      if (tab === 'forward' && appState.surfaceScene) {
        setTimeout(() => appState.surfaceScene._resize(), 100);
      }
      if (tab === 'overview' && appState.wingScene) {
        setTimeout(() => appState.wingScene._resize(), 100);
      }
      if (tab === 'results') {
        animateCounters();
        loadAndRenderParityData();
      }
    });
  });
}

function initRevealObserver() {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) e.target.classList.add('visible');
      });
    },
    { threshold: 0.1 },
  );
  document.querySelectorAll('.reveal').forEach((el) => observer.observe(el));
}

function initPipelineObserver() {
  const pipeline = document.querySelector('.pipeline');
  if (!pipeline) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) startPipelineIdleAnimation();
      });
    },
    { threshold: 0.3 },
  );
  observer.observe(pipeline);
}

function startPipelineIdleAnimation() {
  const nodes = document.querySelectorAll('.pipeline-node');
  let step = 0;

  const cycle = () => {
    nodes.forEach((n, i) => n.classList.toggle('pipeline-active', i === step));
    step = (step + 1) % nodes.length;
  };

  cycle();
  if (appState._pipelineInterval) clearInterval(appState._pipelineInterval);
  appState._pipelineInterval = setInterval(cycle, 2200);
}

function animatePipelineSequence() {
  const nodes = document.querySelectorAll('.pipeline-node');
  const connectors = document.querySelectorAll('.pipeline-connector');

  nodes.forEach((n) => n.classList.remove('pipeline-active', 'pipeline-done'));
  connectors.forEach((c) => c.classList.remove('connector-active'));

  if (appState._pipelineInterval) {
    clearInterval(appState._pipelineInterval);
    appState._pipelineInterval = null;
  }

  const steps = nodes.length;
  for (let i = 0; i < steps; i++) {
    setTimeout(() => {
      nodes.forEach((n, idx) => {
        n.classList.toggle('pipeline-active', idx === i);
        n.classList.toggle('pipeline-done', idx < i);
      });
      if (i > 0) connectors[i - 1]?.classList.add('connector-active');
    }, i * 350);
  }

  setTimeout(() => {
    nodes.forEach((n) => {
      n.classList.remove('pipeline-active');
      n.classList.add('pipeline-done');
    });
    connectors.forEach((c) => c.classList.add('connector-active'));
    setTimeout(startPipelineIdleAnimation, 2000);
  }, steps * 350 + 400);
}

// ===== SLIDER FILLS =====
function initSliderFills() {
  const sliders = [
    { slider: 'lowerVoltageSlider', fill: 'lowerVoltageFill', min: -500, max: -50 },
    { slider: 'upperVoltageSlider', fill: 'upperVoltageFill', min: 50, max: 1500 },
    { slider: 'pitchAngleSlider', fill: 'pitchAngleFill', min: -4, max: 20 },
    { slider: 'inversePitchSlider', fill: 'inversePitchFill', min: -4, max: 20 },
  ];

  sliders.forEach(({ slider, fill, min, max }) => {
    const el = document.getElementById(slider);
    const fillEl = document.getElementById(fill);
    if (!el || !fillEl) return;

    const update = () => {
      const pct = ((el.value - min) / (max - min)) * 100;
      fillEl.style.width = `${pct}%`;
    };
    el.addEventListener('input', update);
    update();
  });
}

function syncSliderFill(sliderId) {
  const el = document.getElementById(sliderId);
  if (!el) return;
  el.dispatchEvent(new Event('input'));
}

function syncWingInputs() {
  const lower = parseFloat(document.getElementById('lowerVoltage').value);
  const upper = parseFloat(document.getElementById('upperVoltage').value);
  const pitch = parseFloat(document.getElementById('pitchAngle').value);

  appState.wingScene?.setVoltages(lower, upper);
  appState.wingScene?.setPitchAngle(pitch);
  updatePitchBadge(pitch);
  updateVoltageGauges(lower, upper);
}

function updatePitchBadge(pitch) {
  const el = document.getElementById('overviewPitch');
  if (el) el.textContent = `${pitch}° AoA`;
  const hud = document.getElementById('wingHudAoA');
  if (hud) hud.textContent = `${pitch}°`;
}

function updateVoltageGauges(lower, upper) {
  const lowerPct = ((Math.abs(lower) - 50) / 450) * 100;
  const upperPct = ((upper - 50) / 1450) * 100;

  const lowerFill = document.getElementById('lowerVoltageGauge');
  const upperFill = document.getElementById('upperVoltageGauge');
  if (lowerFill) lowerFill.style.width = `${Math.min(100, lowerPct)}%`;
  if (upperFill) upperFill.style.width = `${Math.min(100, upperPct)}%`;

  const lowerVal = document.getElementById('gaugeLowerVal');
  const upperVal = document.getElementById('gaugeUpperVal');
  if (lowerVal) lowerVal.textContent = `${lower} V`;
  if (upperVal) upperVal.textContent = `${upper} V`;

  const hudLo = document.getElementById('wingHudLower');
  const hudUp = document.getElementById('wingHudUpper');
  if (hudLo) hudLo.textContent = `${lower} V`;
  if (hudUp) hudUp.textContent = `${upper} V`;
}

// ===== 3D =====
function initWing3D() {
  const canvas = document.getElementById('wingCanvas');
  if (!canvas) return;
  appState.wingScene = new WingScene(canvas);
  appState.wingScene.setDeflection(-3.7164);
  appState.wingScene.setPitchAngle(8);
  appState.wingScene.setVoltages(-250, 750);
  appState.wingScene.setFlowIntensity(0.11483);
  updateOverviewDeflection(-3.7164);
  updatePitchBadge(8);
  updateVoltageGauges(-250, 750);
}

function updateSurfacePitchLabel(pitch) {
  const pitchEl = document.getElementById('surfacePitchLabel');
  if (pitchEl) pitchEl.textContent = `${pitch}° AoA`;
}

function scheduleResponseSurfaceLoad() {
  clearTimeout(appState.surfaceLoadTimer);
  appState.surfaceLoadTimer = setTimeout(() => loadResponseSurface(), 350);
}

async function loadResponseSurface(pitch) {
  const p = pitch ?? parseFloat(document.getElementById('pitchAngle')?.value ?? 8);
  updateSurfacePitchLabel(p);

  const seq = ++appState.surfaceLoadSeq;

  try {
    const res = await fetch(`/api/response-surface?pitch=${p}`);
    const json = await res.json();

    // Ignore out-of-order responses from earlier slider positions.
    if (seq !== appState.surfaceLoadSeq) return;

    appState.surfaceData = json.data;

    const canvas = document.getElementById('surfaceCanvas');
    if (!canvas) return;

    if (!appState.surfaceScene) {
      appState.surfaceScene = new ResponseSurfaceScene(canvas);
    }
    appState.surfaceScene.updateSurface(json.data, p, appState.surfaceCoefficientMode);
    refreshSurfaceMarker();
  } catch (err) {
    if (seq === appState.surfaceLoadSeq) {
      console.error('Surface load error:', err);
    }
  }
}

function refreshSurfaceMarker() {
  if (!appState.surfaceScene || !appState.surfaceData) return;

  const lower_v = parseFloat(document.getElementById('lowerVoltage')?.value);
  const upper_v = parseFloat(document.getElementById('upperVoltage')?.value);
  const mode = appState.surfaceCoefficientMode;
  const valueEl = mode === 'cd'
    ? document.getElementById('cdResult')?.querySelector('.value')
    : document.getElementById('clResult')?.querySelector('.value');
  const coeff = parseFloat(valueEl?.textContent);

  if (Number.isFinite(lower_v) && Number.isFinite(upper_v) && Number.isFinite(coeff)) {
    appState.surfaceScene.highlightPoint(lower_v, upper_v, coeff, appState.surfaceData);
  }
}

// ===== CONSTRAINTS =====
async function loadConstraints() {
  try {
    const res = await fetch('/api/constraints');
    const data = await res.json();
    appState.constraints = data.constraints;
    appState.cl_max = data.cl_max_by_pitch;
  } catch (err) {
    console.error('Constraints error:', err);
  }
}

// ===== LIVE PREVIEW =====
function scheduleLivePreview() {
  if (!appState.livePreviewEnabled) return;
  clearTimeout(appState.livePreviewTimer);
  appState.livePreviewTimer = setTimeout(runLivePreview, 450);
}

function setLiveIndicator(active) {
  const el = document.getElementById('livePreviewBadge');
  if (!el) return;
  el.classList.toggle('live-active', active);
  const label = el.querySelector('.live-badge-label');
  if (label) label.textContent = active ? 'Updating…' : 'Live Preview';
}

async function runLivePreview() {
  if (appState.isLiveUpdating) return;

  const lower_v = parseFloat(document.getElementById('lowerVoltage').value);
  const upper_v = parseFloat(document.getElementById('upperVoltage').value);
  const pitch = parseFloat(document.getElementById('pitchAngle').value);

  syncWingInputs();
  appState.isLiveUpdating = true;
  setLiveIndicator(true);

  try {
    const res = await fetch('/api/predict-forward', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lower_voltage: lower_v, upper_voltage: upper_v, pitch_angle: pitch }),
    });
    const data = await res.json();

    if (data.success) {
      applyPredictionResults(data.results, lower_v, upper_v, { silent: true, skipHistory: true });
    }
  } catch (err) {
    console.warn('Live preview error:', err);
  } finally {
    appState.isLiveUpdating = false;
    setLiveIndicator(false);
  }
}

// ===== EVENT LISTENERS =====
function initEventListeners() {
  document.getElementById('forwardForm').addEventListener('submit', handleForwardPrediction);
  document.getElementById('inverseForm').addEventListener('submit', handleInversePrediction);

  bindSlider('lowerVoltageSlider', 'lowerVoltage', () => {
    syncWingInputs();
    scheduleLivePreview();
  });
  bindSlider('upperVoltageSlider', 'upperVoltage', () => {
    syncWingInputs();
    scheduleLivePreview();
  });
  bindSlider('pitchAngleSlider', 'pitchAngle', () => {
    const pitch = parseFloat(document.getElementById('pitchAngle').value);
    syncWingInputs();
    updateSurfacePitchLabel(pitch);
    scheduleResponseSurfaceLoad();
    scheduleLivePreview();
  });
  bindSlider('inversePitchSlider', 'inversePitchAngle');

  document.getElementById('refreshSurface')?.addEventListener('click', () => {
    const pitch = parseFloat(document.getElementById('pitchAngle').value);
    loadResponseSurface(pitch);
    showToast('Response surface refreshed', 'success');
  });

  document.getElementById('livePreviewToggle')?.addEventListener('change', (e) => {
    appState.livePreviewEnabled = e.target.checked;
    if (appState.livePreviewEnabled) scheduleLivePreview();
  });
}

function bindSlider(sliderId, inputId, onChange) {
  const slider = document.getElementById(sliderId);
  const input = document.getElementById(inputId);
  if (!slider || !input) return;

  slider.addEventListener('input', (e) => {
    input.value = e.target.value;
    syncSliderFill(sliderId);
    onChange?.();
  });
  input.addEventListener('change', (e) => {
    slider.value = e.target.value;
    syncSliderFill(sliderId);
    onChange?.();
  });
}

function applyPredictionResults(r, lower_v, upper_v, opts = {}) {
  animateMetric('deflectionResult', r.deflection_mm, 'mm');
  animateMetric('clResult', r.cl, '—');
  animateMetric('cdResult', r.cd, '—');
  updateEfficiencyGauge(r.l_d_ratio);

  if (!opts.skipHistory) {
    if (!Array.isArray(appState.predictions)) appState.predictions = [];
    appState.predictions.push(r);
    updateHistoryChart();
  }

  appState.wingScene?.setDeflection(r.deflection_mm);
  appState.wingScene?.setFlowIntensity(r.cl);
  updateOverviewDeflection(r.deflection_mm);
  updateDeflectionProfile(r.deflection_mm);

  updateAeroChart(r.cl, r.cd);

  if (appState.surfaceScene && appState.surfaceData) {
    const mode = appState.surfaceCoefficientMode;
    const coeff = mode === 'cd' ? r.cd : r.cl;
    appState.surfaceScene.highlightPoint(lower_v, upper_v, coeff, appState.surfaceData);
  }

  document.querySelectorAll('.metric-card').forEach((card) => {
    card.classList.remove('metric-pulse');
    void card.offsetWidth;
    card.classList.add('metric-pulse');
  });

  if (!opts.silent) showToast('Prediction complete', 'success');

  if (!opts.skipMlpAnimation) {
    appState.mlpAnimation?.play({
      deflection_mm: r.deflection_mm,
      alpha_deg: parseFloat(document.getElementById('pitchAngle')?.value ?? 8),
      cl: r.cl,
      cd: r.cd,
    }).catch((err) => console.warn('MLP animation error:', err));
  }
}

// ===== FORWARD PREDICTION =====
async function handleForwardPrediction(e) {
  e.preventDefault();
  const errorDiv = document.getElementById('forwardErrors');
  errorDiv.style.display = 'none';

  const btn = document.getElementById('forwardSubmit');
  btn.classList.add('loading');
  animatePipelineSequence();

  const lower_v = parseFloat(document.getElementById('lowerVoltage').value);
  const upper_v = parseFloat(document.getElementById('upperVoltage').value);
  const pitch = parseFloat(document.getElementById('pitchAngle').value);

  try {
    const res = await fetch('/api/predict-forward', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lower_voltage: lower_v, upper_voltage: upper_v, pitch_angle: pitch }),
    });
    const data = await res.json();

    if (!data.success) {
      displayErrors(data.errors || [data.error], errorDiv);
      return;
    }

    applyPredictionResults(data.results, lower_v, upper_v);
  } catch (err) {
    displayErrors([err.message], errorDiv);
  } finally {
    btn.classList.remove('loading');
  }
}

function updateOverviewDeflection(val) {
  const formatted = `${Math.abs(val).toFixed(4)} mm`;
  const signed = val < 0 ? `−${formatted}` : formatted;
  const el = document.getElementById('overviewDeflection');
  if (el) {
    el.textContent = signed;
    el.classList.add('deflection-flash');
    setTimeout(() => el.classList.remove('deflection-flash'), 700);
  }
  const hud = document.getElementById('wingHudDeflection');
  if (hud) hud.textContent = val < 0 ? `−${Math.abs(val).toFixed(2)} mm` : `${val.toFixed(2)} mm`;
}

function animateMetric(containerId, value, unit) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const valEl = container.querySelector('.value') || container;
  const isSpan = valEl.classList?.contains('value');
  const target = parseFloat(value);
  const start = parseFloat(valEl.textContent || valEl.dataset?.value || 0);
  const duration = 600;
  const startTime = performance.now();

  const step = (now) => {
    const t = Math.min(1, (now - startTime) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const current = start + (target - start) * eased;
    const formatted = Math.abs(target) < 0.01 ? current.toFixed(6) : current.toFixed(4);

    if (isSpan) {
      valEl.textContent = formatted;
      valEl.classList.add('flash');
      setTimeout(() => valEl.classList.remove('flash'), 600);
    } else {
      container.innerHTML = `<span class="value">${formatted}</span><span class="unit">${unit}</span>`;
    }

    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ===== INVERSE PREDICTION =====
async function handleInversePrediction(e) {
  e.preventDefault();
  const errorDiv = document.getElementById('inverseErrors');
  errorDiv.style.display = 'none';

  const btn = document.getElementById('inverseSubmit');
  btn.classList.add('loading');

  const target_cl = parseFloat(document.getElementById('targetCL').value);
  const pitch = parseFloat(document.getElementById('inversePitchAngle').value);
  const use_max_cd = document.getElementById('useMaxCD').checked;
  const max_cd = use_max_cd ? parseFloat(document.getElementById('maxCD').value) : null;

  const cl_max = appState.cl_max[Math.round(pitch)] || 0.3079;
  if (target_cl > cl_max) {
    displayErrors(
      [`Target CL (${target_cl}) exceeds maximum at ${pitch}° angle of attack (${cl_max.toFixed(4)})`],
      errorDiv,
    );
    btn.classList.remove('loading');
    return;
  }

  try {
    const res = await fetch('/api/predict-inverse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_cl, pitch_angle: pitch, max_cd }),
    });
    const data = await res.json();

    if (!data.success) {
      displayErrors(data.errors || [data.error], errorDiv);
      return;
    }

    appState.recommendations = data.recommendations;
    displayRecommendations(data);
    showToast('Inverse search complete', 'success');
  } catch (err) {
    displayErrors([err.message], errorDiv);
  } finally {
    btn.classList.remove('loading');
  }
}

async function applyRecommendation(rec) {
  document.getElementById('lowerVoltage').value = rec.lower_voltage;
  document.getElementById('upperVoltage').value = rec.upper_voltage;
  document.getElementById('pitchAngle').value = document.getElementById('inversePitchAngle').value;
  document.getElementById('lowerVoltageSlider').value = rec.lower_voltage;
  document.getElementById('upperVoltageSlider').value = rec.upper_voltage;
  document.getElementById('pitchAngleSlider').value = document.getElementById('inversePitchAngle').value;

  syncSliderFill('lowerVoltageSlider');
  syncSliderFill('upperVoltageSlider');
  syncSliderFill('pitchAngleSlider');
  syncWingInputs();

  document.querySelectorAll('.recommendation-box').forEach((box) => box.classList.remove('rec-selected'));
  document.querySelector(`[data-rec-index="${rec._index}"]`)?.classList.add('rec-selected');

  animatePipelineSequence();

  const pitch = parseFloat(document.getElementById('pitchAngle').value);
  await loadResponseSurface(pitch);

  try {
    const res = await fetch('/api/predict-forward', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lower_voltage: rec.lower_voltage,
        upper_voltage: rec.upper_voltage,
        pitch_angle: pitch,
      }),
    });
    const data = await res.json();
    if (data.success) {
      applyPredictionResults(data.results, rec.lower_voltage, rec.upper_voltage);
      document.querySelector('.tab-btn[data-tab="forward"]')?.click();
    }
  } catch (err) {
    showToast('Could not preview recommendation', 'error');
  }
}

// ===== RECOMMENDATIONS =====
function displayRecommendations(data) {
  const container = document.getElementById('recommendationsContainer');
  const tableDiv = document.getElementById('recommendationsTable');

  let html = '<div class="rec-grid">';
  data.recommendations.forEach((rec, idx) => {
    rec._index = idx;
    const badge = rec.satisfies_constraint
      ? '<span class="constraint-badge satisfied"><i class="fas fa-check"></i> CD OK</span>'
      : '<span class="constraint-badge violated"><i class="fas fa-times"></i> CD High</span>';

    html += `
      <div class="recommendation-box" data-rec-index="${idx}" role="button" tabindex="0" aria-label="Preview recommendation ${idx + 1}">
        <div class="rank-badge">${idx + 1}</div>
        <div class="voltage-pair">
          <div class="voltage-item">
            <label>Lower V</label>
            <div class="value">${rec.lower_voltage}</div>
            <small>V</small>
          </div>
          <div class="voltage-item">
            <label>Upper V</label>
            <div class="value">${rec.upper_voltage}</div>
            <small>V</small>
          </div>
        </div>
        <div class="rec-stats">
          <div><small>Predicted CL</small><strong style="color:var(--green)">${rec.predicted_cl}</strong></div>
          <div><small>Predicted CD</small><strong style="color:var(--green)">${rec.predicted_cd}</strong></div>
          <div><small>CL Error</small><span>${rec.cl_error.toFixed(6)}</span></div>
          <div><small>CD Violation</small><span>${rec.cd_violation.toFixed(6)}</span></div>
        </div>
        <div class="rec-footer">
          ${badge}
          <button type="button" class="btn-preview" data-rec-index="${idx}">
            <i class="fas fa-play-circle"></i> Preview on Wing
          </button>
        </div>
      </div>`;
  });
  html += '</div>';
  container.innerHTML = html;

  container.querySelectorAll('.recommendation-box, .btn-preview').forEach((el) => {
    const idx = parseInt(el.dataset.recIndex, 10);
    const handler = (e) => {
      e.stopPropagation();
      applyRecommendation(data.recommendations[idx]);
    };
    el.addEventListener('click', handler);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handler(e);
      }
    });
  });

  let tableHtml = `
    <table class="data-table">
      <thead><tr>
        <th>#</th><th>Lower V</th><th>Upper V</th>
        <th>CL</th><th>CD</th><th>CL Error</th><th>Constraint</th>
      </tr></thead><tbody>`;

  data.recommendations.forEach((rec, idx) => {
    const badge = rec.satisfies_constraint
      ? '<span class="badge badge-success">✓ Satisfied</span>'
      : '<span class="badge badge-warning">✗ Violated</span>';
    tableHtml += `<tr>
      <td><strong>${idx + 1}</strong></td>
      <td>${rec.lower_voltage}</td><td>${rec.upper_voltage}</td>
      <td>${rec.predicted_cl}</td><td>${rec.predicted_cd}</td>
      <td>${rec.cl_error.toFixed(6)}</td><td>${badge}</td>
    </tr>`;
  });
  tableHtml += '</tbody></table>';
  tableDiv.innerHTML = tableHtml;
}

// ===== TOGGLE MAX CD (global for inline handler) =====
window.toggleMaxCD = function () {
  const cb = document.getElementById('useMaxCD');
  const input = document.getElementById('maxCD');
  input.disabled = !cb.checked;
  if (cb.checked) input.focus();
};

// ===== ERRORS & TOASTS =====
function displayErrors(errors, errorDiv) {
  errorDiv.innerHTML =
    '<strong><i class="fas fa-exclamation-triangle"></i> Validation Errors</strong><ul>' +
    errors.map((e) => `<li>${e}</li>`).join('') +
    '</ul>';
  errorDiv.style.display = 'block';
  showToast(errors[0], 'error');
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(40px)';
    toast.style.transition = '0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ===== COUNTERS =====
function animateCounters() {
  document.querySelectorAll('.augment-num[data-count]').forEach((el) => {
    const target = parseInt(el.dataset.count, 10);
    const duration = 1500;
    const start = performance.now();

    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(target * eased).toLocaleString();
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

// ===== CHARTS =====
async function initializeCharts() {
  const chartOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { usePointStyle: true, padding: 16 } } },
  };

  const accuracyCtx = document.getElementById('accuracyChart');
  if (accuracyCtx) {
    appState.charts.accuracy = new Chart(accuracyCtx, {
      type: 'bar',
      data: {
        labels: ['Structural (Deflection)', 'Aerodynamic (CL)', 'Aerodynamic (CD)'],
        datasets: [{
          label: 'MAE',
          data: [0.00164, 0.00343, 0.00221],
          backgroundColor: [CHART_COLORS.purple, CHART_COLORS.green, CHART_COLORS.cyan],
          borderColor: ['#7c3aed', '#10b981', '#00d4ff'],
          borderWidth: 2,
          borderRadius: 8,
        }],
      },
      options: {
        ...chartOpts,
        plugins: { ...chartOpts.plugins, legend: { display: false } },
        scales: {
          y: {
            beginAtZero: true,
            grid: { color: CHART_COLORS.grid },
            ticks: { callback: (v) => v.toFixed(4) },
          },
          x: { grid: { display: false } },
        },
        animation: { duration: 1200, easing: 'easeOutQuart' },
      },
    });
  }

  const r2Ctx = document.getElementById('r2Chart');
  if (r2Ctx) {
    appState.charts.r2 = new Chart(r2Ctx, {
      type: 'radar',
      data: {
        labels: ['Structural', 'CL', 'CD'],
        datasets: [{
          label: 'R² Score',
          data: [0.999998, 0.993, 0.988],
          borderColor: '#00d4ff',
          backgroundColor: 'rgba(0, 212, 255, 0.15)',
          pointBackgroundColor: '#00d4ff',
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          pointRadius: 6,
          borderWidth: 2,
        }],
      },
      options: {
        ...chartOpts,
        scales: {
          r: {
            beginAtZero: true,
            max: 1.0,
            ticks: { stepSize: 0.2, backdropColor: 'transparent' },
            grid: { color: CHART_COLORS.grid },
            angleLines: { color: CHART_COLORS.grid },
            pointLabels: { font: { size: 12 } },
          },
        },
        animation: { duration: 1200 },
      },
    });
  }

  const aeroCtx = document.getElementById('aeroChart');
  if (aeroCtx) {
    appState.charts.aero = new Chart(aeroCtx, {
      type: 'doughnut',
      data: {
        labels: ['Lift (CL)', 'Drag (CD)'],
        datasets: [{
          data: [0.11483, 0.03304],
          backgroundColor: [CHART_COLORS.green, CHART_COLORS.red],
          borderColor: 'rgba(12, 20, 36, 0.8)',
          borderWidth: 3,
          hoverOffset: 8,
        }],
      },
      options: {
        ...chartOpts,
        cutout: '65%',
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true } },
        },
        animation: { animateRotate: true, duration: 1000 },
      },
    });
  }

  const historyCtx = document.getElementById('historyChart');
  if (historyCtx) {
    appState.charts.history = new Chart(historyCtx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'CL',
            data: [],
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            tension: 0.4,
            fill: true,
            pointRadius: 4,
            pointHoverRadius: 7,
          },
          {
            label: 'CD',
            data: [],
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            tension: 0.4,
            fill: true,
            pointRadius: 4,
            pointHoverRadius: 7,
          },
        ],
      },
      options: {
        ...chartOpts,
        scales: {
          y: { beginAtZero: true, grid: { color: CHART_COLORS.grid } },
          x: { grid: { color: CHART_COLORS.grid } },
        },
        animation: { duration: 800 },
      },
    });
  }
}

function updateAeroChart(cl, cd) {
  if (appState.charts.aero) {
    appState.charts.aero.data.datasets[0].data = [cl, cd];
    appState.charts.aero.update('active');
  }
}

function updateHistoryChart() {
  if (!appState.charts.history || appState.predictions.length === 0) return;
  const recent = appState.predictions.slice(-10);
  appState.charts.history.data.labels = recent.map((_, i) => `#${i + 1}`);
  appState.charts.history.data.datasets[0].data = recent.map((p) => p.cl);
  appState.charts.history.data.datasets[1].data = recent.map((p) => p.cd);
  appState.charts.history.update('active');
}

// ============================================================
// SIMULATION 1: CHORD-WISE DEFLECTION PROFILE
// ============================================================

/** Generate NACA 0009 airfoil surface points with trailing-edge morphing.
 *  Returns cosine-spaced {x,y} arrays (mm) for upper and lower surfaces.
 *  Both surfaces translate downward together in the morphing zone (80–100% chord),
 *  representing bending of the entire cross-section like a flap. */
function generateNACAPts(deflection_mm) {
  const chord = 127;
  const morphStart = 0.8;
  const N = 90;

  // NACA 4-digit thickness distribution (symmetric, t = 9%)
  const thk = (x) => {
    if (x <= 0) return 0;
    const t = 0.09;
    return (t / 0.2) *
      (0.2969 * Math.sqrt(x) - 0.1260 * x - 0.3516 * x * x +
       0.2843 * x * x * x - 0.1015 * x * x * x * x) * chord;
  };

  // Cubic Hermite: zero slope at morph start, full deflection at trailing edge
  const morphOffset = (x) => {
    if (x <= morphStart) return 0;
    const s = (x - morphStart) / (1 - morphStart);
    return deflection_mm * (3 * s * s - 2 * s * s * s);
  };

  const upper = [];
  const lower = [];

  for (let i = 0; i <= N; i++) {
    // Cosine spacing — denser near LE and TE for accurate shape
    const beta = (Math.PI * i) / N;
    const x = (1 - Math.cos(beta)) / 2;
    const xMm = parseFloat((x * chord).toFixed(2));
    const t = thk(x);
    const d = morphOffset(x);
    upper.push({ x: xMm, y: parseFloat((t + d).toFixed(3)) });
    lower.push({ x: xMm, y: parseFloat((-t + d).toFixed(3)) });
  }

  return { upper, lower, morphX: parseFloat((morphStart * chord).toFixed(1)) };
}

function initDeflectionProfile() {
  const ctx = document.getElementById('deflectionProfileChart');
  if (!ctx) return;

  const { upper, lower } = generateNACAPts(-3.7164);

  appState.charts.deflectionProfile = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'Upper Surface',
          data: upper,
          borderColor: '#00d4ff',
          backgroundColor: 'transparent',
          pointRadius: 0,
          pointHoverRadius: 0,
          pointHitRadius: 0,
          showLine: true,
          borderWidth: 2.5,
          tension: 0.35,
          fill: false,
          order: 1,
        },
        {
          label: 'Lower Surface',
          data: lower,
          borderColor: '#f97316',
          backgroundColor: 'transparent',
          pointRadius: 0,
          pointHoverRadius: 0,
          pointHitRadius: 0,
          showLine: true,
          borderWidth: 2.5,
          tension: 0.35,
          fill: false,
          order: 2,
        },
        {
          label: 'Morph start (80% c)',
          data: [{ x: 101.6, y: -14 }, { x: 101.6, y: 8 }],
          borderColor: 'rgba(124, 58, 237, 0.55)',
          pointRadius: 0,
          pointHoverRadius: 0,
          pointHitRadius: 0,
          borderWidth: 1.5,
          borderDash: [5, 4],
          fill: false,
          order: 3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      elements: {
        point: { radius: 0, hoverRadius: 0 },
        line: { tension: 0.35 },
      },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            usePointStyle: false,
            boxWidth: 28,
            boxHeight: 3,
            padding: 14,
            font: { size: 10 },
          },
        },
        tooltip: {
          filter: (item) => item.datasetIndex < 2,
          callbacks: {
            label: (ctx) =>
              `${ctx.dataset.label}: x=${ctx.parsed.x.toFixed(1)} mm, y=${ctx.parsed.y.toFixed(2)} mm`,
          },
        },
      },
      scales: {
        x: {
          type: 'linear',
          min: 0,
          max: 127,
          title: { display: true, text: 'Chord position (mm)', font: { size: 11 }, color: CHART_COLORS.text },
          grid: { color: CHART_COLORS.grid },
          ticks: { font: { size: 10 }, color: CHART_COLORS.text },
        },
        y: {
          min: -14,
          max: 8,
          title: { display: true, text: 'Height (mm)', font: { size: 11 }, color: CHART_COLORS.text },
          grid: { color: CHART_COLORS.grid },
          ticks: { font: { size: 10 }, color: CHART_COLORS.text },
        },
      },
      animation: { duration: 350 },
    },
  });
}

function updateDeflectionProfile(deflection_mm) {
  const chart = appState.charts.deflectionProfile;
  if (!chart) return;
  const { upper, lower } = generateNACAPts(deflection_mm);
  chart.data.datasets[0].data = upper;
  chart.data.datasets[1].data = lower;
  chart.update('active');
}

// ============================================================
// SIMULATION 2: PITCH SWEEP PLAYER
// ============================================================

const PITCH_SWEEP_STEPS = [-4, 0, 4, 8, 12, 16, 20];

function initSweepChart() {
  const ctx = document.getElementById('sweepChart');
  if (!ctx) return;

  appState.charts.sweep = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'CL',
          data: [],
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.12)',
          fill: true,
          pointRadius: 5,
          pointHoverRadius: 8,
          pointBackgroundColor: '#10b981',
          tension: 0.3,
          borderWidth: 2,
        },
        {
          label: 'CD',
          data: [],
          borderColor: '#f97316',
          backgroundColor: 'rgba(249, 115, 22, 0.08)',
          fill: true,
          pointRadius: 5,
          pointHoverRadius: 8,
          pointBackgroundColor: '#f97316',
          tension: 0.3,
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { usePointStyle: true, padding: 12, font: { size: 10 } } },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: {
        x: {
          title: { display: true, text: 'Angle of Attack (°)', font: { size: 11 }, color: CHART_COLORS.text },
          grid: { color: CHART_COLORS.grid },
          ticks: { color: CHART_COLORS.text },
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: 'Coefficient', font: { size: 11 }, color: CHART_COLORS.text },
          grid: { color: CHART_COLORS.grid },
          ticks: { color: CHART_COLORS.text },
        },
      },
      animation: { duration: 500 },
    },
  });
}

function initSweepPlayer() {
  document.getElementById('sweepPlayBtn')?.addEventListener('click', () => {
    if (appState.isSweeping) {
      stopSweep();
    } else {
      runPitchSweep();
    }
  });
}

function stopSweep() {
  appState.isSweeping = false;
}

async function runPitchSweep() {
  appState.isSweeping = true;

  const btn = document.getElementById('sweepPlayBtn');
  const icon = document.getElementById('sweepIcon');
  const label = document.getElementById('sweepBtnLabel');
  const statusEl = document.getElementById('sweepStatus');

  if (btn) btn.classList.add('sweep-running');
  if (icon) icon.className = 'fas fa-stop';
  if (label) label.textContent = 'Stop Sweep';

  // Clear previous sweep data
  if (appState.charts.sweep) {
    appState.charts.sweep.data.labels = [];
    appState.charts.sweep.data.datasets[0].data = [];
    appState.charts.sweep.data.datasets[1].data = [];
    appState.charts.sweep.update();
  }

  const lower_v = parseFloat(document.getElementById('lowerVoltage').value);
  const upper_v = parseFloat(document.getElementById('upperVoltage').value);

  for (const pitch of PITCH_SWEEP_STEPS) {
    if (!appState.isSweeping) break;

    if (statusEl) statusEl.textContent = `Sweeping → ${pitch}°`;

    // Sync pitch controls + wing
    document.getElementById('pitchAngle').value = pitch;
    document.getElementById('pitchAngleSlider').value = pitch;
    syncSliderFill('pitchAngleSlider');
    appState.wingScene?.setPitchAngle(pitch);
    updatePitchBadge(pitch);

    try {
      const res = await fetch('/api/predict-forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lower_voltage: lower_v, upper_voltage: upper_v, pitch_angle: pitch }),
      });
      const data = await res.json();

      if (data.success && appState.isSweeping) {
        const r = data.results;

        // Update metric displays
        animateMetric('deflectionResult', r.deflection_mm, 'mm');
        animateMetric('clResult', r.cl, '—');
        animateMetric('cdResult', r.cd, '—');
        updateEfficiencyGauge(r.l_d_ratio);
        updateAeroChart(r.cl, r.cd);
        updateDeflectionProfile(r.deflection_mm);
        updateOverviewDeflection(r.deflection_mm);
        appState.wingScene?.setDeflection(r.deflection_mm);
        appState.wingScene?.setFlowIntensity(r.cl);

        // Append to sweep chart
        if (appState.charts.sweep) {
          appState.charts.sweep.data.labels.push(`${pitch}°`);
          appState.charts.sweep.data.datasets[0].data.push(parseFloat(r.cl.toFixed(5)));
          appState.charts.sweep.data.datasets[1].data.push(parseFloat(r.cd.toFixed(5)));
          appState.charts.sweep.update('active');
        }

        // Update 3D surface for this pitch step
        await loadResponseSurface(pitch);
      }
    } catch (err) {
      console.warn('Sweep step error at pitch', pitch, err);
    }

    await new Promise((resolve) => setTimeout(resolve, 750));
  }

  // Restore button
  appState.isSweeping = false;
  if (btn) btn.classList.remove('sweep-running');
  if (icon) icon.className = 'fas fa-play';
  if (label) label.textContent = 'Sweep −4° → 20°';
  if (statusEl) statusEl.textContent = 'Sweep complete ✓';
  showToast('Angle-of-attack sweep complete', 'success');
}

// ============================================================
// SIMULATION 3: PARITY PLOT — PREDICTED vs ACTUAL
// ============================================================

const PITCH_COLORS = {
  '-4': '#6366f1',
  '0': '#06b6d4',
  '4': '#10b981',
  '8': '#84cc16',
  '12': '#f59e0b',
  '16': '#f97316',
  '20': '#ef4444',
};

async function loadAndRenderParityData() {
  if (appState.parityLoaded) return;

  try {
    const res = await fetch('/api/parity-data');
    const data = await res.json();
    if (!data.success) return;
    appState.parityLoaded = true;
    renderParityCharts(data.points);
  } catch (err) {
    console.error('Parity data fetch error:', err);
  }
}

function renderParityCharts(points) {
  // Group points by pitch angle
  const byPitch = {};
  points.forEach((p) => {
    const key = String(p.pitch_deg);
    if (!byPitch[key]) byPitch[key] = [];
    byPitch[key].push(p);
  });

  const allCL = points.map((p) => p.cl);
  const allCD = points.map((p) => p.cd);
  const clMin = Math.min(...allCL) * 0.95;
  const clMax = Math.max(...allCL) * 1.05;
  const cdMin = Math.min(...allCD) * 0.9;
  const cdMax = Math.max(...allCD) * 1.1;

  const clDatasets = [];
  const cdDatasets = [];

  Object.entries(byPitch)
    .sort((a, b) => +a[0] - +b[0])
    .forEach(([pitch, pts]) => {
      const color = PITCH_COLORS[pitch] ?? '#94a3b8';
      clDatasets.push({
        label: `${pitch}°`,
        data: pts.map((p) => ({ x: p.cl, y: p.predicted_cl })),
        backgroundColor: color + 'cc',
        pointRadius: 5,
        pointHoverRadius: 8,
        pointBorderColor: 'transparent',
      });
      cdDatasets.push({
        label: `${pitch}°`,
        data: pts.map((p) => ({ x: p.cd, y: p.predicted_cd })),
        backgroundColor: color + 'cc',
        pointRadius: 5,
        pointHoverRadius: 8,
        pointBorderColor: 'transparent',
      });
    });

  // Perfect diagonal reference line
  clDatasets.push({
    label: 'Perfect (y = x)',
    data: [{ x: clMin, y: clMin }, { x: clMax, y: clMax }],
    type: 'scatter',
    showLine: true,
    borderColor: 'rgba(255,255,255,0.28)',
    borderDash: [7, 4],
    pointRadius: 0,
    borderWidth: 1.5,
    order: 0,
  });
  cdDatasets.push({
    label: 'Perfect (y = x)',
    data: [{ x: cdMin, y: cdMin }, { x: cdMax, y: cdMax }],
    type: 'scatter',
    showLine: true,
    borderColor: 'rgba(255,255,255,0.28)',
    borderDash: [7, 4],
    pointRadius: 0,
    borderWidth: 1.5,
    order: 0,
  });

  const sharedOpts = (xLabel, yLabel) => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'right',
        labels: { usePointStyle: true, padding: 8, font: { size: 10 }, color: CHART_COLORS.text },
      },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            if (ctx.dataset.label === 'Perfect (y = x)') return null;
            return `${ctx.dataset.label}: actual=${ctx.parsed.x.toFixed(5)}, pred=${ctx.parsed.y.toFixed(5)}`;
          },
        },
      },
    },
    scales: {
      x: {
        type: 'linear',
        title: { display: true, text: xLabel, font: { size: 11 }, color: CHART_COLORS.text },
        grid: { color: CHART_COLORS.grid },
        ticks: { font: { size: 10 }, color: CHART_COLORS.text },
      },
      y: {
        title: { display: true, text: yLabel, font: { size: 11 }, color: CHART_COLORS.text },
        grid: { color: CHART_COLORS.grid },
        ticks: { font: { size: 10 }, color: CHART_COLORS.text },
      },
    },
    animation: { duration: 1000 },
  });

  const clCtx = document.getElementById('parityClChart');
  const cdCtx = document.getElementById('parityCdChart');

  if (clCtx) {
    appState.charts.parityCL = new Chart(clCtx, {
      type: 'scatter',
      data: { datasets: clDatasets },
      options: sharedOpts('Actual CL', 'Predicted CL'),
    });
  }
  if (cdCtx) {
    appState.charts.parityCD = new Chart(cdCtx, {
      type: 'scatter',
      data: { datasets: cdDatasets },
      options: sharedOpts('Actual CD', 'Predicted CD'),
    });
  }
}

// ============================================================
// PHASE 2: CL / CD SURFACE TOGGLE
// ============================================================

function initSurfaceModeToggle() {
  document.querySelectorAll('[data-surface-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.surfaceMode;
      if (mode === appState.surfaceCoefficientMode) return;

      appState.surfaceCoefficientMode = mode;
      document.querySelectorAll('[data-surface-mode]').forEach((b) => {
        b.classList.toggle('active', b.dataset.surfaceMode === mode);
      });

      appState.surfaceScene?.setCoefficientMode(mode);
      refreshSurfaceMarker();
    });
  });
}

// ============================================================
// PHASE 3: MLP FORWARD-PASS ANIMATION
// ============================================================

function initMlpAnimation() {
  const container = document.getElementById('mlpAnimationContainer');
  if (!container) return;

  appState.mlpAnimation = new MlpForwardAnimation(container);
  appState.mlpAnimation.loadWeights();
}

// ============================================================
// PHASE 4: LIVE EFFICIENCY GAUGE
// ============================================================

function initEfficiencyGauge(initialLD) {
  appState.sessionMaxLD = Number.isFinite(initialLD) ? initialLD : 0;
  updateEfficiencyGauge(initialLD);
}

function updateEfficiencyGauge(ld) {
  if (!Number.isFinite(ld)) return;

  if (!Number.isFinite(appState.sessionMaxLD) || ld > appState.sessionMaxLD) {
    appState.sessionMaxLD = ld;
  }

  const max = appState.sessionMaxLD || ld;
  const pct = Math.min(100, Math.max(0, (ld / max) * 100));

  const ring = document.getElementById('ldGaugeRing');
  const valueEl = document.getElementById('ldGaugeValue');
  const maxEl = document.getElementById('ldSessionMax');

  if (ring) {
    ring.style.setProperty('--gauge-pct', `${pct}%`);
    ring.style.setProperty('--gauge-color', pct >= 95 ? '#10b981' : '#00d4ff');
  }
  if (valueEl) valueEl.textContent = ld.toFixed(2);
  if (maxEl) maxEl.textContent = max.toFixed(2);
}
