from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.multioutput import MultiOutputRegressor
from sklearn.neural_network import MLPRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from data_loaders import load_cfd_dataset, load_structure_samples


def train_structural_models(
    train_df: pd.DataFrame,
    test_df: pd.DataFrame,
    out_dir: Path,
) -> pd.DataFrame:
    x_train = train_df[["lower_mfc_v", "upper_mfc_v"]]
    y_train = train_df["deflection_mm"]
    x_test = test_df[["lower_mfc_v", "upper_mfc_v"]]
    y_test = test_df["deflection_mm"]

    models = {
        "linear_regression": Pipeline(
            [
                ("scaler", StandardScaler()),
                ("regressor", LinearRegression()),
            ]
        ),
        "mlp_regressor": Pipeline(
            [
                ("scaler", StandardScaler()),
                (
                    "regressor",
                    MLPRegressor(
                        hidden_layer_sizes=(64, 32),
                        activation="relu",
                        solver="adam",
                        learning_rate_init=0.003,
                        max_iter=8000,
                        random_state=42,
                    ),
                ),
            ]
        ),
    }

    results = []
    for name, model in models.items():
        model.fit(x_train, y_train)
        y_pred = model.predict(x_test)
        metrics = {
            "task": "structural",
            "model": name,
            "mae": float(mean_absolute_error(y_test, y_pred)),
            "rmse": float(np.sqrt(mean_squared_error(y_test, y_pred))),
            "r2": float(r2_score(y_test, y_pred)),
        }
        results.append(metrics)
        joblib.dump(model, out_dir / f"structural_{name}.joblib")

    return pd.DataFrame(results)


def train_aerodynamic_models(
    train_df: pd.DataFrame,
    test_df: pd.DataFrame,
    out_dir: Path,
) -> pd.DataFrame:
    feature_cols = ["deflection_mm", "pitch_deg"]
    x_train = train_df[feature_cols]
    y_train = train_df[["cl", "cd"]]
    x_test = test_df[feature_cols]
    y_test = test_df[["cl", "cd"]]

    models = {
        "linear_regression": Pipeline(
            [
                ("scaler", StandardScaler()),
                ("regressor", MultiOutputRegressor(LinearRegression())),
            ]
        ),
        "mlp_regressor": Pipeline(
            [
                ("scaler", StandardScaler()),
                (
                    "regressor",
                    MultiOutputRegressor(
                        MLPRegressor(
                            hidden_layer_sizes=(64, 32),
                            activation="relu",
                            solver="adam",
                            learning_rate_init=0.003,
                            max_iter=10000,
                            random_state=42,
                        )
                    ),
                ),
            ]
        ),
    }

    results = []
    for name, model in models.items():
        model.fit(x_train, y_train)
        y_pred = model.predict(x_test)
        results.append(
            {
                "task": "aerodynamic_cl",
                "model": name,
                "mae": float(mean_absolute_error(y_test["cl"], y_pred[:, 0])),
                "rmse": float(np.sqrt(mean_squared_error(y_test["cl"], y_pred[:, 0]))),
                "r2": float(r2_score(y_test["cl"], y_pred[:, 0])),
            }
        )
        results.append(
            {
                "task": "aerodynamic_cd",
                "model": name,
                "mae": float(mean_absolute_error(y_test["cd"], y_pred[:, 1])),
                "rmse": float(np.sqrt(mean_squared_error(y_test["cd"], y_pred[:, 1]))),
                "r2": float(r2_score(y_test["cd"], y_pred[:, 1])),
            }
        )
        joblib.dump(model, out_dir / f"aerodynamic_{name}.joblib")

        best_linear = out_dir / "aerodynamic_linear_regression.joblib"
        if name == "linear_regression":
            fig, axes = plt.subplots(1, 2, figsize=(10, 4.5))
            for ax, idx, label in zip(axes, [0, 1], ["CL", "CD"]):
                actual = y_test.iloc[:, idx]
                predicted = y_pred[:, idx]
                ax.scatter(actual, predicted, alpha=0.75)
                lo = min(actual.min(), predicted.min())
                hi = max(actual.max(), predicted.max())
                ax.plot([lo, hi], [lo, hi], "r--", linewidth=1.5)
                ax.set_xlabel(f"Actual {label}")
                ax.set_ylabel(f"Predicted {label}")
            fig.suptitle("Aerodynamic parity (real test set)")
            fig.tight_layout()
            fig.savefig(out_dir / "aerodynamic_parity_linear.png", dpi=200)
            plt.close(fig)

    return pd.DataFrame(results)


def retrain_on_augmented(
    augment_label: str,
    structural_aug_path: Path,
    aero_aug_path: Path,
    structural_real: pd.DataFrame,
    cfd_real: pd.DataFrame,
    out_root: Path,
) -> pd.DataFrame:
    out_dir = out_root / f"retrained_{augment_label}"
    out_dir.mkdir(parents=True, exist_ok=True)

    structural_aug = pd.read_csv(structural_aug_path)
    aero_aug = pd.read_csv(aero_aug_path)

    # Evaluate only on real measured/simulated points.
    structural_metrics = train_structural_models(
        train_df=structural_aug,
        test_df=structural_real,
        out_dir=out_dir,
    )
    aero_metrics = train_aerodynamic_models(
        train_df=aero_aug,
        test_df=cfd_real,
        out_dir=out_dir,
    )

    metrics = pd.concat([structural_metrics, aero_metrics], ignore_index=True)
    metrics["augmentation"] = augment_label
    metrics.to_csv(out_dir / "metrics.csv", index=False)
    with (out_dir / "metrics.json").open("w", encoding="utf-8") as f:
        json.dump(metrics.to_dict(orient="records"), f, indent=2)
    return metrics


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Retrain structural and aerodynamic surrogates on augmented datasets."
    )
    parser.add_argument(
        "--synthetic-dir",
        type=str,
        default="outputs_synthetic_data",
        help="Directory containing augmented CSV files.",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default="outputs_augmented_models",
        help="Directory for retrained model artifacts.",
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()
    project_dir = Path(__file__).resolve().parent
    synthetic_dir = (project_dir / args.synthetic_dir).resolve()
    out_root = (project_dir / args.output_dir).resolve()
    out_root.mkdir(parents=True, exist_ok=True)

    structural_real = load_structure_samples(project_dir / "Structure samples.xlsx")
    cfd_real = load_cfd_dataset(project_dir / "C_L C_D Values - Sheet1.csv")

    all_metrics = []
    for label, struct_file, aero_file in [
        (
            "strict",
            synthetic_dir / "structural_augmented_strict.csv",
            synthetic_dir / "aerodynamic_augmented_strict.csv",
        ),
        (
            "noisy",
            synthetic_dir / "structural_augmented_noisy.csv",
            synthetic_dir / "aerodynamic_augmented_noisy.csv",
        ),
    ]:
        if not struct_file.exists() or not aero_file.exists():
            raise FileNotFoundError(
                f"Missing augmented files for {label}. Run generate_synthetic_data.py first."
            )
        metrics = retrain_on_augmented(
            augment_label=label,
            structural_aug_path=struct_file,
            aero_aug_path=aero_file,
            structural_real=structural_real,
            cfd_real=cfd_real,
            out_root=out_root,
        )
        all_metrics.append(metrics)

    summary = pd.concat(all_metrics, ignore_index=True)
    summary.to_csv(out_root / "retrain_summary.csv", index=False)

    print("Retraining on augmented data complete.")
    print(f"Summary saved to: {out_root / 'retrain_summary.csv'}")
    print()
    print(summary.to_string(index=False))


if __name__ == "__main__":
    main()
