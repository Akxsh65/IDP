from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.interpolate import LinearNDInterpolator, RegularGridInterpolator

from data_loaders import load_cfd_dataset, load_structure_samples

LOWER_V_MIN = -500.0
LOWER_V_MAX = -50.0
UPPER_V_MIN = 50.0
UPPER_V_MAX = 1500.0
PITCH_VALUES = np.array([-4.0, 0.0, 4.0, 8.0, 12.0, 16.0, 20.0])
VOLTAGE_STEP = 25.0

# Residual noise scales derived from observed surrogate errors on real data.
DEFAULT_DEFLECTION_SIGMA = 0.003
DEFAULT_CL_SIGMA = 0.006
DEFAULT_CD_SIGMA = 0.010


def _build_structural_interpolator(structural_df: pd.DataFrame) -> RegularGridInterpolator:
    lower_axis = np.sort(structural_df["lower_mfc_v"].unique())
    upper_axis = np.sort(structural_df["upper_mfc_v"].unique())
    grid = structural_df.pivot_table(
        index="lower_mfc_v",
        columns="upper_mfc_v",
        values="deflection_mm",
        aggfunc="mean",
    )
    grid = grid.reindex(index=lower_axis, columns=upper_axis)
    values = grid.values
    return RegularGridInterpolator(
        (lower_axis, upper_axis),
        values,
        method="linear",
        bounds_error=False,
        fill_value=None,
    )


def _build_aero_interpolators(
    cfd_df: pd.DataFrame,
) -> tuple[LinearNDInterpolator, LinearNDInterpolator]:
    points = cfd_df[["deflection_mm", "pitch_deg"]].values
    cl_interp = LinearNDInterpolator(points, cfd_df["cl"].values)
    cd_interp = LinearNDInterpolator(points, cfd_df["cd"].values)
    return cl_interp, cd_interp


def _dense_voltage_grid() -> tuple[np.ndarray, np.ndarray]:
    lower_values = np.arange(LOWER_V_MIN, LOWER_V_MAX + 1, VOLTAGE_STEP, dtype=float)
    upper_values = np.arange(UPPER_V_MIN, UPPER_V_MAX + 1, VOLTAGE_STEP, dtype=float)
    return lower_values, upper_values


def _interpolation_residuals(
    structural_df: pd.DataFrame,
    cfd_df: pd.DataFrame,
    struct_interp: RegularGridInterpolator,
    cl_interp: LinearNDInterpolator,
    cd_interp: LinearNDInterpolator,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    struct_points = structural_df[["lower_mfc_v", "upper_mfc_v"]].values
    struct_pred = struct_interp(struct_points)
    struct_residuals = structural_df["deflection_mm"].values - struct_pred

    cfd_points = cfd_df[["deflection_mm", "pitch_deg"]].values
    cl_pred = cl_interp(cfd_points)
    cd_pred = cd_interp(cfd_points)
    cl_residuals = cfd_df["cl"].values - cl_pred
    cd_residuals = cfd_df["cd"].values - cd_pred

    struct_residuals = struct_residuals[np.isfinite(struct_residuals)]
    cl_residuals = cl_residuals[np.isfinite(cl_residuals)]
    cd_residuals = cd_residuals[np.isfinite(cd_residuals)]
    return struct_residuals, cl_residuals, cd_residuals


def _clip_outputs(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["deflection_mm"] = df["deflection_mm"].clip(-8.6, -0.3)
    df["cl"] = df["cl"].clip(0.0, 0.35)
    df["cd"] = df["cd"].clip(0.01, 0.16)
    return df


def generate_synthetic_dataset(
    structural_df: pd.DataFrame,
    cfd_df: pd.DataFrame,
    mode: str = "strict",
    noise_scale: float = 1.0,
    random_state: int = 42,
) -> pd.DataFrame:
    if mode not in {"strict", "noisy"}:
        raise ValueError("mode must be 'strict' or 'noisy'")

    struct_interp = _build_structural_interpolator(structural_df)
    cl_interp, cd_interp = _build_aero_interpolators(cfd_df)
    lower_values, upper_values = _dense_voltage_grid()

    rng = np.random.default_rng(random_state)
    struct_residuals = cl_residuals = cd_residuals = None
    if mode == "noisy":
        struct_residuals, cl_residuals, cd_residuals = _interpolation_residuals(
            structural_df, cfd_df, struct_interp, cl_interp, cd_interp
        )

    rows: list[dict] = []
    for lower_v in lower_values:
        for upper_v in upper_values:
            deflection = float(struct_interp([[lower_v, upper_v]])[0])
            if not np.isfinite(deflection):
                continue

            if mode == "noisy":
                if len(struct_residuals) > 0:
                    deflection += rng.choice(struct_residuals) * noise_scale
                else:
                    deflection += rng.normal(0.0, DEFAULT_DEFLECTION_SIGMA * noise_scale)

            for pitch in PITCH_VALUES:
                cl = float(cl_interp(deflection, pitch))
                cd = float(cd_interp(deflection, pitch))
                if not np.isfinite(cl) or not np.isfinite(cd):
                    continue

                if mode == "noisy":
                    if len(cl_residuals) > 0:
                        cl += rng.choice(cl_residuals) * noise_scale
                    else:
                        cl += rng.normal(0.0, DEFAULT_CL_SIGMA * noise_scale)
                    if len(cd_residuals) > 0:
                        cd += rng.choice(cd_residuals) * noise_scale
                    else:
                        cd += rng.normal(0.0, DEFAULT_CD_SIGMA * noise_scale)

                rows.append(
                    {
                        "lower_mfc_v": lower_v,
                        "upper_mfc_v": upper_v,
                        "deflection_mm": deflection,
                        "pitch_deg": float(pitch),
                        "cl": cl,
                        "cd": cd,
                        "is_synthetic": True,
                    }
                )

    synthetic = _clip_outputs(pd.DataFrame(rows))
    return synthetic


def build_augmented_dataset(
    structural_df: pd.DataFrame,
    cfd_df: pd.DataFrame,
    synthetic_df: pd.DataFrame,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Concatenate real rows with synthetic rows.

    Warning: if ``structural_df`` / ``cfd_df`` contain the same rows used for
    evaluation, metrics will be optimistically biased (train/test leakage).
    Prefer :func:`build_leak_free_augmented_datasets` for model evaluation.
    """
    structural_real = structural_df.copy()
    structural_real["is_synthetic"] = False

    synthetic_struct = (
        synthetic_df[["lower_mfc_v", "upper_mfc_v", "deflection_mm", "is_synthetic"]]
        .drop_duplicates(subset=["lower_mfc_v", "upper_mfc_v"])
        .reset_index(drop=True)
    )

    structural_aug = pd.concat(
        [structural_real, synthetic_struct], ignore_index=True
    ).drop_duplicates(subset=["lower_mfc_v", "upper_mfc_v"], keep="first")

    cfd_real = cfd_df.copy()
    cfd_real["is_synthetic"] = False
    aero_aug = pd.concat([cfd_real, synthetic_df], ignore_index=True)
    return structural_aug, aero_aug


def build_leak_free_augmented_datasets(
    structural_train: pd.DataFrame,
    cfd_train: pd.DataFrame,
    mode: str = "strict",
    noise_scale: float = 1.0,
    random_state: int = 42,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Build training-only augmented datasets with interpolators fit on train splits."""
    synthetic_df = generate_synthetic_dataset(
        structural_df=structural_train,
        cfd_df=cfd_train,
        mode=mode,
        noise_scale=noise_scale,
        random_state=random_state,
    )
    structural_aug, aero_aug = build_augmented_dataset(
        structural_train, cfd_train, synthetic_df
    )
    return structural_aug, aero_aug, synthetic_df


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate strict/noisy synthetic datasets for surrogate retraining."
    )
    parser.add_argument(
        "--mode",
        choices=["strict", "noisy"],
        required=True,
        help="strict: deterministic interpolation; noisy: residual bootstrap.",
    )
    parser.add_argument(
        "--noise-scale",
        type=float,
        default=1.0,
        help="Scale factor for noisy residual injection (default: 1.0).",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default="outputs_synthetic_data",
        help="Directory for generated CSV files.",
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()
    project_dir = Path(__file__).resolve().parent
    out_dir = (project_dir / args.output_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    structural_df = load_structure_samples(project_dir / "Structure samples.xlsx")
    cfd_df = load_cfd_dataset(project_dir / "C_L C_D Values - Sheet1.csv")

    synthetic_df = generate_synthetic_dataset(
        structural_df=structural_df,
        cfd_df=cfd_df,
        mode=args.mode,
        noise_scale=args.noise_scale,
    )
    structural_aug, aero_aug = build_augmented_dataset(
        structural_df, cfd_df, synthetic_df
    )

    if args.mode == "strict":
        synthetic_name = "synthetic_dataset_strict.csv"
        structural_aug_name = "structural_augmented_strict.csv"
        aero_aug_name = "aerodynamic_augmented_strict.csv"
    else:
        synthetic_name = "synthetic_dataset_noisy.csv"
        structural_aug_name = "structural_augmented_noisy.csv"
        aero_aug_name = "aerodynamic_augmented_noisy.csv"

    synthetic_df.to_csv(out_dir / synthetic_name, index=False)
    structural_aug.to_csv(out_dir / structural_aug_name, index=False)
    aero_aug.to_csv(out_dir / aero_aug_name, index=False)

    print("Synthetic data generation complete.")
    print(f"Mode           : {args.mode}")
    print(f"Noise scale    : {args.noise_scale if args.mode == 'noisy' else 'n/a'}")
    print(f"Synthetic rows : {len(synthetic_df)}")
    print(f"Structural aug : {len(structural_aug)} rows")
    print(f"Aerodynamic aug: {len(aero_aug)} rows")
    print(f"Output dir     : {out_dir}")


if __name__ == "__main__":
    main()
