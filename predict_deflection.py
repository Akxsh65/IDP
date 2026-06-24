from __future__ import annotations

import argparse
from pathlib import Path

import joblib
import pandas as pd


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Predict trailing-edge deflection from MFC voltages."
    )
    parser.add_argument(
        "--upper-v",
        type=float,
        required=True,
        help="Upper skin MFC voltage in volts (example: 1000).",
    )
    parser.add_argument(
        "--lower-v",
        type=float,
        required=True,
        help="Lower skin MFC voltage in volts (example: -50).",
    )
    parser.add_argument(
        "--model-path",
        type=str,
        default="outputs_structural_surrogates/linear_regression.joblib",
        help="Path to trained model (.joblib).",
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()
    project_dir = Path(__file__).resolve().parent
    model_path = (project_dir / args.model_path).resolve()

    if not model_path.exists():
        raise FileNotFoundError(f"Model not found: {model_path}")

    model = joblib.load(model_path)
    input_df = pd.DataFrame(
        [{"lower_mfc_v": args.lower_v, "upper_mfc_v": args.upper_v}]
    )
    predicted_deflection = float(model.predict(input_df)[0])

    print("Prediction complete:")
    print(f"  Model         : {model_path.name}")
    print(f"  Upper MFC (V) : {args.upper_v}")
    print(f"  Lower MFC (V) : {args.lower_v}")
    print(f"  Deflection(mm): {predicted_deflection:.6f}")


if __name__ == "__main__":
    main()
