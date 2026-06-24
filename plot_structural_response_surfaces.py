from __future__ import annotations

from pathlib import Path

import joblib
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd


def main() -> None:
    project_dir = Path(__file__).resolve().parent
    out_dir = project_dir / "outputs_structural_surrogates"
    out_dir.mkdir(exist_ok=True)

    model_path = out_dir / "linear_regression.joblib"
    if not model_path.exists():
        raise FileNotFoundError(
            "Linear model not found. Run train_structural_surrogates.py first."
        )

    model = joblib.load(model_path)

    upper_vals = np.arange(50, 1501, 50, dtype=float)
    lower_vals = np.arange(-500, -49, 50, dtype=float)
    upper_grid, lower_grid = np.meshgrid(upper_vals, lower_vals)

    grid_df = pd.DataFrame(
        {
            "lower_mfc_v": lower_grid.ravel(),
            "upper_mfc_v": upper_grid.ravel(),
        }
    )
    pred = model.predict(grid_df).reshape(lower_grid.shape)

    # 2D family of curves (deflection vs upper voltage at each lower voltage).
    plt.figure(figsize=(8, 6))
    for idx, lower_v in enumerate(lower_vals):
        plt.plot(
            upper_vals,
            pred[idx, :],
            label=f"Lower={int(lower_v)} V",
            linewidth=1.5,
        )
    plt.xlabel("Upper MFC voltage (V)")
    plt.ylabel("Predicted deflection (mm)")
    plt.title("Structural surrogate: 2D response curves")
    plt.grid(alpha=0.25)
    plt.legend(ncol=2, fontsize=8)
    plt.tight_layout()
    plt.savefig(out_dir / "response_curves_2d.png", dpi=220)
    plt.close()

    # 3D response surface.
    fig = plt.figure(figsize=(9, 6.5))
    ax = fig.add_subplot(111, projection="3d")
    surf = ax.plot_surface(
        upper_grid,
        lower_grid,
        pred,
        cmap="viridis",
        edgecolor="none",
        alpha=0.95,
    )
    ax.set_xlabel("Upper MFC voltage (V)")
    ax.set_ylabel("Lower MFC voltage (V)")
    ax.set_zlabel("Predicted deflection (mm)")
    ax.set_title("Structural surrogate: 3D response surface")
    fig.colorbar(surf, shrink=0.6, pad=0.1, label="Deflection (mm)")
    plt.tight_layout()
    plt.savefig(out_dir / "response_surface_3d.png", dpi=220)
    plt.close()

    # Heatmap view for quick lookup.
    plt.figure(figsize=(8, 6))
    heat = plt.contourf(upper_grid, lower_grid, pred, levels=20, cmap="coolwarm")
    plt.xlabel("Upper MFC voltage (V)")
    plt.ylabel("Lower MFC voltage (V)")
    plt.title("Structural surrogate: deflection heatmap")
    cbar = plt.colorbar(heat)
    cbar.set_label("Predicted deflection (mm)")
    plt.tight_layout()
    plt.savefig(out_dir / "response_heatmap.png", dpi=220)
    plt.close()

    print("Plots created:")
    print(f"  {out_dir / 'response_curves_2d.png'}")
    print(f"  {out_dir / 'response_surface_3d.png'}")
    print(f"  {out_dir / 'response_heatmap.png'}")


if __name__ == "__main__":
    main()
