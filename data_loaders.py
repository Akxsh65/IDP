from __future__ import annotations

from pathlib import Path

import pandas as pd


def load_structure_samples(excel_path: Path | str) -> pd.DataFrame:
    """Load and normalize the 4-block worksheet into one clean table."""
    raw_df = pd.read_excel(excel_path)
    blocks = []

    for block_idx in range(4):
        block = pd.DataFrame(
            {
                "lower_mfc_v": pd.to_numeric(
                    raw_df.iloc[:, block_idx * 4], errors="coerce"
                ),
                "upper_mfc_v": pd.to_numeric(
                    raw_df.iloc[:, block_idx * 4 + 1], errors="coerce"
                ),
                "deflection_mm": pd.to_numeric(
                    raw_df.iloc[:, block_idx * 4 + 2], errors="coerce"
                ),
            }
        )
        block = block.dropna(subset=["lower_mfc_v", "upper_mfc_v", "deflection_mm"])
        blocks.append(block)

    df = pd.concat(blocks, ignore_index=True)
    return df.sort_values(["lower_mfc_v", "upper_mfc_v"]).reset_index(drop=True)


def load_cfd_dataset(csv_path: Path | str) -> pd.DataFrame:
    """Parse the hierarchical CFD CSV into a flat training table."""
    raw = pd.read_csv(csv_path)
    records: list[dict] = []
    current: dict[str, float] = {}

    for _, row in raw.iterrows():
        lower = row.iloc[0]
        upper = row.iloc[1]
        deflection = row.iloc[2]
        pitch = row.iloc[3]
        cl = row.iloc[5]
        cd = row.iloc[6]

        if pd.notna(lower) and str(lower).strip() != "":
            current = {
                "lower_mfc_v": float(lower),
                "upper_mfc_v": float(upper),
                "deflection_mm": float(deflection),
            }

        if (
            pd.notna(pitch)
            and str(pitch).strip() != ""
            and pd.notna(cl)
            and str(cl).strip() != ""
            and pd.notna(cd)
            and str(cd).strip() != ""
        ):
            record = current.copy()
            record.update(
                {
                    "pitch_deg": float(pitch),
                    "cl": float(cl),
                    "cd": float(cd),
                }
            )
            records.append(record)

    df = pd.DataFrame(records)
    return df.sort_values(
        ["lower_mfc_v", "upper_mfc_v", "pitch_deg"]
    ).reset_index(drop=True)
