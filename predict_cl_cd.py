from __future__ import annotations

import argparse
from pathlib import Path

from surrogate_chain import default_chain


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Predict CL/CD using chained structural + aerodynamic surrogates."
    )
    parser.add_argument("--upper-v", type=float, required=True)
    parser.add_argument("--lower-v", type=float, required=True)
    parser.add_argument("--pitch-deg", type=float, required=True)
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
    return parser


def main() -> None:
    args = build_parser().parse_args()
    chain = default_chain(
        Path(__file__).resolve().parent,
        augmentation=args.augmentation,
        aerodynamic_model=args.aerodynamic_model,
    )
    result = chain.predict(args.lower_v, args.upper_v, args.pitch_deg)

    print("Chained prediction complete:")
    print(f"  Aero model      : retrained_{args.augmentation}/aerodynamic_{args.aerodynamic_model}")
    print(f"  Upper MFC (V)   : {result.upper_mfc_v}")
    print(f"  Lower MFC (V)   : {result.lower_mfc_v}")
    print(f"  Pitch (deg)     : {result.pitch_deg}")
    print(f"  Deflection (mm) : {result.deflection_mm:.6f}")
    print(f"  CL              : {result.cl:.6f}")
    print(f"  CD              : {result.cd:.6f}")
    print(f"  CL/CD           : {result.lift_to_drag:.6f}")


if __name__ == "__main__":
    main()
