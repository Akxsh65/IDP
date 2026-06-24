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
            errors.append(f"Pitch angle must be between {CONSTRAINTS['pitch_angle']['min']} and {CONSTRAINTS['pitch_angle']['max']}°")
        
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
            errors.append(f"Pitch angle must be between {CONSTRAINTS['pitch_angle']['min']} and {CONSTRAINTS['pitch_angle']['max']}°")
        
        # Get CL max at this pitch
        cl_max = CL_MAX_BY_PITCH.get(int(pitch), 0.3079)
        if target_cl > cl_max:
            errors.append(f"Target CL ({target_cl}) exceeds maximum achievable CL ({cl_max:.4f}) at {pitch}°")
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
                'training_samples': 240,
                'test_samples': 60
            },
            'aerodynamic': {
                'type': 'MLP Regressor (MultiOutput)',
                'inputs': ['deflection_mm', 'pitch_deg'],
                'outputs': ['cl', 'cd'],
                'hidden_layers': [64, 32],
                'activation': 'relu',
                'cl_mae': 0.0022,
                'cl_r2': 0.998,
                'cd_mae': 0.0021,
                'cd_r2': 0.991,
                'training_samples': 8000,
                'test_samples': 40
            }
        },
        'chained_performance': {
            'cl_mae': 0.0022,
            'cd_mae': 0.0021,
            'validation_points': 201
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


if __name__ == '__main__':
    print("\n" + "="*60)
    print("IDP ML Morphing Wing Frontend - Flask Application")
    print("="*60)
    print(f"Project Directory: {PROJECT_DIR}")
    print(f"Models Directory: {MODELS_DIR}")
    print("\nStarting Flask server on http://localhost:5000")
    print("="*60 + "\n")
    app.run(debug=True, port=5000)
