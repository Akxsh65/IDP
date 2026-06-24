from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

from surrogate_chain import InverseSearchConfig, default_chain


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Recommend MFC voltages for a target lift coefficient at a pitch angle. "
            "Uses grid search + optional continuous refinement and CD constraint."
        )
    )
    parser.add_argument(
        "--target-cl",
        type=float,
        required=True,
        help="Desired lift coefficient (example: 0.15).",
    )
    parser.add_argument(
        "--pitch-deg",
        type=float,
        required=True,
        help="Pitch / angle of attack in degrees (example: 8).",
    )
    parser.add_argument(
        "--max-cd",
        type=float,
        default=None,
        help="Optional maximum allowed drag coefficient (example: 0.05).",
    )
    parser.add_argument(
        "--top-k",
        type=int,
        default=5,
        help="Number of recommendations to return.",
    )
    parser.add_argument(
        "--no-refine",
        action="store_true",
        help="Disable continuous refinement after grid search.",
    )
    parser.add_argument(
        "--refine-seeds",
        type=int,
        default=5,
        help="Number of top grid points used as refinement seeds.",
    )
    parser.add_argument(
        "--quantize-step",
        type=float,
        default=None,
        help="Round refined voltages to this step (example: 1 or 50).",
    )
    parser.add_argument(
        "--augmentation",
        choices=["strict", "noisy"],
        default="strict",
        help="Which retrained aerodynamic model set to use (default: strict).",
    )
    parser.add_argument(
        "--aerodynamic-model",
        choices=["mlp_regressor", "linear_regression"],
        default="mlp_regressor",
        help="Aerodynamic surrogate variant (default: mlp_regressor).",
    )
    parser.add_argument(
        "--save-csv",
        type=str,
        default=None,
        help="Optional path to save recommendations as CSV.",
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()
    project_dir = Path(__file__).resolve().parent
    chain = default_chain(
        project_dir,
        augmentation=args.augmentation,
        aerodynamic_model=args.aerodynamic_model,
    )

    config = InverseSearchConfig(
        target_cl=args.target_cl,
        pitch_deg=args.pitch_deg,
        max_cd=args.max_cd,
        top_k=args.top_k,
        refine=not args.no_refine,
        refine_seeds=args.refine_seeds,
        quantize_step=args.quantize_step,
    )
    recommendations = chain.recommend_voltages(config)

    print("Voltage recommendation search complete:")
    print(f"  Aero model      : retrained_{args.augmentation}/aerodynamic_{args.aerodynamic_model}")
    print(f"  Target CL       : {args.target_cl}")
    print(f"  Pitch (deg)     : {args.pitch_deg}")
    print(f"  Max CD          : {args.max_cd if args.max_cd is not None else 'not set'}")
    print(f"  Refinement      : {'enabled' if config.refine else 'disabled'}")
    print(f"  Search grid     : lower -500..-50 step 50, upper 50..1500 step 50")
    print()

    display_cols = [
        "method",
        "lower_mfc_v",
        "upper_mfc_v",
        "predicted_cl",
        "predicted_cd",
        "cl_error",
        "cd_violation",
        "satisfies_cd_constraint",
        "predicted_lift_to_drag",
    ]
    print(
        recommendations[display_cols].to_string(
            index=False, float_format=lambda x: f"{x:.6f}"
        )
    )

    if args.max_cd is not None and not recommendations["satisfies_cd_constraint"].any():
        print()
        print(
            "Warning: no candidate fully satisfies max CD. "
            "Showing closest CL matches with smallest CD violation."
        )

    if args.save_csv:
        out_path = (project_dir / args.save_csv).resolve()
        out_path.parent.mkdir(parents=True, exist_ok=True)
        recommendations.to_csv(out_path, index=False)
        print(f"\nSaved recommendations to: {out_path}")


if __name__ == "__main__":
    main()
