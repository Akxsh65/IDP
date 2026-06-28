# 🚀 IDP Morphing Wing ML Dashboard - Quick Start Guide

## Overview

This is an **interactive web-based dashboard** for the IDP Phase 2 ML component that demonstrates real-time aerodynamic predictions and inverse control optimization for piezoelectric morphing wings.

### Key Features

✅ **Forward Prediction**: Input voltages + angle of attack → Predict aerodynamic coefficients (CL, CD)
✅ **Inverse Control**: Target aerodynamic performance → Find optimal voltages
✅ **Live Visualization**: 3D wing morphing, real-time charts, performance metrics
✅ **Constraint Validation**: Enforces physical limits based on angle of attack
✅ **Responsive Design**: Mobile-friendly, aerospace-themed UI
✅ **Technical Documentation**: Integrated model info and performance summaries

---

## Installation & Setup

### 1. Install Dependencies

```bash
# Navigate to project directory
cd c:\Users\akash\Desktop\IDP

# (Optional) Create virtual environment
python -m venv venv
venv\Scripts\activate

# Install required packages
pip install -r requirements.txt
```

### 2. Verify Model Files

Ensure the pre-trained models exist at:

```
outputs_augmented_models/retrained_strict/
├── structural_linear_regression.joblib
├── aerodynamic_linear_regression.joblib
└── aerodynamic_mlp_regressor.joblib
```

---

## Running the Application

### Start the Flask Server

```bash
# From project directory
python app.py
```

Expected output:

```
 * Serving Flask app 'app'
 * Debug mode: on
 * WARNING: This is a development server. Do not use it in production.
 * Running on http://127.0.0.1:5000
```

### Access the Dashboard

Open your browser and navigate to:
**[http://localhost:5000](http://localhost:5000)**

---

## Project Structure

```
IDP/
├── app.py                          # Flask backend (API endpoints, model inference)
├── requirements.txt                # Python dependencies
├── templates/
│   └── index.html                  # Main HTML template (5 tabs, responsive layout)
├── static/
│   ├── css/
│   │   └── style.css               # Aerospace-themed styling (700+ lines)
│   └── js/
│       └── main.js                 # Interactive controls, API calls, charts (800+ lines)
├── outputs_augmented_models/
│   └── retrained_strict/           # Pre-trained surrogate models
│       ├── structural_linear_regression.joblib
│       ├── aerodynamic_linear_regression.joblib
│       └── aerodynamic_mlp_regressor.joblib
└── [documentation & data files...]
```

---

## Dashboard Features

### 1️⃣ **Project Overview Tab**

- **Wing Visualization**: Interactive 2D NACA 0009 airfoil with MFC indicators
- **System Architecture**: Flow diagram showing surrogate chain
- **Design Parameters**: Wing specs (chord, morphing region, voltage range)

### 2️⃣ **Forward Prediction Tab**

**Left Panel (Sticky Controls):**

- Lower MFC Voltage slider: -500 to -50 V (synchronized input)
- Upper MFC Voltage slider: +50 to +1500 V (synchronized input)
- Angle of Attack slider: -4° to +20° (synchronized input)
- Real-time validation errors

**Right Panel (Results):**

- 4 metric cards: Deflection, CL, CD, L/D Ratio
- Aerodynamic coefficients pie chart
- Prediction history line chart (tracks last 10 predictions)

### 3️⃣ **Inverse Control Tab**

**Left Panel (Optimization Settings):**

- Target CL input with validation
- Angle of attack selector
- Optional drag constraint (CD max)
- Automatic CL_max validation based on angle of attack

**Right Panel (Results):**

- Top 5 voltage recommendations (ranked by error score)
- Visual constraint satisfaction badges (✓ or ✗)
- Detailed results table with metrics

### 4️⃣ **Model Results Tab**

- **Performance Summary**: R² scores and error metrics for each surrogate
- **Accuracy Metrics Chart**: MAE comparison across models
- **R² Scores Radar Chart**: Multi-dimensional performance visualization
- **Data Augmentation Stats**: Original CFD (201) → Augmented (7,998) samples

### 5️⃣ **Model Info Tab**

- **Structural Surrogate**: Linear Regression details (R² = 0.999998)
- **Aerodynamic Surrogate**: MLP Regressor architecture and performance
- **Technical Documentation**: Links to reports, code files, datasets

---

## API Endpoints

The Flask backend provides these REST endpoints:

### 1. Forward Prediction

```bash
POST /api/predict-forward
Content-Type: application/json

{
    "lower_voltage": -250,
    "upper_voltage": 750,
    "pitch_angle": 8  // angle of attack in degrees (legacy field name)
}

Response:
{
    "success": true,
    "results": {
        "deflection_mm": -3.7164,
        "cl": 0.11483,
        "cd": 0.03304,
        "l_d_ratio": 3.47,
        "lower_voltage": -250,
        "upper_voltage": 750,
        "pitch_angle": 8  // angle of attack in degrees (legacy field name)
    }
}
```

### 2. Inverse Prediction (Voltage Optimization)

```bash
POST /api/predict-inverse
Content-Type: application/json

{
    "target_cl": 0.15,
    "pitch_angle": 8  // angle of attack in degrees (legacy field name),
    "max_cd": 0.05
}

Response:
{
    "success": true,
    "recommendations": [
        {
            "rank": 1,
            "lower_voltage": -280,
            "upper_voltage": 650,
            "predicted_cl": 0.1498,
            "predicted_cd": 0.0324,
            "cl_error": 0.0002,
            "cd_violation": 0.0000,
            "satisfies_constraint": true
        },
        ... (top 5 recommendations)
    ]
}
```

### 3. Constraints Information

```bash
GET /api/constraints

Response:
{
    "constraints": {
        "lower_voltage": {"min": -500, "max": -50, "unit": "V"},
        "upper_voltage": {"min": 50, "max": 1500, "unit": "V"},
        "pitch_angle": {"min": -4, "max": 20, "unit": "°"}
    },
    "cl_max_by_pitch": {
        "-4": 0.10992,
        "0": 0.12991,
        ...
        "20": 0.3079
    }
}
```

### 4. Response Surface Data

```bash
GET /api/response-surface
Response: Grid points for 3D surface visualization
```

### 5. Model Information

```bash
GET /api/model-info
Response: Architecture details, performance metrics, training data
```

---

## Input Constraints

**Voltage Ranges** (Physical Limits):

- Lower MFC: -500 V to -50 V
- Upper MFC: +50 V to +1500 V

**Angle of Attack** (Operating Range):

- Range: -4° to +20°
- Resolution: 1° steps

**Maximum Achievable CL** (Aerodynamic Constraint):
| Angle of attack (°) | CL_max |
|-----------|---------|
| -4 | 0.10992 |
| 0 | 0.12991 |
| 4 | 0.16380 |
| 8 | 0.21730 |
| 12 | 0.23350 |
| 16 | 0.26940 |
| 20 | 0.30790 |

---

## Model Performance

### Structural Surrogate (Voltage → Deflection)

- **Type**: Linear Regression
- **R² Score**: 0.999998
- **MAE**: 0.00164 mm
- **RMSE**: 0.00294 mm
- **Training Samples**: 240 (5-fold CV)

### Aerodynamic Surrogate (Deflection + Angle of Attack → CL, CD)

- **Type**: Multi-Output MLP Regressor
- **Architecture**: [128, 64] neurons with ReLU
- **CL R²**: 0.998 | **CL MAE**: 0.0022
- **CD R²**: 0.991 | **CD MAE**: 0.0021
- **Training Samples**: 8,000 (augmented from 201 CFD points)

---

## Troubleshooting

### Error: "ModuleNotFoundError: No module named 'flask'"

**Solution:**

```bash
pip install Flask>=3.0.0
```

### Error: "Model files not found"

**Solution:** Verify that the trained models exist in:

```
outputs_augmented_models/retrained_strict/
```

If missing, run:

```bash
python train_augmented_surrogates.py
```

### Error: "Port 5000 already in use"

**Solution:** Use a different port:

```bash
# Edit app.py line: app.run(port=5001)
python app.py
```

### Slow Prediction Response

**Check:**

- Browser console (F12) for network latency
- Terminal output for computation time
- System resources (CPU/memory usage)

---

## Design Highlights

### 🎨 Aerospace-Themed UI

- **Color Scheme**: Deep navy (#1f4e79) with gradient accents
- **Typography**: Segoe UI with bold headers
- **Animations**: Smooth transitions, hover effects
- **Icons**: Font Awesome 6.4 for visual consistency

### 📊 Interactive Visualizations

- **Wing Canvas**: 2D NACA 0009 airfoil with real-time deflection feedback
- **Chart.js Integration**: Pie chart (CL/CD), history line chart, accuracy bar chart, R² radar chart
- **Responsive Layout**: Bootstrap 5 grid system works on mobile/tablet/desktop

### ⚡ Real-Time Interactions

- **Slider ↔ Input Sync**: Dual-mode control for voltage and angle of attack
- **Instant Validation**: Red error boxes for constraint violations
- **API Integration**: Fetch predictions from Flask backend
- **Dynamic Content**: Recommendations update in real-time

---

## Advanced Usage

### Custom Model Integration

To use different trained models:

1. Replace model files in `outputs_augmented_models/retrained_strict/`
2. Update model loading paths in `app.py` (lines 30-35)
3. Update constraint values if physical limits changed

### Data Export

Predictions are stored in `appState.predictions` array (browser memory).
To export:

```javascript
// In browser console
console.log(JSON.stringify(appState.predictions, null, 2));
```

### Extended Features (Future)

- [ ] Database integration for prediction history
- [ ] User authentication & project management
- [ ] Batch prediction upload/download
- [ ] Real-time wind tunnel feedback
- [ ] Parameter sweep optimization
- [ ] Export to CFD tools

---

## Documentation Resources

📄 **Technical Report**: `ML_Training_Technical_Report.docx`

- 50 KB text-based documentation
- 10 chapters, 20+ data tables
- Methodology, model architectures, results

📊 **Enhanced Report**: `ML_Training_Technical_Report_with_Figures.docx`

- 1.79 MB with embedded figures
- 10 high-resolution publication plots
- Pipeline schematic, validation plots, error analysis

📋 **Results Summary**: `RESULTS_SUMMARY.md`

- Quick overview of key metrics
- Data augmentation details
- Performance benchmarks

---

## Support & Contact

**Team**: RV College Aerospace Engineering (IDP Phase 2)
**Status**: ✅ Production Ready
**Last Updated**: January 2025
**License**: Internal Use (RV College)

---

## Keyboard Shortcuts

| Key     | Action                       |
| ------- | ---------------------------- |
| `Tab`   | Navigate between form fields |
| `Enter` | Submit current form          |
| `↑/↓`   | Adjust slider values         |
| `F12`   | Open browser developer tools |

---

**🎉 Dashboard is now ready for demonstration!**
