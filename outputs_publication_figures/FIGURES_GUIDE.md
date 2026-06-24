# Publication Figures Guide

This document explains every figure generated for the **Data-Driven ML Framework for Piezoelectric Morphing Wings** project. All figures are stored in `outputs_publication_figures/` as **PNG** (300 dpi) and **PDF** (vector).

---

## Fig 1 — Pipeline schematic (`fig01_pipeline_schematic`)

**What it shows:** The end-to-end surrogate modelling workflow.

**Flow (left → right):**
1. **MFC Voltages** (V_lower, V_upper) — piezoelectric actuator inputs
2. **Structural Surrogate** — predicts wing deformation from voltages
3. **Deflection** (δ_TE) — trailing-edge deflection (mm)
4. **Aerodynamic Surrogate** — also takes **pitch angle** α as input
5. **C_L, C_D** — lift and drag coefficients

**How to read it:** Arrows indicate forward data flow. The pitch angle enters only at the aerodynamic stage because CFD was run at multiple angles of attack for each morphed geometry.

**Paper use:** Methodology section — overview of the proposed framework.

---

## Fig 2 — Structural validation (`fig02_structural_validation`)

**What it shows:** How well the structural surrogate reproduces ANSYS coupled-field results.

| Panel | Content |
|-------|---------|
| **(a) Parity plot** | ANSYS deflection (x-axis) vs predicted deflection (y-axis) for all 300 structural samples. Points on the dashed diagonal = perfect prediction. |
| **(b) Residual histogram** | Distribution of prediction errors (predicted − ANSYS). Centered near zero confirms unbiased predictions. |

**Key result:** MAE ≈ 0.0016 mm, R² ≈ 0.999998 — the structural relationship is effectively linear.

**Paper use:** Results — structural surrogate validation.

---

## Fig 3 — Deflection response (`fig03_deflection_response`)

**What it shows:** Trailing-edge deflection as a function of upper MFC voltage for four fixed lower voltages (−50, −100, −200, −300 V).

| Element | Meaning |
|---------|---------|
| **Solid/dashed lines** | Surrogate model predictions |
| **Scatter points** | ANSYS simulation data |

**How to read it:** Increasing upper voltage increases downward deflection (more negative mm). More negative lower voltage shifts the curve further down (greater actuation authority).

**Paper use:** Results — electromechanical response of the morphing trailing edge.

---

## Fig 4a — Aerodynamic linear surrogate (`fig04a_aerodynamic_linear`)

**What it shows:** Baseline aerodynamic model performance before augmentation.

| Panel | Axes |
|-------|------|
| **(a)** | CFD C_L vs predicted C_L |
| **(b)** | CFD C_D vs predicted C_D |

**Inputs to model:** deflection (mm) + pitch angle (deg).

**Key result:** Strong C_L fit (R² ≈ 0.98) but weaker C_D fit (R² ≈ 0.83).

**Paper use:** Baseline comparison / ablation study.

---

## Fig 4b — Aerodynamic MLP surrogate (`fig04b_aerodynamic_mlp`)

**What it shows:** Retrained MLP aerodynamic model on augmented data (same parity layout as Fig 4a).

**Key result:** C_L MAE ≈ 0.0022, C_D MAE ≈ 0.0021, both R² > 0.99 on real CFD points.

**Paper use:** Main aerodynamic surrogate result — preferred model for the chained pipeline.

---

## Fig 5 — Full-chain comparison (`fig05_chain_comparison`)

**What it shows:** End-to-end validation: voltages → deflection → C_L/C_D compared against CFD ground truth (201 points).

| Row | Aerodynamic model | Panels |
|-----|-------------------|--------|
| **Top** | Linear (original) | (a) C_L, (b) C_D |
| **Bottom** | MLP (retrained) | (c) C_L, (d) C_D |

**How to read it:** Tighter clustering along the diagonal = better chained prediction. The MLP row shows visibly improved C_D agreement.

**Key result:**
- Linear chain: C_L MAE = 0.0050, C_D MAE = 0.0093
- MLP chain: C_L MAE = 0.0022, C_D MAE = 0.0021

**Paper use:** Core result — integrated surrogate framework validation.

---

## Fig 6 — Model metrics (`fig06_model_metrics`)

**What it shows:** Bar chart summary of the selected models on real validation data.

| Panel | Metric | Models compared |
|-------|--------|-----------------|
| **(a)** | MAE | Structural (deflection), Aero C_L, Aero C_D |
| **(b)** | R² | Same three tasks |

**Paper use:** Quick quantitative summary table alternative.

---

## Fig 7 — C_L vs pitch (`fig07_cl_vs_pitch`)

**What it shows:** Lift coefficient variation with pitch angle for four representative voltage combinations.

| Line style | Meaning |
|------------|---------|
| **Solid with markers** | CFD ground truth |
| **Dashed** | Chained surrogate prediction |

**Voltage cases shown:** (−50/50), (−50/750), (−50/1500), (−500/1500) V.

**How to read it:** C_L increases with pitch angle at all voltage levels. Higher upper voltage (greater deflection) shifts curves upward — more camber produces more lift.

**Paper use:** Aerodynamic performance characterisation across actuation states.

---

## Fig 8 — Error vs pitch (`fig08_error_vs_pitch`)

**What it shows:** Mean absolute error of the chained MLP model averaged at each pitch angle.

| Line | Quantity |
|------|----------|
| **Circles (solid)** | C_L error |
| **Squares (dashed)** | C_D error |

**How to read it:** Identifies pitch angles where the surrogate is least/most accurate. Useful for discussing model limitations at extreme angles of attack.

**Paper use:** Error analysis / discussion section.

---

## Fig 9 — Inverse control (`fig09_inverse_control`)

**What it shows:** Demonstration of the inverse voltage search at pitch = 8°.

| Panel | Content |
|-------|---------|
| **(a)** | Target C_L (dashed red) vs achieved C_L (bars) for four target values |
| **(b)** | Recommended (V_lower, V_upper) pairs in voltage space, annotated with target C_L |

**How to read it:** Panel (a) confirms the inverse search finds voltages that achieve the desired lift. Panel (b) shows how voltage combinations change across targets — higher target C_L generally requires higher actuation.

**Paper use:** Control application — fulfilling the project objective of voltage recommendation for desired lift.

---

## Fig 10 — Data coverage (`fig10_data_coverage`)

**What it shows:** Spatial coverage of the training datasets in input-parameter space.

| Panel | Axes | Colour |
|-------|------|--------|
| **(a) Structural** | Upper voltage vs lower voltage | Deflection (mm) |
| **(b) CFD** | Pitch angle vs deflection | C_L |

**How to read it:**
- **(a):** Full 10×30 grid in voltage space (300 ANSYS points). Colour shows resulting deflection magnitude.
- **(b):** CFD samples at 7 pitch angles and 30 voltage combinations. Only 3 upper-voltage levels (50, 750, 1500 V) appear as vertical bands in deflection.

**Paper use:** Methodology — experimental/simulation design and data availability.

---

## Suggested figure order for paper

| Section | Figures |
|---------|---------|
| Introduction / Motivation | Fig 1 |
| Methodology | Fig 1, Fig 10 |
| Structural Results | Fig 2, Fig 3 |
| Aerodynamic Results | Fig 4b (main), Fig 4a (baseline) |
| Integrated Framework | Fig 5, Fig 6 |
| Application | Fig 7, Fig 9 |
| Discussion | Fig 8 |

---

## Regenerating figures

```powershell
& "c:\Users\akash\Desktop\IDP\.venv\Scripts\python.exe" "c:\Users\akash\Desktop\IDP\generate_publication_plots.py"
```

---

*Last updated: June 2026*
