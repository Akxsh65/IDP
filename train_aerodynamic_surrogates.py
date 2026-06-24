from __future__ import annotations

import json
from pathlib import Path

import joblib
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import cross_validate, train_test_split
from sklearn.multioutput import MultiOutputRegressor
from sklearn.neural_network import MLPRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from load_cfd_data import load_cfd_dataset


FEATURE_SETS = {
    # Matches project methodology: shape + angle of attack.
    "shape_and_pitch": ["deflection_mm", "pitch_deg"],
    # Direct actuation path (voltages + pitch); useful for chained control.
    "voltages_and_pitch": ["lower_mfc_v", "upper_mfc_v", "pitch_deg"],
}


def evaluate_multitarget(
    name: str,
    model,
    x_train: pd.DataFrame,
    x_test: pd.DataFrame,
    y_train: pd.DataFrame,
    y_test: pd.DataFrame,
) -> dict:
    model.fit(x_train, y_train)
    y_pred = model.predict(x_test)

    metrics = {"model": name}
    for idx, target in enumerate(y_test.columns):
        metrics[f"{target}_mae"] = float(
            mean_absolute_error(y_test.iloc[:, idx], y_pred[:, idx])
        )
        metrics[f"{target}_rmse"] = float(
            np.sqrt(mean_squared_error(y_test.iloc[:, idx], y_pred[:, idx]))
        )
        metrics[f"{target}_r2"] = float(
            r2_score(y_test.iloc[:, idx], y_pred[:, idx])
        )
    return metrics


def make_models() -> dict[str, Pipeline]:
    return {
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


def plot_parity(
    y_true: pd.DataFrame,
    y_pred: np.ndarray,
    model_name: str,
    feature_set: str,
    out_dir: Path,
) -> None:
    fig, axes = plt.subplots(1, 2, figsize=(10, 4.5))
    for ax, idx, label in zip(axes, [0, 1], ["CL", "CD"]):
        actual = y_true.iloc[:, idx]
        predicted = y_pred[:, idx]
        ax.scatter(actual, predicted, alpha=0.75)
        lo = min(actual.min(), predicted.min())
        hi = max(actual.max(), predicted.max())
        ax.plot([lo, hi], [lo, hi], "r--", linewidth=1.5)
        ax.set_xlabel(f"Actual {label}")
        ax.set_ylabel(f"Predicted {label}")
        ax.set_title(label)
    fig.suptitle(f"{model_name} ({feature_set})")
    fig.tight_layout()
    fig.savefig(
        out_dir / f"parity_{feature_set}_{model_name}.png",
        dpi=200,
    )
    plt.close(fig)


def main() -> None:
    project_dir = Path(__file__).resolve().parent
    data_path = project_dir / "C_L C_D Values - Sheet1.csv"
    out_dir = project_dir / "outputs_aerodynamic_surrogates"
    out_dir.mkdir(exist_ok=True)

    df = load_cfd_dataset(data_path)
    df.to_csv(out_dir / "cfd_dataset_flat.csv", index=False)

    y = df[["cl", "cd"]]
    all_results: list[dict] = []

    for feature_name, feature_cols in FEATURE_SETS.items():
        x = df[feature_cols]
        x_train, x_test, y_train, y_test = train_test_split(
            x, y, test_size=0.2, random_state=42
        )

        for model_name, model in make_models().items():
            metrics = evaluate_multitarget(
                model_name, model, x_train, x_test, y_train, y_test
            )
            metrics["feature_set"] = feature_name
            all_results.append(metrics)

            artifact_name = f"{feature_name}_{model_name}.joblib"
            joblib.dump(model, out_dir / artifact_name)

            y_pred = model.predict(x_test)
            plot_parity(y_test, y_pred, model_name, feature_name, out_dir)

            cv = cross_validate(
                model,
                x,
                y,
                cv=5,
                scoring="r2",
                return_train_score=True,
            )
            metrics["cv_train_r2_mean"] = float(np.mean(cv["train_score"]))
            metrics["cv_test_r2_mean"] = float(np.mean(cv["test_score"]))

    results_df = pd.DataFrame(all_results).sort_values(
        ["feature_set", "cl_rmse", "cd_rmse"]
    )
    results_df.to_csv(out_dir / "metrics.csv", index=False)
    with (out_dir / "metrics.json").open("w", encoding="utf-8") as f:
        json.dump(results_df.to_dict(orient="records"), f, indent=2)

    print("Aerodynamic surrogate training complete.")
    print(f"Rows used: {len(df)}")
    print(f"Outputs saved in: {out_dir}")
    print("\nMetrics:")
    print(
        results_df[
            [
                "feature_set",
                "model",
                "cl_mae",
                "cl_rmse",
                "cl_r2",
                "cd_mae",
                "cd_rmse",
                "cd_r2",
                "cv_test_r2_mean",
            ]
        ].to_string(index=False)
    )


if __name__ == "__main__":
    main()
