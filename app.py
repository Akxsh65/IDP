"""
Flask Web Application for ML Morphing Wing Surrogate Models
Interactive frontend with real-time predictions, visualizations, and aerospace components
"""

from flask import Flask, render_template, request, jsonify, send_from_directory
from pathlib import Path
import joblib
import numpy as np
import pandas as pd
import json
from datetime import datetime
import sys

from data_loaders import load_structure_samples

# Initialize Flask app
app = Flask(__name__, template_folder='templates', static_folder='static')

# Configure paths
PROJECT_DIR = Path(__file__).resolve().parent
MODELS_DIR = PROJECT_DIR / 'outputs_augmented_models' / 'retrained_strict'

# Load trained models
print("Loading trained surrogate models...")
try:
    structural_model = joblib.load(MODELS_DIR / 'structural_linear_regression.joblib')
    aerodynamic_model = joblib.load(MODELS_DIR / 'aerodynamic_mlp_regressor.joblib')
    print("✓ Models loaded successfully")
except Exception as e:
    print(f"✗ Error loading models: {e}")
    structural_model = None
    aerodynamic_model = None

# Application constraints
CONSTRAINTS = {
    'lower_voltage': {'min': -500, 'max': -50, 'unit': 'V'},
    'upper_voltage': {'min': 50, 'max': 1500, 'unit': 'V'},
    'pitch_angle': {'min': -4, 'max': 20, 'unit': '°'},
    'deflection': {'min': -8.6, 'max': -0.3, 'unit': 'mm'},
    'cl': {'min': 0.0, 'max': 0.35, 'unit': ''},
    'cd': {'min': 0.01, 'max': 0.16, 'unit': ''},
}

CL_MAX_BY_PITCH = {
    -4: 0.10992,
    0: 0.12991,
    4: 0.1638,
    8: 0.2173,
    12: 0.2335,
    16: 0.2694,
    20: 0.3079
}


@app.route('/')
def index():
    """Render main page"""
    return render_template('index.html')


@app.route('/api/constraints', methods=['GET'])
def get_constraints():
    """Return application constraints"""
    return jsonify({
        'constraints': CONSTRAINTS,
        'cl_max_by_pitch': CL_MAX_BY_PITCH
    })


@app.route('/api/predict-forward', methods=['POST'])
def predict_forward():
    """Predict CL/CD from voltages and pitch"""
    try:
        data = request.json
        lower_v = float(data.get('lower_voltage'))
        upper_v = float(data.get('upper_voltage'))
        pitch = float(data.get('pitch_angle'))
        
        # Validate inputs
        errors = []
        if not (CONSTRAINTS['lower_voltage']['min'] <= lower_v <= CONSTRAINTS['lower_voltage']['max']):
            errors.append(f"Lower voltage must be between {CONSTRAINTS['lower_voltage']['min']} and {CONSTRAINTS['lower_voltage']['max']} V")
        if not (CONSTRAINTS['upper_voltage']['min'] <= upper_v <= CONSTRAINTS['upper_voltage']['max']):
            errors.append(f"Upper voltage must be between {CONSTRAINTS['upper_voltage']['min']} and {CONSTRAINTS['upper_voltage']['max']} V")
        if not (CONSTRAINTS['pitch_angle']['min'] <= pitch <= CONSTRAINTS['pitch_angle']['max']):
            errors.append(f"Angle of attack must be between {CONSTRAINTS['pitch_angle']['min']} and {CONSTRAINTS['pitch_angle']['max']}°")
        
        if errors:
            return jsonify({'success': False, 'errors': errors}), 400
        
        # Predict deflection
        deflection_input = pd.DataFrame([{'lower_mfc_v': lower_v, 'upper_mfc_v': upper_v}])
        deflection = float(structural_model.predict(deflection_input)[0])
        
        # Predict CL/CD
        aero_input = pd.DataFrame([{'deflection_mm': deflection, 'pitch_deg': pitch}])
        cl, cd = aerodynamic_model.predict(aero_input)[0]
        
        cl = float(cl)
        cd = float(cd)
        l_d_ratio = float(cl / cd) if cd != 0 else float('inf')
        
        return jsonify({
            'success': True,
            'results': {
                'lower_voltage': float(round(lower_v, 2)),
                'upper_voltage': float(round(upper_v, 2)),
                'pitch_angle': float(round(pitch, 2)),
                'deflection_mm': float(round(deflection, 4)),
                'cl': float(round(cl, 6)),
                'cd': float(round(cd, 6)),
                'l_d_ratio': float(round(l_d_ratio, 4)) if l_d_ratio != float('inf') else None,
                'timestamp': datetime.now().isoformat()
            }
        })
    
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/predict-inverse', methods=['POST'])
def predict_inverse():
    """Recommend voltages for target CL"""
    try:
        data = request.json
        target_cl = float(data.get('target_cl'))
        pitch = float(data.get('pitch_angle'))
        max_cd = data.get('max_cd')
        if max_cd:
            max_cd = float(max_cd)
        
        # Validate inputs
        errors = []
        if not (CONSTRAINTS['pitch_angle']['min'] <= pitch <= CONSTRAINTS['pitch_angle']['max']):
            errors.append(f"Angle of attack must be between {CONSTRAINTS['pitch_angle']['min']} and {CONSTRAINTS['pitch_angle']['max']}°")
        
        # Get CL max at this pitch
        cl_max = CL_MAX_BY_PITCH.get(int(pitch), 0.3079)
        if target_cl > cl_max:
            errors.append(f"Target CL ({target_cl}) exceeds maximum achievable CL ({cl_max:.4f}) at {pitch}° angle of attack")
        if target_cl < 0:
            errors.append("Target CL must be positive")
        
        if errors:
            return jsonify({'success': False, 'errors': errors}), 400
        
        # Grid search
        lower_voltages = np.arange(-500, -25, 50)
        upper_voltages = np.arange(50, 1551, 50)
        
        best_matches = []
        
        for lower_v in lower_voltages:
            for upper_v in upper_voltages:
                # Predict deflection
                def_input = pd.DataFrame([{'lower_mfc_v': lower_v, 'upper_mfc_v': upper_v}])
                deflection = float(structural_model.predict(def_input)[0])
                
                # Predict aerodynamics
                aero_input = pd.DataFrame([{'deflection_mm': deflection, 'pitch_deg': pitch}])
                cl, cd = aerodynamic_model.predict(aero_input)[0]
                
                cl = float(cl)
                cd = float(cd)
                cl_error = abs(cl - target_cl)
                cd_violation = max(0, cd - max_cd) if max_cd else 0
                
                satisfies_cd = (cd <= max_cd) if max_cd else True
                
                best_matches.append({
                    'lower_v': int(lower_v),
                    'upper_v': int(upper_v),
                    'deflection': float(deflection),
                    'cl': float(cl),
                    'cd': float(cd),
                    'cl_error': float(cl_error),
                    'cd_violation': float(cd_violation),
                    'satisfies_cd': satisfies_cd,
                    'score': float(cl_error + cd_violation * 10)  # Weighted score
                })
        
        # Sort by score
        best_matches.sort(key=lambda x: x['score'])
        top_k = best_matches[:5]
        
        recommendations = []
        for match in top_k:
            recommendations.append({
                'lower_voltage': int(match['lower_v']),
                'upper_voltage': int(match['upper_v']),
                'predicted_cl': float(round(match['cl'], 6)),
                'predicted_cd': float(round(match['cd'], 6)),
                'cl_error': float(round(match['cl_error'], 6)),
                'cd_violation': float(round(match['cd_violation'], 6)),
                'satisfies_constraint': bool(match['satisfies_cd'])
            })
        
        return jsonify({
            'success': True,
            'target_cl': float(target_cl),
            'pitch_angle': float(pitch),
            'max_cd': float(max_cd) if max_cd else None,
            'recommendations': recommendations,
            'timestamp': datetime.now().isoformat()
        })
    
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/model-info', methods=['GET'])
def get_model_info():
    """Return model information and performance metrics"""
    return jsonify({
        'models': {
            'structural': {
                'type': 'Linear Regression',
                'inputs': ['lower_mfc_v', 'upper_mfc_v'],
                'output': 'deflection_mm',
                'mae': 0.00164,
                'rmse': 0.00294,
                'r2': 0.999998,
                'training_samples': 587,
                'test_samples': 60
            },
            'aerodynamic': {
                'type': 'MLP Regressor (MultiOutput)',
                'inputs': ['deflection_mm', 'pitch_deg'],
                'outputs': ['cl', 'cd'],
                'hidden_layers': [128, 64],
                'activation': 'relu',
                'optimizer': 'Adam (lr=0.003, L2=0.001)',
                'cl_mae': 0.00343,
                'cl_r2': 0.993,
                'cd_mae': 0.00221,
                'cd_r2': 0.988,
                'training_samples': 3254,
                'test_samples': 41
            }
        },
        'chained_performance': {
            'cl_mae': 0.00343,
            'cd_mae': 0.00221,
            'validation_points': 41
        },
        'wing_design': {
            'airfoil': 'NACA 0009',
            'chord': '127 mm',
            'morphing_region': 'Trailing edge (80% chord)',
            'actuators': '4 bimorph MFC (d33 mode)',
            'material': 'Carbon composite + MFC',
            'operating_range': '-500 to +1500 V'
        }
    })


@app.route('/api/response-surface', methods=['GET'])
def get_response_surface():
    """Generate response surface data for 3D visualization"""
    try:
        pitch = float(request.args.get('pitch', 8))
        
        # Create grid
        lower_voltages = np.linspace(-500, -50, 15)
        upper_voltages = np.linspace(50, 1500, 15)
        
        data = []
        for lower_v in lower_voltages:
            for upper_v in upper_voltages:
                # Predict deflection
                def_input = pd.DataFrame([{'lower_mfc_v': lower_v, 'upper_mfc_v': upper_v}])
                deflection = float(structural_model.predict(def_input)[0])
                
                # Predict aerodynamics
                aero_input = pd.DataFrame([{'deflection_mm': deflection, 'pitch_deg': pitch}])
                cl, cd = aerodynamic_model.predict(aero_input)[0]
                
                data.append({
                    'lower_v': float(lower_v),
                    'upper_v': float(upper_v),
                    'cl': float(cl),
                    'cd': float(cd)
                })
        
        return jsonify({
            'pitch': pitch,
            'data': data
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/structural-samples', methods=['GET'])
def get_structural_samples():
    """Return 300 ANSYS samples and regression plane mesh for 3D scatter."""
    try:
        excel_path = PROJECT_DIR / 'Structure samples.xlsx'
        df = load_structure_samples(excel_path)
        samples = df.round(4).to_dict('records')

        lower_grid = np.linspace(-500, -50, 14)
        upper_grid = np.linspace(50, 1500, 14)
        plane = []
        for lower_v in lower_grid:
            for upper_v in upper_grid:
                def_input = pd.DataFrame([{'lower_mfc_v': lower_v, 'upper_mfc_v': upper_v}])
                deflection = float(structural_model.predict(def_input)[0])
                plane.append({
                    'lower_mfc_v': float(lower_v),
                    'upper_mfc_v': float(upper_v),
                    'deflection_mm': float(round(deflection, 4)),
                })

        return jsonify({
            'success': True,
            'samples': samples,
            'plane': plane,
            'r2': 0.999998,
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/mlp-weights', methods=['GET'])
def get_mlp_weights():
    """Return subsampled MLP weights for forward-pass SVG animation."""
    try:
        regressor = aerodynamic_model.named_steps['regressor']
        est_cl = regressor.estimators_[0]
        est_cd = regressor.estimators_[1]

        def subsample_matrix(matrix, out_count, in_count):
            matrix = np.abs(np.asarray(matrix))
            in_idx = np.linspace(0, matrix.shape[0] - 1, in_count, dtype=int)
            out_idx = np.linspace(0, matrix.shape[1] - 1, out_count, dtype=int)
            return matrix[np.ix_(in_idx, out_idx)].tolist()

        # Schematic layers [2 → 6 → 5 → 2] representing deployed [2 → 128 → 64 → 2]
        w01 = (np.abs(est_cl.coefs_[0]) + np.abs(est_cd.coefs_[0])) / 2
        w12 = (np.abs(est_cl.coefs_[1]) + np.abs(est_cd.coefs_[1])) / 2
        w23 = np.column_stack([
            np.abs(est_cl.coefs_[2]).reshape(-1),
            np.abs(est_cd.coefs_[2]).reshape(-1),
        ])

        return jsonify({
            'success': True,
            'architecture': [2, 128, 64, 2],
            'visible_layers': [2, 6, 5, 2],
            'input_labels': ['δ', 'α'],
            'output_labels': ['C_L', 'C_D'],
            'input_names': ['deflection_mm', 'pitch_deg'],
            'output_names': ['cl', 'cd'],
            'weights': [
                subsample_matrix(w01, 6, 2),
                subsample_matrix(w12, 5, 6),
                subsample_matrix(w23, 2, 5),
            ],
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


def _mlp_head_forward(est, x_scaled):
    """Run one MLP output head and return layer activations plus weights/biases."""
    activations = [x_scaled.tolist()]
    weights = []
    biases = []
    h = np.asarray(x_scaled, dtype=float).copy()

    for i, (W, b) in enumerate(zip(est.coefs_, est.intercepts_)):
        weights.append(np.round(W, 6).tolist())
        biases.append(np.round(b, 6).tolist())
        h = h @ W + b
        if i < len(est.coefs_) - 1:
            h = np.maximum(0.0, h)
        activations.append(np.round(h.reshape(-1), 6).tolist())

    return activations, weights, biases


@app.route('/api/mlp-forward-pass', methods=['POST'])
def mlp_forward_pass():
    """Return full forward-pass activations and weight matrices for the aerodynamic MLP."""
    try:
        if aerodynamic_model is None:
            return jsonify({'success': False, 'error': 'Models not loaded'}), 503

        data = request.get_json() or {}
        deflection = float(data.get('deflection_mm'))
        alpha = float(data.get('alpha_deg', data.get('pitch_angle', 8)))

        aero_input = pd.DataFrame([{'deflection_mm': deflection, 'pitch_deg': alpha}])
        x_scaled = aerodynamic_model.named_steps['scaler'].transform(aero_input)[0]

        regressor = aerodynamic_model.named_steps['regressor']
        est_cl = regressor.estimators_[0]
        est_cd = regressor.estimators_[1]

        acts_cl, w_cl, b_cl = _mlp_head_forward(est_cl, x_scaled)
        acts_cd, w_cd, b_cd = _mlp_head_forward(est_cd, x_scaled)

        preds = aerodynamic_model.predict(aero_input)[0]

        return jsonify({
            'success': True,
            'architecture': [2, 128, 64, 2],
            'inputs_raw': [round(deflection, 6), round(alpha, 6)],
            'inputs_scaled': np.round(x_scaled, 6).tolist(),
            'input_labels': ['δ (mm)', 'α (°)'],
            'scaler_mean': np.round(aerodynamic_model.named_steps['scaler'].mean_, 6).tolist(),
            'scaler_scale': np.round(aerodynamic_model.named_steps['scaler'].scale_, 6).tolist(),
            'heads': {
                'cl': {
                    'label': 'C_L head',
                    'output_label': 'C_L',
                    'output_value': round(float(preds[0]), 6),
                    'activations': acts_cl,
                    'weights': w_cl,
                    'biases': b_cl,
                },
                'cd': {
                    'label': 'C_D head',
                    'output_label': 'C_D',
                    'output_value': round(float(preds[1]), 6),
                    'activations': acts_cd,
                    'weights': w_cd,
                    'biases': b_cd,
                },
            },
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/parity-data', methods=['GET'])
def get_parity_data():
    """Return predicted vs actual CL/CD for all 201 real CFD points"""
    try:
        cfd_path = PROJECT_DIR / 'outputs_aerodynamic_surrogates' / 'cfd_dataset_flat.csv'
        df = pd.read_csv(cfd_path)

        # Batch prediction — much faster than one-by-one
        aero_features = df[['deflection_mm', 'pitch_deg']]
        preds = aerodynamic_model.predict(aero_features)
        df['predicted_cl'] = preds[:, 0]
        df['predicted_cd'] = preds[:, 1]

        points = df[['cl', 'cd', 'predicted_cl', 'predicted_cd', 'pitch_deg']].round(6).to_dict('records')
        return jsonify({'success': True, 'points': points})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


if __name__ == '__main__':
    print("\n" + "="*60)
    print("IDP ML Morphing Wing Frontend - Flask Application")
    print("="*60)
    print(f"Project Directory: {PROJECT_DIR}")
    print(f"Models Directory: {MODELS_DIR}")
    print("\nStarting Flask server on http://localhost:5000")
    print("="*60 + "\n")
    app.run(debug=True, port=5000)
