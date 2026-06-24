from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

from surrogate_chain import InverseSearchConfig, default_chain


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run end-to-end inverse voltage search demo with both features."
    )
    parser.add_argument("--target-cl", type=float, default=0.15)
    parser.add_argument("--pitch-deg", type=float, default=8.0)
    parser.add_argument("--max-cd", type=float, default=0.05)
    parser.add_argument("--top-k", type=int, default=5)
    return parser


def run_case(
    chain,
    label: str,
    config: InverseSearchConfig,
) -> pd.DataFrame:
    result = chain.recommend_voltages(config)
    result.insert(0, "case", label)
    return result


def main() -> None:
    args = build_parser().parse_args()
    project_dir = Path(__file__).resolve().parent
    out_dir = project_dir / "outputs_inverse_search"
    out_dir.mkdir(exist_ok=True)

    chain = default_chain(project_dir)
    cases = [
        (
            "grid_only",
            InverseSearchConfig(
                target_cl=args.target_cl,
                pitch_deg=args.pitch_deg,
                top_k=args.top_k,
                refine=False,
            ),
        ),
        (
            "grid_plus_refine",
            InverseSearchConfig(
                target_cl=args.target_cl,
                pitch_deg=args.pitch_deg,
                top_k=args.top_k,
                refine=True,
                refine_seeds=5,
            ),
        ),
        (
            "grid_refine_max_cd",
            InverseSearchConfig(
                target_cl=args.target_cl,
                pitch_deg=args.pitch_deg,
                top_k=args.top_k,
                refine=True,
                refine_seeds=5,
                max_cd=args.max_cd,
            ),
        ),
    ]

    all_results = [run_case(chain, label, cfg) for label, cfg in cases]
    combined = pd.concat(all_results, ignore_index=True)
    out_path = out_dir / "inverse_search_demo.csv"
    combined.to_csv(out_path, index=False)

    print("End-to-end inverse search demo complete.")
    print(f"Saved: {out_path}")
    print()
    for label, _ in cases:
        subset = combined[combined["case"] == label].head(3)
        print(f"=== {label} (top 3) ===")
        print(
            subset[
                [
                    "method",
                    "lower_mfc_v",
                    "upper_mfc_v",
                    "predicted_cl",
                    "predicted_cd",
                    "cl_error",
                    "satisfies_cd_constraint",
                ]
            ].to_string(index=False, float_format=lambda x: f"{x:.6f}")
        )
        print()


if __name__ == "__main__":
    main()
