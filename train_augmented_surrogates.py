from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import joblib
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import (
    GridSearchCV,
    KFold,
    cross_validate,
    train_test_split,
)
from sklearn.multioutput import MultiOutputRegressor
from sklearn.neural_network import MLPRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from data_loaders import load_cfd_dataset, load_structure_samples
from generate_synthetic_data import build_leak_free_augmented_datasets

RANDOM_STATE = 42
TEST_SIZE = 0.2
CV_FOLDS = 5

STRUCTURAL_MLP_PARAM_GRID = {
    "regressor__hidden_layer_sizes": [(32,), (64, 32), (128, 64)],
    "regressor__alpha": [1e-4, 1e-3, 1e-2],
    "regressor__learning_rate_init": [0.001, 0.003],
}

AERO_MLP_PARAM_GRID = {
    "regressor__estimator__hidden_layer_sizes": [(32,), (64, 32), (128, 64)],
    "regressor__estimator__alpha": [1e-4, 1e-3, 1e-2],
    "regressor__estimator__learning_rate_init": [0.001, 0.003],
}


def _regression_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict[str, float]:
    y_true = np.asarray(y_true)
    y_pred = np.asarray(y_pred)
    mae = float(mean_absolute_error(y_true, y_pred))
    rmse = float(np.sqrt(mean_squared_error(y_true, y_pred)))
    r2 = float(r2_score(y_true, y_pred))
    denom = np.maximum(np.abs(y_true), 1e-12)
    mape = float(np.mean(np.abs((y_true - y_pred) / denom)) * 100.0)
    return {"mae": mae, "rmse": rmse, "r2": r2, "mape_pct": mape}


def _make_structural_mlp(**overrides: Any) -> Pipeline:
    params = {
        "hidden_layer_sizes": (64, 32),
        "activation": "relu",
        "solver": "adam",
        "learning_rate_init": 0.003,
        "alpha": 1e-3,
        "max_iter": 8000,
        "random_state": RANDOM_STATE,
    }
    params.update(overrides)
    return Pipeline(
        [
            ("scaler", StandardScaler()),
            ("regressor", MLPRegressor(**params)),
        ]
    )


def _make_aero_mlp(**overrides: Any) -> Pipeline:
    params = {
        "hidden_layer_sizes": (64, 32),
        "activation": "relu",
        "solver": "adam",
        "learning_rate_init": 0.003,
        "alpha": 1e-3,
        "max_iter": 10000,
        "random_state": RANDOM_STATE,
    }
    params.update(overrides)
    return Pipeline(
        [
            ("scaler", StandardScaler()),
            (
                "regressor",
                MultiOutputRegressor(MLPRegressor(**params)),
            ),
        ]
    )


def _make_linear_pipeline(multioutput: bool = False) -> Pipeline:
    regressor = (
        MultiOutputRegressor(LinearRegression())
        if multioutput
        else LinearRegression()
    )
    return Pipeline([("scaler", StandardScaler()), ("regressor", regressor)])


def _cross_validate_model(
    model: Pipeline,
    x: pd.DataFrame,
    y: pd.DataFrame | pd.Series,
    cv_folds: int = CV_FOLDS,
) -> dict[str, float]:
    cv = KFold(n_splits=cv_folds, shuffle=True, random_state=RANDOM_STATE)
    scores = cross_validate(
        model,
        x,
        y,
        cv=cv,
        scoring="r2",
        return_train_score=True,
        n_jobs=-1,
    )
    return {
        "cv_train_r2_mean": float(np.mean(scores["train_score"])),
        "cv_train_r2_std": float(np.std(scores["train_score"])),
        "cv_val_r2_mean": float(np.mean(scores["test_score"])),
        "cv_val_r2_std": float(np.std(scores["test_score"])),
        "cv_overfit_gap": float(
            np.mean(scores["train_score"]) - np.mean(scores["test_score"])
        ),
    }


def _tune_mlp(
    base_model: Pipeline,
    param_grid: dict[str, list[Any]],
    x_train: pd.DataFrame,
    y_train: pd.DataFrame | pd.Series,
    cv_folds: int = CV_FOLDS,
) -> tuple[Pipeline, dict[str, Any], pd.DataFrame]:
    cv = KFold(n_splits=cv_folds, shuffle=True, random_state=RANDOM_STATE)
    search = GridSearchCV(
        estimator=base_model,
        param_grid=param_grid,
        scoring="r2",
        cv=cv,
        n_jobs=-1,
        refit=True,
        return_train_score=True,
    )
    search.fit(x_train, y_train)

    cv_results = pd.DataFrame(search.cv_results_)
    cv_results = cv_results.sort_values("rank_test_score").reset_index(drop=True)
    return search.best_estimator_, dict(search.best_params_), cv_results


def _verify_no_real_row_overlap(
    train_df: pd.DataFrame,
    test_df: pd.DataFrame,
    key_cols: list[str],
    label: str,
) -> None:
    train_real = (
        train_df.loc[~train_df["is_synthetic"]]
        if "is_synthetic" in train_df.columns
        else train_df
    )
    train_keys = set(map(tuple, train_real[key_cols].to_numpy()))
    test_keys = set(map(tuple, test_df[key_cols].to_numpy()))
    overlap = train_keys & test_keys
    if overlap:
        raise RuntimeError(
            f"{label}: {len(overlap)} overlapping real rows between train and test splits."
        )


def _remove_synthetic_test_overlap(
    train_aug: pd.DataFrame,
    test_real: pd.DataFrame,
    match_cols: list[str],
    atol: float = 1e-6,
) -> pd.DataFrame:
    """Drop synthetic rows that duplicate held-out real keys in feature/identity space."""
    if "is_synthetic" not in train_aug.columns:
        return train_aug

    test_values = test_real[match_cols].to_numpy(dtype=float)
    keep_indices: list[int] = []
    dropped = 0
    for idx, row in train_aug.iterrows():
        if not bool(row["is_synthetic"]):
            keep_indices.append(idx)
            continue
        feat = row[match_cols].to_numpy(dtype=float)
        duplicates_test = np.any(
            np.all(np.isclose(feat, test_values, atol=atol, rtol=0.0), axis=1)
        )
        if duplicates_test:
            dropped += 1
            continue
        keep_indices.append(idx)

    filtered = train_aug.loc[keep_indices].reset_index(drop=True)
    if dropped:
        print(
            f"Removed {dropped} synthetic training rows overlapping held-out "
            f"{match_cols} keys."
        )
    return filtered


def _plot_structural_parity(
    y_test: pd.Series,
    y_pred: np.ndarray,
    title: str,
    out_path: Path,
) -> None:
    plt.figure(figsize=(6, 5))
    plt.scatter(y_test, y_pred, alpha=0.75)
    lo = min(y_test.min(), y_pred.min())
    hi = max(y_test.max(), y_pred.max())
    plt.plot([lo, hi], [lo, hi], "r--", linewidth=1.5)
    plt.xlabel("Actual deflection (mm)")
    plt.ylabel("Predicted deflection (mm)")
    plt.title(title)
    plt.tight_layout()
    plt.savefig(out_path, dpi=200)
    plt.close()


def _plot_aero_parity(
    y_test: pd.DataFrame,
    y_pred: np.ndarray,
    title: str,
    out_path: Path,
) -> None:
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
        ax.set_title(label)
    fig.suptitle(title)
    fig.tight_layout()
    fig.savefig(out_path, dpi=200)
    plt.close(fig)


def train_structural_task(
    structural_train_aug: pd.DataFrame,
    structural_test_real: pd.DataFrame,
    out_dir: Path,
) -> tuple[pd.DataFrame, dict[str, str]]:
    x_train = structural_train_aug[["lower_mfc_v", "upper_mfc_v"]]
    y_train = structural_train_aug["deflection_mm"]
    x_test = structural_test_real[["lower_mfc_v", "upper_mfc_v"]]
    y_test = structural_test_real["deflection_mm"]

    _verify_no_real_row_overlap(
        structural_train_aug,
        structural_test_real,
        ["lower_mfc_v", "upper_mfc_v"],
        "structural",
    )

    n_synthetic = int(structural_train_aug["is_synthetic"].sum())
    results: list[dict[str, Any]] = []
    best_models: dict[str, str] = {}

    linear = _make_linear_pipeline(multioutput=False)
    linear.fit(x_train, y_train)
    linear_pred = linear.predict(x_test)
    linear_test = _regression_metrics(y_test, linear_pred)
    linear_cv = _cross_validate_model(linear, x_train, y_train)
    results.append(
        {
            "task": "structural",
            "target": "deflection_mm",
            "model": "linear_regression",
            "best_params": json.dumps({}),
            "n_train_total": len(x_train),
            "n_train_synthetic": n_synthetic,
            "n_test_real": len(x_test),
            **linear_cv,
            **{f"test_{k}": v for k, v in linear_test.items()},
            "test_train_r2_gap": linear_test["r2"] - linear_cv["cv_val_r2_mean"],
        }
    )
    joblib.dump(linear, out_dir / "structural_linear_regression.joblib")

    mlp_base = _make_structural_mlp()
    mlp_tuned, mlp_best_params, mlp_cv_results = _tune_mlp(
        mlp_base, STRUCTURAL_MLP_PARAM_GRID, x_train, y_train
    )
    mlp_cv_results.to_csv(out_dir / "structural_mlp_cv_results.csv", index=False)
    mlp_pred = mlp_tuned.predict(x_test)
    mlp_test = _regression_metrics(y_test, mlp_pred)
    mlp_cv = _cross_validate_model(mlp_tuned, x_train, y_train)
    results.append(
        {
            "task": "structural",
            "target": "deflection_mm",
            "model": "mlp_regressor",
            "best_params": json.dumps(mlp_best_params),
            "n_train_total": len(x_train),
            "n_train_synthetic": n_synthetic,
            "n_test_real": len(x_test),
            **mlp_cv,
            **{f"test_{k}": v for k, v in mlp_test.items()},
            "test_train_r2_gap": mlp_test["r2"] - mlp_cv["cv_val_r2_mean"],
        }
    )
    joblib.dump(mlp_tuned, out_dir / "structural_mlp_regressor.joblib")

    best_name = min(results, key=lambda row: row["test_rmse"])["model"]
    best_models["structural"] = best_name
    best_model = linear if best_name == "linear_regression" else mlp_tuned
    _plot_structural_parity(
        y_test,
        best_model.predict(x_test),
        f"Structural parity — {best_name} (held-out real test)",
        out_dir / "structural_parity_best_test.png",
    )
    return pd.DataFrame(results), best_models


def train_aerodynamic_task(
    aero_train_aug: pd.DataFrame,
    aero_test_real: pd.DataFrame,
    out_dir: Path,
) -> tuple[pd.DataFrame, dict[str, str]]:
    feature_cols = ["deflection_mm", "pitch_deg"]
    x_train = aero_train_aug[feature_cols]
    y_train = aero_train_aug[["cl", "cd"]]
    x_test = aero_test_real[feature_cols]
    y_test = aero_test_real[["cl", "cd"]]

    _verify_no_real_row_overlap(
        aero_train_aug,
        aero_test_real,
        ["lower_mfc_v", "upper_mfc_v", "pitch_deg"],
        "aerodynamic",
    )

    n_synthetic = int(aero_train_aug["is_synthetic"].sum())
    results: list[dict[str, Any]] = []
    best_models: dict[str, str] = {}
    model_objects: dict[str, Pipeline] = {}

    for model_name, factory, param_grid in [
        ("linear_regression", lambda: _make_linear_pipeline(multioutput=True), None),
        ("mlp_regressor", lambda: _make_aero_mlp(), AERO_MLP_PARAM_GRID),
    ]:
        if param_grid is None:
            model = factory()
            model.fit(x_train, y_train)
            best_params: dict[str, Any] = {}
        else:
            model, best_params, cv_results = _tune_mlp(
                factory(), param_grid, x_train, y_train
            )
            cv_results.to_csv(
                out_dir / f"aerodynamic_{model_name}_cv_results.csv", index=False
            )

        y_pred = model.predict(x_test)
        cv_stats = _cross_validate_model(model, x_train, y_train)
        joblib.dump(model, out_dir / f"aerodynamic_{model_name}.joblib")
        model_objects[model_name] = model

        for target_idx, target in enumerate(["cl", "cd"]):
            test_stats = _regression_metrics(y_test.iloc[:, target_idx], y_pred[:, target_idx])
            results.append(
                {
                    "task": f"aerodynamic_{target}",
                    "target": target,
                    "model": model_name,
                    "best_params": json.dumps(best_params),
                    "n_train_total": len(x_train),
                    "n_train_synthetic": n_synthetic,
                    "n_test_real": len(x_test),
                    **cv_stats,
                    **{f"test_{k}": v for k, v in test_stats.items()},
                    "test_train_r2_gap": test_stats["r2"] - cv_stats["cv_val_r2_mean"],
                }
            )

    mlp_cd_rmse = next(
        row["test_rmse"]
        for row in results
        if row["model"] == "mlp_regressor" and row["target"] == "cd"
    )
    linear_cd_rmse = next(
        row["test_rmse"]
        for row in results
        if row["model"] == "linear_regression" and row["target"] == "cd"
    )
    best_name = "mlp_regressor" if mlp_cd_rmse <= linear_cd_rmse else "linear_regression"
    best_models["aerodynamic"] = best_name
    _plot_aero_parity(
        y_test,
        model_objects[best_name].predict(x_test),
        f"Aerodynamic parity — {best_name} (held-out real test)",
        out_dir / "aerodynamic_parity_best_test.png",
    )
    return pd.DataFrame(results), best_models


def fit_deployment_models(
    structural_real: pd.DataFrame,
    cfd_real: pd.DataFrame,
    mode: str,
    noise_scale: float,
    best_params: dict[str, dict[str, Any]],
    out_dir: Path,
) -> None:
    """Refit selected models on all real data + synthetic derived from all real data."""
    from generate_synthetic_data import build_augmented_dataset, generate_synthetic_dataset

    synthetic_full = generate_synthetic_dataset(
        structural_df=structural_real,
        cfd_df=cfd_real,
        mode=mode,
        noise_scale=noise_scale,
        random_state=RANDOM_STATE,
    )
    structural_aug, aero_aug = build_augmented_dataset(
        structural_real, cfd_real, synthetic_full
    )

    struct_params = best_params.get("structural_mlp", {})
    struct_mlp_overrides = {
        key.removeprefix("regressor__"): value
        for key, value in struct_params.items()
    }
    structural_model = (
        _make_linear_pipeline(multioutput=False)
        if best_params.get("structural") == "linear_regression"
        else _make_structural_mlp(**struct_mlp_overrides)
    )
    structural_model.fit(
        structural_aug[["lower_mfc_v", "upper_mfc_v"]],
        structural_aug["deflection_mm"],
    )
    joblib.dump(structural_model, out_dir / "structural_linear_regression.joblib")

    aero_params = best_params.get("aerodynamic_mlp", {})
    aero_mlp_overrides = {
        key.removeprefix("regressor__estimator__"): value
        for key, value in aero_params.items()
    }
    aerodynamic_model = (
        _make_linear_pipeline(multioutput=True)
        if best_params.get("aerodynamic") == "linear_regression"
        else _make_aero_mlp(**aero_mlp_overrides)
    )
    feature_cols = ["deflection_mm", "pitch_deg"]
    aerodynamic_model.fit(aero_aug[feature_cols], aero_aug[["cl", "cd"]])

    aero_filename = (
        "aerodynamic_mlp_regressor.joblib"
        if best_params.get("aerodynamic") == "mlp_regressor"
        else "aerodynamic_linear_regression.joblib"
    )
    joblib.dump(aerodynamic_model, out_dir / aero_filename)


def run_leak_free_pipeline(
    augment_label: str,
    structural_real: pd.DataFrame,
    cfd_real: pd.DataFrame,
    out_root: Path,
    noise_scale: float = 1.0,
) -> pd.DataFrame:
    out_dir = out_root / f"retrained_{augment_label}"
    out_dir.mkdir(parents=True, exist_ok=True)

    struct_train, struct_test = train_test_split(
        structural_real,
        test_size=TEST_SIZE,
        random_state=RANDOM_STATE,
    )
    cfd_train, cfd_test = train_test_split(
        cfd_real,
        test_size=TEST_SIZE,
        random_state=RANDOM_STATE,
    )

    structural_train_aug, aero_train_aug, synthetic_train = (
        build_leak_free_augmented_datasets(
            structural_train=struct_train,
            cfd_train=cfd_train,
            mode=augment_label,
            noise_scale=noise_scale,
            random_state=RANDOM_STATE,
        )
    )

    structural_train_aug = _remove_synthetic_test_overlap(
        structural_train_aug,
        struct_test,
        ["lower_mfc_v", "upper_mfc_v"],
    )
    aero_train_aug = _remove_synthetic_test_overlap(
        aero_train_aug,
        cfd_test,
        ["deflection_mm", "pitch_deg"],
    )

    structural_train_aug.to_csv(out_dir / "structural_train_augmented.csv", index=False)
    aero_train_aug.to_csv(out_dir / "aerodynamic_train_augmented.csv", index=False)
    struct_test.to_csv(out_dir / "structural_test_real.csv", index=False)
    cfd_test.to_csv(out_dir / "aerodynamic_test_real.csv", index=False)
    synthetic_train.to_csv(out_dir / "synthetic_train_only.csv", index=False)

    split_audit = {
        "random_state": RANDOM_STATE,
        "test_size": TEST_SIZE,
        "cv_folds": CV_FOLDS,
        "leakage_fixes": [
            "Real data split before synthetic generation.",
            "Interpolators fit only on training real rows.",
            "Test set is held-out real rows never seen during augmentation or training.",
            "Synthetic rows matching held-out voltage or (deflection, pitch) keys are removed.",
            "Hyperparameter tuning uses CV on augmented training data only.",
        ],
        "structural": {
            "n_real_total": len(structural_real),
            "n_train_real": len(struct_train),
            "n_test_real": len(struct_test),
            "n_train_augmented": len(structural_train_aug),
            "n_train_synthetic": int(synthetic_train["is_synthetic"].sum()),
        },
        "aerodynamic": {
            "n_real_total": len(cfd_real),
            "n_train_real": len(cfd_train),
            "n_test_real": len(cfd_test),
            "n_train_augmented": len(aero_train_aug),
            "n_train_synthetic": int(synthetic_train["is_synthetic"].sum()),
        },
    }
    with (out_dir / "split_audit.json").open("w", encoding="utf-8") as f:
        json.dump(split_audit, f, indent=2)

    structural_metrics, struct_best = train_structural_task(
        structural_train_aug, struct_test, out_dir
    )
    aero_metrics, aero_best = train_aerodynamic_task(
        aero_train_aug, cfd_test, out_dir
    )

    metrics = pd.concat([structural_metrics, aero_metrics], ignore_index=True)
    metrics["augmentation"] = augment_label
    metrics["evaluation_protocol"] = "leak_free_holdout"
    metrics.to_csv(out_dir / "metrics.csv", index=False)
    with (out_dir / "metrics.json").open("w", encoding="utf-8") as f:
        json.dump(metrics.to_dict(orient="records"), f, indent=2)

    struct_mlp_row = structural_metrics.loc[
        structural_metrics["model"] == "mlp_regressor"
    ].iloc[0]
    aero_mlp_row = aero_metrics.loc[
        (aero_metrics["model"] == "mlp_regressor")
        & (aero_metrics["target"] == "cd")
    ].iloc[0]

    deployment_params = {
        "structural": struct_best["structural"],
        "aerodynamic": aero_best["aerodynamic"],
        "structural_mlp": json.loads(struct_mlp_row["best_params"]),
        "aerodynamic_mlp": json.loads(aero_mlp_row["best_params"]),
    }
    with (out_dir / "deployment_selection.json").open("w", encoding="utf-8") as f:
        json.dump(deployment_params, f, indent=2)

    fit_deployment_models(
        structural_real=structural_real,
        cfd_real=cfd_real,
        mode=augment_label,
        noise_scale=noise_scale,
        best_params=deployment_params,
        out_dir=out_dir,
    )

    return metrics


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Leak-free retraining: split real data first, augment from train only, "
            "tune with CV, and evaluate on held-out real test rows."
        )
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default="outputs_augmented_models",
        help="Directory for retrained model artifacts.",
    )
    parser.add_argument(
        "--noise-scale",
        type=float,
        default=1.0,
        help="Noise scale for noisy augmentation mode.",
    )
    parser.add_argument(
        "--modes",
        nargs="+",
        choices=["strict", "noisy"],
        default=["strict", "noisy"],
        help="Augmentation modes to train.",
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()
    project_dir = Path(__file__).resolve().parent
    out_root = (project_dir / args.output_dir).resolve()
    out_root.mkdir(parents=True, exist_ok=True)

    structural_real = load_structure_samples(project_dir / "Structure samples.xlsx")
    cfd_real = load_cfd_dataset(project_dir / "C_L C_D Values - Sheet1.csv")

    all_metrics = []
    for label in args.modes:
        metrics = run_leak_free_pipeline(
            augment_label=label,
            structural_real=structural_real,
            cfd_real=cfd_real,
            out_root=out_root,
            noise_scale=args.noise_scale,
        )
        all_metrics.append(metrics)

    summary = pd.concat(all_metrics, ignore_index=True)
    summary.to_csv(out_root / "retrain_summary.csv", index=False)

    print("Leak-free augmented retraining complete.")
    print(f"Summary saved to: {out_root / 'retrain_summary.csv'}")
    print()
    display_cols = [
        "augmentation",
        "task",
        "target",
        "model",
        "cv_val_r2_mean",
        "cv_val_r2_std",
        "cv_overfit_gap",
        "test_r2",
        "test_rmse",
        "test_mae",
        "n_test_real",
    ]
    print(summary[display_cols].to_string(index=False))


if __name__ == "__main__":
    main()
