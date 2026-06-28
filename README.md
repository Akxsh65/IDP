# IDP — Data-Driven ML Framework for Piezoelectric Morphing Wings

Surrogate modelling pipeline for a piezo-actuated NACA0009 morphing wing: MFC voltages → trailing-edge deflection → aerodynamic coefficients (C_L, C_D), with inverse voltage search for target lift.

## Setup

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## Quick start

```powershell
# Train structural surrogates
python train_structural_surrogates.py

# Train aerodynamic surrogates (original CFD data)
python train_aerodynamic_surrogates.py

# Generate synthetic data (optional — for inspection / legacy CSV export)
python generate_synthetic_data.py --mode strict
python generate_synthetic_data.py --mode noisy --noise-scale 1.0

# Retrain with leak-free split, CV, and hyperparameter tuning
python train_augmented_surrogates.py

# Forward prediction (`--pitch-deg` is the legacy CLI flag for angle of attack, stored as `pitch_deg` in data)
python predict_cl_cd.py --upper-v 750 --lower-v -50 --pitch-deg 8

# Inverse voltage recommendation
python recommend_voltages.py --target-cl 0.15 --pitch-deg 8 --max-cd 0.05

# Publication figures
python generate_publication_plots.py
```

## Documentation

- `ML_PIPELINE_GUIDE.md` — **detailed guide to data, training, augmentation, and inference**
- `RESULTS_SUMMARY.md` — full pipeline results
- `outputs_publication_figures/FIGURES_GUIDE.md` — figure explanations

## Data

| File | Description |
|------|-------------|
| `Structure samples.xlsx` | ANSYS structural data (300 rows) |
| `C_L C_D Values - Sheet1.csv` | CFD lift/drag data (201 rows) |

## Team

RV College of Engineering — Interdisciplinary Project Phase 2
