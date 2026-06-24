from __future__ import annotations

from pathlib import Path
import json

import joblib
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.neural_network import MLPRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


def load_structure_samples(excel_path: Path) -> pd.DataFrame:
    """Load and normalize the 4-block worksheet into one clean table."""
    raw_df = pd.read_excel(excel_path)
    blocks = []

    for block_idx in range(4):
        block = pd.DataFrame(
            {
                "lower_mfc_v": pd.to_numeric(raw_df.iloc[:, block_idx * 4], errors="coerce"),
                "upper_mfc_v": pd.to_numeric(raw_df.iloc[:, block_idx * 4 + 1], errors="coerce"),
                "deflection_mm": pd.to_numeric(raw_df.iloc[:, block_idx * 4 + 2], errors="coerce"),
            }
        )
        block = block.dropna(subset=["lower_mfc_v", "upper_mfc_v", "deflection_mm"])
        blocks.append(block)

    df = pd.concat(blocks, ignore_index=True)
    df = df.sort_values(["lower_mfc_v", "upper_mfc_v"]).reset_index(drop=True)
    return df


def evaluate_model(name: str, model, x_train, x_test, y_train, y_test) -> dict:
    model.fit(x_train, y_train)
    y_pred = model.predict(x_test)

    metrics = {
        "model": name,
        "mae_mm": float(mean_absolute_error(y_test, y_pred)),
        "rmse_mm": float(np.sqrt(mean_squared_error(y_test, y_pred))),
        "r2": float(r2_score(y_test, y_pred)),
    }
    return metrics


def main() -> None:
    project_dir = Path(__file__).resolve().parent
    data_path = project_dir / "Structure samples.xlsx"
    out_dir = project_dir / "outputs_structural_surrogates"
    out_dir.mkdir(exist_ok=True)

    df = load_structure_samples(data_path)
    x = df[["lower_mfc_v", "upper_mfc_v"]]
    y = df["deflection_mm"]

    x_train, x_test, y_train, y_test = train_test_split(
        x, y, test_size=0.2, random_state=42
    )

    linear_model = Pipeline(
        [
            ("scaler", StandardScaler()),
            ("regressor", LinearRegression()),
        ]
    )
    mlp_model = Pipeline(
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
    )

    results = []
    for name, model in [("linear_regression", linear_model), ("mlp_regressor", mlp_model)]:
        metrics = evaluate_model(name, model, x_train, x_test, y_train, y_test)
        results.append(metrics)
        joblib.dump(model, out_dir / f"{name}.joblib")

    results_df = pd.DataFrame(results).sort_values("rmse_mm").reset_index(drop=True)
    results_df.to_csv(out_dir / "metrics.csv", index=False)
    with (out_dir / "metrics.json").open("w", encoding="utf-8") as f:
        json.dump(results_df.to_dict(orient="records"), f, indent=2)

    best_name = results_df.iloc[0]["model"]
    best_model = joblib.load(out_dir / f"{best_name}.joblib")
    y_pred_best = best_model.predict(x_test)

    plt.figure(figsize=(7, 6))
    plt.scatter(y_test, y_pred_best, alpha=0.75)
    diag_min = min(y_test.min(), y_pred_best.min())
    diag_max = max(y_test.max(), y_pred_best.max())
    plt.plot([diag_min, diag_max], [diag_min, diag_max], "r--", linewidth=1.5)
    plt.xlabel("Actual deflection (mm)")
    plt.ylabel("Predicted deflection (mm)")
    plt.title(f"Best model parity plot: {best_name}")
    plt.tight_layout()
    plt.savefig(out_dir / "best_model_parity_plot.png", dpi=200)
    plt.close()

    # Save a simple prediction table for quick inspection.
    pred_table = x_test.copy()
    pred_table["actual_deflection_mm"] = y_test.values
    pred_table["predicted_deflection_mm"] = y_pred_best
    pred_table["abs_error_mm"] = np.abs(
        pred_table["actual_deflection_mm"] - pred_table["predicted_deflection_mm"]
    )
    pred_table.sort_values("abs_error_mm", ascending=False).to_csv(
        out_dir / "test_predictions.csv", index=False
    )

    print("Training complete.")
    print(f"Rows used: {len(df)}")
    print(f"Outputs saved in: {out_dir}")
    print("\nModel metrics (lower is better for MAE/RMSE):")
    print(results_df.to_string(index=False))


if __name__ == "__main__":
    main()
