/**
 * IDP Morphing Wing — Main Application Controller
 */
import { WingScene, ParticleBackground } from './wing3d.js';
import { ResponseSurfaceScene } from './surface3d.js';

const appState = {
  constraints: {},
  cl_max: {},
  predictions: [],
  recommendations: [],
  charts: {},
  surfaceData: null,
  wingScene: null,
  surfaceScene: null,
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

  const bgCanvas = document.getElementById('bgCanvas');
  if (bgCanvas) new ParticleBackground(bgCanvas);

  await loadConstraints();
  initWing3D();
  await initializeCharts();
  await loadResponseSurface();

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
      if (tab === 'results') animateCounters();
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

// ===== 3D =====
function initWing3D() {
  const canvas = document.getElementById('wingCanvas');
  if (!canvas) return;
  appState.wingScene = new WingScene(canvas);
  appState.wingScene.setDeflection(-3.7164);
  updateOverviewDeflection(-3.7164);
}

async function loadResponseSurface(pitch) {
  const p = pitch ?? parseFloat(document.getElementById('pitchAngle')?.value ?? 8);
  try {
    const res = await fetch(`/api/response-surface?pitch=${p}`);
    const json = await res.json();
    appState.surfaceData = json.data;

    const canvas = document.getElementById('surfaceCanvas');
    if (!canvas) return;

    if (!appState.surfaceScene) {
      appState.surfaceScene = new ResponseSurfaceScene(canvas);
    }
    appState.surfaceScene.updateSurface(json.data, json.pitch);
  } catch (err) {
    console.error('Surface load error:', err);
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

// ===== EVENT LISTENERS =====
function initEventListeners() {
  document.getElementById('forwardForm').addEventListener('submit', handleForwardPrediction);
  document.getElementById('inverseForm').addEventListener('submit', handleInversePrediction);

  bindSlider('lowerVoltageSlider', 'lowerVoltage');
  bindSlider('upperVoltageSlider', 'upperVoltage');
  bindSlider('pitchAngleSlider', 'pitchAngle', () => loadResponseSurface());
  bindSlider('inversePitchSlider', 'inversePitchAngle');

  document.getElementById('refreshSurface')?.addEventListener('click', () => {
    const pitch = parseFloat(document.getElementById('pitchAngle').value);
    loadResponseSurface(pitch);
    showToast('Response surface refreshed', 'success');
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

// ===== FORWARD PREDICTION =====
async function handleForwardPrediction(e) {
  e.preventDefault();
  const errorDiv = document.getElementById('forwardErrors');
  errorDiv.style.display = 'none';

  const btn = document.getElementById('forwardSubmit');
  btn.classList.add('loading');

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

    const r = data.results;
    animateMetric('deflectionResult', r.deflection_mm, 'mm');
    animateMetric('clResult', r.cl, '—');
    animateMetric('cdResult', r.cd, '—');
    animateMetric('ldResult', r.l_d_ratio, '—');

    appState.predictions.push(r);
    appState.wingScene?.setDeflection(r.deflection_mm);
    updateOverviewDeflection(r.deflection_mm);

    updateAeroChart(r.cl, r.cd);
    updateHistoryChart();

    if (appState.surfaceScene && appState.surfaceData) {
      appState.surfaceScene.highlightPoint(lower_v, upper_v, r.cl, appState.surfaceData);
    }

    showToast('Prediction complete', 'success');
  } catch (err) {
    displayErrors([err.message], errorDiv);
  } finally {
    btn.classList.remove('loading');
  }
}

function updateOverviewDeflection(val) {
  const el = document.getElementById('overviewDeflection');
  if (el) el.textContent = `${val.toFixed(4)} mm`;
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
      [`Target CL (${target_cl}) exceeds maximum at pitch ${pitch}° (${cl_max.toFixed(4)})`],
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

// ===== RECOMMENDATIONS =====
function displayRecommendations(data) {
  const container = document.getElementById('recommendationsContainer');
  const tableDiv = document.getElementById('recommendationsTable');

  let html = '<div class="rec-grid">';
  data.recommendations.forEach((rec, idx) => {
    const badge = rec.satisfies_constraint
      ? '<span class="constraint-badge satisfied"><i class="fas fa-check"></i> CD OK</span>'
      : '<span class="constraint-badge violated"><i class="fas fa-times"></i> CD High</span>';

    html += `
      <div class="recommendation-box">
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
        <div style="text-align:right;margin-top:10px">${badge}</div>
      </div>`;
  });
  html += '</div>';
  container.innerHTML = html;

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
          data: [0.00164, 0.0022, 0.0021],
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
          data: [0.999998, 0.998, 0.991],
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
