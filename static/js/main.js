/* ============================================
   IDP Morphing Wing Frontend - Main JavaScript
   Interactive controls, API calls, visualizations
   ============================================ */

// ===== GLOBAL STATE =====
const appState = {
  constraints: {},
  predictions: [],
  recommendations: [],
  charts: {},
  selectedPrediction: null,
};

// ===== INITIALIZATION =====
document.addEventListener("DOMContentLoaded", async function () {
  console.log("🚀 Initializing IDP ML Frontend...");

  // Set current year in footer
  document.getElementById("currentYear").textContent = new Date().getFullYear();

  // Load constraints
  await loadConstraints();

  // Initialize event listeners
  initializeEventListeners();

  // Draw wing visualization
  drawWing();

  // Initialize charts
  await initializeCharts();

  console.log("✓ Frontend initialized successfully");
});

// ===== CONSTRAINTS LOADING =====
async function loadConstraints() {
  try {
    const response = await fetch("/api/constraints");
    const data = await response.json();
    appState.constraints = data.constraints;
    appState.cl_max = data.cl_max_by_pitch;
    console.log("✓ Constraints loaded:", appState.constraints);
  } catch (error) {
    console.error("✗ Error loading constraints:", error);
  }
}

// ===== EVENT LISTENERS =====
function initializeEventListeners() {
  // Forward prediction form
  document
    .getElementById("forwardForm")
    .addEventListener("submit", handleForwardPrediction);

  // Inverse control form
  document
    .getElementById("inverseForm")
    .addEventListener("submit", handleInversePrediction);

  // Slider synchronization (Forward)
  document
    .getElementById("lowerVoltageSlider")
    .addEventListener("input", (e) => {
      document.getElementById("lowerVoltage").value = e.target.value;
    });
  document.getElementById("lowerVoltage").addEventListener("change", (e) => {
    document.getElementById("lowerVoltageSlider").value = e.target.value;
  });

  document
    .getElementById("upperVoltageSlider")
    .addEventListener("input", (e) => {
      document.getElementById("upperVoltage").value = e.target.value;
    });
  document.getElementById("upperVoltage").addEventListener("change", (e) => {
    document.getElementById("upperVoltageSlider").value = e.target.value;
  });

  document.getElementById("pitchAngleSlider").addEventListener("input", (e) => {
    document.getElementById("pitchAngle").value = e.target.value;
  });
  document.getElementById("pitchAngle").addEventListener("change", (e) => {
    document.getElementById("pitchAngleSlider").value = e.target.value;
  });

  // Slider synchronization (Inverse)
  document
    .getElementById("inversePitchSlider")
    .addEventListener("input", (e) => {
      document.getElementById("inversePitchAngle").value = e.target.value;
    });
  document
    .getElementById("inversePitchAngle")
    .addEventListener("change", (e) => {
      document.getElementById("inversePitchSlider").value = e.target.value;
    });
}

// ===== FORWARD PREDICTION =====
async function handleForwardPrediction(e) {
  e.preventDefault();

  const errorDiv = document.getElementById("forwardErrors");
  errorDiv.style.display = "none";

  const lower_v = parseFloat(document.getElementById("lowerVoltage").value);
  const upper_v = parseFloat(document.getElementById("upperVoltage").value);
  const pitch = parseFloat(document.getElementById("pitchAngle").value);

  try {
    const response = await fetch("/api/predict-forward", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lower_voltage: lower_v,
        upper_voltage: upper_v,
        pitch_angle: pitch,
      }),
    });

    const data = await response.json();

    if (!data.success) {
      displayErrors(data.errors || [data.error], errorDiv);
      return;
    }

    // Update display
    const result = data.results;
    document.getElementById("deflectionResult").innerHTML =
      `<div class="value">${result.deflection_mm}</div><div class="unit">mm</div>`;
    document.getElementById("clResult").innerHTML =
      `<div class="value">${result.cl}</div><div class="unit">—</div>`;
    document.getElementById("cdResult").innerHTML =
      `<div class="value">${result.cd}</div><div class="unit">—</div>`;
    document.getElementById("ldResult").innerHTML =
      `<div class="value">${result.l_d_ratio}</div><div class="unit">—</div>`;

    // Store prediction
    appState.predictions.push(result);

    // Update wing visualization
    updateWingDeflection(result.deflection_mm);

    // Update charts
    updateAeroChart(result.cl, result.cd);
    updateHistoryChart();

    // Show success feedback
    showSuccessFeedback("Prediction complete! ✓");
  } catch (error) {
    console.error("Error:", error);
    displayErrors([error.message], errorDiv);
  }
}

// ===== INVERSE PREDICTION =====
async function handleInversePrediction(e) {
  e.preventDefault();

  const errorDiv = document.getElementById("inverseErrors");
  errorDiv.style.display = "none";

  const target_cl = parseFloat(document.getElementById("targetCL").value);
  const pitch = parseFloat(document.getElementById("inversePitchAngle").value);
  const use_max_cd = document.getElementById("useMaxCD").checked;
  const max_cd = use_max_cd
    ? parseFloat(document.getElementById("maxCD").value)
    : null;

  // Validate CL against max
  const cl_max = appState.cl_max[Math.round(pitch)] || 0.3079;
  if (target_cl > cl_max) {
    displayErrors(
      [
        `Target CL (${target_cl}) exceeds maximum achievable at pitch ${pitch}° (${cl_max.toFixed(4)})`,
      ],
      errorDiv,
    );
    return;
  }

  try {
    const response = await fetch("/api/predict-inverse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target_cl: target_cl,
        pitch_angle: pitch,
        max_cd: max_cd,
      }),
    });

    const data = await response.json();

    if (!data.success) {
      displayErrors(data.errors || [data.error], errorDiv);
      return;
    }

    appState.recommendations = data.recommendations;
    displayRecommendations(data);

    showSuccessFeedback("Inverse search complete! ✓");
  } catch (error) {
    console.error("Error:", error);
    displayErrors([error.message], errorDiv);
  }
}

// ===== DISPLAY RECOMMENDATIONS =====
function displayRecommendations(data) {
  const container = document.getElementById("recommendationsContainer");
  const tableDiv = document.getElementById("recommendationsTable");

  let html = '<div class="row">';

  data.recommendations.forEach((rec, idx) => {
    const constraintStatus = rec.satisfies_constraint
      ? '<span class="constraint-badge satisfied"><i class="fas fa-check"></i> CD OK</span>'
      : '<span class="constraint-badge violated"><i class="fas fa-times"></i> CD High</span>';

    html += `
        <div class="col-md-6 mb-3">
            <div class="recommendation-box">
                <div class="rank-badge">
                    ${idx + 1}
                </div>
                <div class="voltage-pair">
                    <div class="voltage-item">
                        <label>Lower V</label>
                        <div class="value">${rec.lower_voltage}</div>
                        <small class="text-muted">V</small>
                    </div>
                    <div class="voltage-item">
                        <label>Upper V</label>
                        <div class="value">${rec.upper_voltage}</div>
                        <small class="text-muted">V</small>
                    </div>
                </div>
                <hr class="my-2">
                <div class="row text-center">
                    <div class="col-6">
                        <small class="text-muted d-block">Predicted CL</small>
                        <strong style="color: var(--success-color);">${rec.predicted_cl}</strong>
                    </div>
                    <div class="col-6">
                        <small class="text-muted d-block">Predicted CD</small>
                        <strong style="color: var(--success-color);">${rec.predicted_cd}</strong>
                    </div>
                </div>
                <div class="row text-center mt-2">
                    <div class="col-6">
                        <small class="text-muted d-block">CL Error</small>
                        <span>${rec.cl_error.toFixed(6)}</span>
                    </div>
                    <div class="col-6">
                        <small class="text-muted d-block">CD Violation</small>
                        <span>${rec.cd_violation.toFixed(6)}</span>
                    </div>
                </div>
                <div class="mt-2" style="text-align: right;">
                    ${constraintStatus}
                </div>
            </div>
        </div>
        `;
  });

  html += "</div>";
  container.innerHTML = html;

  // Create table
  let tableHtml = `
    <table class="table table-striped table-sm">
        <thead>
            <tr>
                <th>#</th>
                <th>Lower V (V)</th>
                <th>Upper V (V)</th>
                <th>Predicted CL</th>
                <th>Predicted CD</th>
                <th>CL Error</th>
                <th>Constraint</th>
            </tr>
        </thead>
        <tbody>
    `;

  data.recommendations.forEach((rec, idx) => {
    const badge = rec.satisfies_constraint
      ? '<span class="badge bg-success">✓ Satisfied</span>'
      : '<span class="badge bg-warning">✗ Violated</span>';

    tableHtml += `
        <tr>
            <td><strong>${idx + 1}</strong></td>
            <td>${rec.lower_voltage}</td>
            <td>${rec.upper_voltage}</td>
            <td>${rec.predicted_cl}</td>
            <td>${rec.predicted_cd}</td>
            <td>${rec.cl_error.toFixed(6)}</td>
            <td>${badge}</td>
        </tr>
        `;
  });

  tableHtml += "</tbody></table>";
  tableDiv.innerHTML = tableHtml;
}

// ===== ERROR DISPLAY =====
function displayErrors(errors, errorDiv) {
  let html =
    '<strong><i class="fas fa-exclamation-triangle"></i> Validation Errors:</strong><ul class="mb-0">';
  errors.forEach((err) => {
    html += `<li>${err}</li>`;
  });
  html += "</ul>";
  errorDiv.innerHTML = html;
  errorDiv.style.display = "block";
}

// ===== SUCCESS FEEDBACK =====
function showSuccessFeedback(message) {
  const alert = document.createElement("div");
  alert.className = "alert alert-success alert-dismissible fade show mt-3";
  alert.style.margin = "15px";
  alert.innerHTML = `
        <strong>✓ ${message}</strong>
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;

  // Find the first tab pane and insert alert at the top
  const tabPane = document.querySelector(".tab-pane.show");
  if (tabPane) {
    tabPane.insertAdjacentElement("afterbegin", alert);
  } else {
    // Fallback: append to container
    const container = document.querySelector(".container-fluid");
    if (container) {
      container.appendChild(alert);
    }
  }

  setTimeout(() => {
    if (alert.parentNode) {
      alert.remove();
    }
  }, 4000);
}

// ===== WING VISUALIZATION =====
function drawWing() {
  const canvas = document.getElementById("wingCanvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;

  // Clear canvas
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);

  // Draw NACA 0009 symmetric airfoil
  const scale = 3;
  const offsetX = width / 4;
  const offsetY = height / 2;

  // Airfoil profile (simplified NACA 0009)
  const airfoilPoints = generateNACA0009();

  // Draw airfoil outline
  ctx.strokeStyle = "#1f4e79";
  ctx.lineWidth = 3;
  ctx.beginPath();

  airfoilPoints.forEach((point, index) => {
    const x = offsetX + point[0] * scale;
    const y = offsetY - point[1] * scale;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.stroke();

  // Fill airfoil
  ctx.fillStyle = "rgba(31, 78, 121, 0.1)";
  ctx.fill();

  // Draw MFC indicators
  const mfcPositions = [
    { x: offsetX + 40, y: offsetY - 20, label: "Upper MFC" },
    { x: offsetX + 40, y: offsetY + 20, label: "Lower MFC" },
  ];

  mfcPositions.forEach((mfc) => {
    ctx.fillStyle = "#2ecc71";
    ctx.beginPath();
    ctx.arc(mfc.x, mfc.y, 6, 0, 2 * Math.PI);
    ctx.fill();

    ctx.fillStyle = "#333";
    ctx.font = "bold 10px Arial";
    ctx.textAlign = "left";
    ctx.fillText(mfc.label, mfc.x + 10, mfc.y + 3);
  });

  // Draw coordinate axes
  ctx.strokeStyle = "#ccc";
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 5]);

  ctx.beginPath();
  ctx.moveTo(offsetX, 0);
  ctx.lineTo(offsetX, height);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(0, offsetY);
  ctx.lineTo(width, offsetY);
  ctx.stroke();

  ctx.setLineDash([]);

  // Labels
  ctx.fillStyle = "#666";
  ctx.font = "bold 12px Arial";
  ctx.textAlign = "center";
  ctx.fillText("Trailing Edge", offsetX + 55, height - 20);
  ctx.fillText("Leading Edge", offsetX - 25, height - 20);
}

function generateNACA0009() {
  const points = [];
  const chord = 100;

  for (let x = 0; x <= chord; x += 2) {
    const t = 0.09; // 9% thickness
    const c = chord;
    const xt = x / c;

    // NACA symmetric formula
    const yt =
      5 *
      t *
      (0.2969 * Math.sqrt(xt) -
        0.126 * xt -
        0.3516 * xt * xt +
        0.2843 * xt * xt * xt -
        0.1015 * xt * xt * xt * xt) *
      c;

    points.push([x, yt]);
  }

  // Return lower surface too
  for (let x = chord; x >= 0; x -= 2) {
    const t = 0.09;
    const c = chord;
    const xt = x / c;
    const yt =
      5 *
      t *
      (0.2969 * Math.sqrt(xt) -
        0.126 * xt -
        0.3516 * xt * xt +
        0.2843 * xt * xt * xt -
        0.1015 * xt * xt * xt * xt) *
      c;
    points.push([x, -yt]);
  }

  return points;
}

function updateWingDeflection(deflection) {
  const canvas = document.getElementById("wingCanvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  drawWing();

  // Draw deflection indicator
  const width = canvas.width;
  const height = canvas.height;
  const offsetX = width / 4;
  const offsetY = height / 2;
  const scale = 3;

  const deflectionPixels = (deflection / -8.47) * 40; // normalize to screen coords

  // Draw deflection arc
  ctx.strokeStyle = "#e74c3c";
  ctx.lineWidth = 2;
  ctx.setLineDash([3, 3]);

  const teX = offsetX + 105;
  const teY = offsetY + deflectionPixels;

  ctx.beginPath();
  ctx.moveTo(offsetX + 105, offsetY);
  ctx.lineTo(teX, teY);
  ctx.stroke();

  ctx.setLineDash([]);

  // Draw deflection amount
  ctx.fillStyle = "#e74c3c";
  ctx.font = "bold 12px Arial";
  ctx.textAlign = "left";
  ctx.fillText(`Deflection: ${deflection.toFixed(2)} mm`, teX + 5, teY);
}

// ===== TOGGLE MAX CD =====
function toggleMaxCD() {
  const checkbox = document.getElementById("useMaxCD");
  const input = document.getElementById("maxCD");
  input.disabled = !checkbox.checked;
  if (checkbox.checked) input.focus();
}

// ===== CHART INITIALIZATION =====
async function initializeCharts() {
  // Accuracy Chart
  const accuracyCtx = document.getElementById("accuracyChart");
  if (accuracyCtx) {
    appState.charts.accuracy = new Chart(accuracyCtx, {
      type: "bar",
      data: {
        labels: [
          "Structural\n(Deflection)",
          "Aerodynamic\n(CL)",
          "Aerodynamic\n(CD)",
        ],
        datasets: [
          {
            label: "Mean Absolute Error (MAE)",
            data: [0.00164, 0.0022, 0.0021],
            backgroundColor: [
              "rgba(102, 126, 234, 0.8)",
              "rgba(46, 204, 113, 0.8)",
              "rgba(52, 152, 219, 0.8)",
            ],
            borderColor: ["#667eea", "#2ecc71", "#3498db"],
            borderWidth: 2,
            borderRadius: 8,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { display: false },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: function (value) {
                return value.toFixed(4);
              },
            },
          },
        },
      },
    });
  }

  // R² Chart
  const r2Ctx = document.getElementById("r2Chart");
  if (r2Ctx) {
    appState.charts.r2 = new Chart(r2Ctx, {
      type: "radar",
      data: {
        labels: ["Structural", "CL", "CD"],
        datasets: [
          {
            label: "R² Score",
            data: [0.999998, 0.998, 0.991],
            borderColor: "#667eea",
            backgroundColor: "rgba(102, 126, 234, 0.2)",
            pointBackgroundColor: "#667eea",
            pointBorderColor: "#fff",
            pointBorderWidth: 2,
            pointRadius: 5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        scales: {
          r: {
            beginAtZero: true,
            max: 1.0,
            ticks: {
              stepSize: 0.2,
            },
          },
        },
      },
    });
  }

  // Aerodynamic Chart
  const aeroCtx = document.getElementById("aeroChart");
  if (aeroCtx) {
    appState.charts.aero = new Chart(aeroCtx, {
      type: "doughnut",
      data: {
        labels: ["Lift (CL)", "Drag (CD)"],
        datasets: [
          {
            data: [0.11483, 0.03304],
            backgroundColor: ["#2ecc71", "#e74c3c"],
            borderColor: "#fff",
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            position: "bottom",
          },
        },
      },
    });
  }

  // History Chart
  const historyCtx = document.getElementById("historyChart");
  if (historyCtx) {
    appState.charts.history = new Chart(historyCtx, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          {
            label: "CL",
            data: [],
            borderColor: "#2ecc71",
            backgroundColor: "rgba(46, 204, 113, 0.1)",
            tension: 0.4,
            fill: true,
          },
          {
            label: "CD",
            data: [],
            borderColor: "#e74c3c",
            backgroundColor: "rgba(231, 76, 60, 0.1)",
            tension: 0.4,
            fill: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { position: "top" },
        },
        scales: {
          y: { beginAtZero: true },
        },
      },
    });
  }
}

// ===== UPDATE CHARTS =====
function updateAeroChart(cl, cd) {
  if (appState.charts.aero) {
    appState.charts.aero.data.datasets[0].data = [cl, cd];
    appState.charts.aero.update();
  }
}

function updateHistoryChart() {
  if (appState.charts.history && appState.predictions.length > 0) {
    const recentPredictions = appState.predictions.slice(-10);

    appState.charts.history.data.labels = recentPredictions.map(
      (_, i) => `${i + 1}`,
    );
    appState.charts.history.data.datasets[0].data = recentPredictions.map(
      (p) => p.cl,
    );
    appState.charts.history.data.datasets[1].data = recentPredictions.map(
      (p) => p.cd,
    );
    appState.charts.history.update();
  }
}

console.log("✓ JavaScript loaded successfully");
