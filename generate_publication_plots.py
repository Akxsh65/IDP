from __future__ import annotations

from pathlib import Path

import joblib
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.patches import FancyBboxPatch

from data_loaders import load_cfd_dataset, load_structure_samples
from surrogate_chain import InverseSearchConfig, SurrogateChain, default_chain

# Publication style
plt.rcParams.update(
    {
        "font.family": "serif",
        "font.serif": ["Times New Roman", "DejaVu Serif"],
        "font.size": 10,
        "axes.labelsize": 11,
        "axes.titlesize": 11,
        "legend.fontsize": 9,
        "xtick.labelsize": 9,
        "ytick.labelsize": 9,
        "figure.dpi": 150,
        "savefig.dpi": 300,
        "savefig.bbox": "tight",
        "axes.grid": True,
        "grid.alpha": 0.25,
        "lines.linewidth": 1.5,
    }
)

COLORS = {
    "actual": "#2166AC",
    "pred": "#D6604D",
    "linear": "#4DAC26",
    "mlp": "#762A83",
    "grid": "#878787",
}


def _save(fig: plt.Figure, out_dir: Path, name: str) -> None:
    fig.savefig(out_dir / f"{name}.png")
    fig.savefig(out_dir / f"{name}.pdf")
    plt.close(fig)


def _parity_ax(ax, actual, predicted, xlabel, ylabel, color):
    ax.scatter(actual, predicted, s=22, alpha=0.75, color=color, edgecolors="white", linewidths=0.3)
    lo = min(actual.min(), predicted.min())
    hi = max(actual.max(), predicted.max())
    pad = 0.04 * (hi - lo if hi != lo else 1.0)
    lo -= pad
    hi += pad
    ax.plot([lo, hi], [lo, hi], "k--", linewidth=1.0, label="Ideal")
    ax.set_xlim(lo, hi)
    ax.set_ylim(lo, hi)
    ax.set_xlabel(xlabel)
    ax.set_ylabel(ylabel)
    ax.set_aspect("equal", adjustable="box")
    ax.legend(loc="upper left", frameon=True)


def figure_pipeline_schematic(out_dir: Path) -> None:
    box_w = 1.45
    box_h = 1.0
    y = 1.05
    gap = 0.55
    x_start = 0.35
    labels = [
        "MFC Voltages\n$V_{lower}$, $V_{upper}$",
        "Structural\nSurrogate",
        "Deflection\n$\\delta_{TE}$",
        "Aerodynamic\nSurrogate",
        "$C_L$, $C_D$",
    ]
    xs = [x_start + i * (box_w + gap) for i in range(len(labels))]

    fig_w = xs[-1] + box_w + 0.6
    fig, ax = plt.subplots(figsize=(fig_w, 2.9))
    ax.set_xlim(0, fig_w)
    ax.set_ylim(0, 3.2)
    ax.axis("off")

    for x, text in zip(xs, labels):
        patch = FancyBboxPatch(
            (x, y),
            box_w,
            box_h,
            boxstyle="round,pad=0.04,rounding_size=0.08",
            linewidth=1.0,
            edgecolor="#333333",
            facecolor="#F2F2F2",
        )
        ax.add_patch(patch)
        ax.text(x + box_w / 2, y + box_h / 2, text, ha="center", va="center", fontsize=9)

    arrow_y = y + box_h / 2
    for i in range(len(xs) - 1):
        ax.annotate(
            "",
            xy=(xs[i + 1], arrow_y),
            xytext=(xs[i] + box_w, arrow_y),
            arrowprops=dict(arrowstyle="->", lw=1.2, color="#333333"),
        )

    aero_x = xs[3] + box_w / 2
    ax.text(aero_x, 0.35, "Pitch angle $\\alpha$", ha="center", fontsize=9)
    ax.annotate(
        "",
        xy=(aero_x, y),
        xytext=(aero_x, 0.55),
        arrowprops=dict(arrowstyle="->", lw=1.0, color="#333333"),
    )

    ax.set_title("Surrogate modelling pipeline for piezoelectric morphing wing", pad=10)
    fig.subplots_adjust(left=0.02, right=0.98, top=0.82, bottom=0.08)
    _save(fig, out_dir, "fig01_pipeline_schematic")


def figure_structural_parity(struct_df, model, out_dir: Path) -> None:
    x = struct_df[["lower_mfc_v", "upper_mfc_v"]]
    y_true = struct_df["deflection_mm"].values
    y_pred = model.predict(x)

    fig, axes = plt.subplots(1, 2, figsize=(7.0, 3.2))

    _parity_ax(
        axes[0],
        y_true,
        y_pred,
        "ANSYS deflection (mm)",
        "Predicted deflection (mm)",
        COLORS["pred"],
    )
    axes[0].set_title("(a) Parity plot")

    residuals = y_pred - y_true
    axes[1].hist(residuals, bins=20, color=COLORS["actual"], alpha=0.85, edgecolor="white")
    axes[1].axvline(0.0, color="k", linestyle="--", linewidth=1.0)
    axes[1].set_xlabel("Residual (mm)")
    axes[1].set_ylabel("Count")
    axes[1].set_title("(b) Residual distribution")

    fig.suptitle("Structural surrogate validation", y=1.02, fontsize=12)
    _save(fig, out_dir, "fig02_structural_validation")


def figure_deflection_response(struct_df, model, out_dir: Path) -> None:
    fig, ax = plt.subplots(figsize=(3.5, 3.0))
    upper_grid = np.arange(50, 1501, 50, dtype=float)
    for lower_v, style in [(-50, "-"), (-100, "--"), (-200, "-."), (-300, ":")]:
        preds = []
        for upper_v in upper_grid:
            feat = pd.DataFrame([{"lower_mfc_v": lower_v, "upper_mfc_v": upper_v}])
            preds.append(float(model.predict(feat)[0]))
        ax.plot(upper_grid, preds, linestyle=style, label=f"$V_{{lower}}$ = {int(lower_v)} V")

    subset = struct_df[struct_df["lower_mfc_v"].isin([-50, -100, -200, -300])]
    ax.scatter(
        subset["upper_mfc_v"],
        subset["deflection_mm"],
        s=18,
        color=COLORS["actual"],
        alpha=0.6,
        label="ANSYS samples",
        zorder=3,
    )
    ax.set_xlabel("Upper MFC voltage (V)")
    ax.set_ylabel("Trailing-edge deflection (mm)")
    ax.set_title("Deflection response surface")
    ax.legend(frameon=True, fontsize=8)
    _save(fig, out_dir, "fig03_deflection_response")


def figure_aerodynamic_parity(cfd_df, model, out_dir: Path, tag: str, title: str) -> None:
    x = cfd_df[["deflection_mm", "pitch_deg"]]
    y_true = cfd_df[["cl", "cd"]].values
    y_pred = model.predict(x)

    fig, axes = plt.subplots(1, 2, figsize=(7.0, 3.2))
    _parity_ax(axes[0], y_true[:, 0], y_pred[:, 0], "CFD $C_L$", "Predicted $C_L$", COLORS["pred"])
    axes[0].set_title("(a) Lift coefficient")
    _parity_ax(axes[1], y_true[:, 1], y_pred[:, 1], "CFD $C_D$", "Predicted $C_D$", COLORS["mlp"])
    axes[1].set_title("(b) Drag coefficient")
    fig.suptitle(title, y=1.02, fontsize=12)
    _save(fig, out_dir, tag)


def figure_chain_comparison(cfd_df, old_chain, new_chain, out_dir: Path) -> None:
    rows = []
    for _, r in cfd_df.iterrows():
        o = old_chain.predict(r.lower_mfc_v, r.upper_mfc_v, r.pitch_deg)
        n = new_chain.predict(r.lower_mfc_v, r.upper_mfc_v, r.pitch_deg)
        rows.append(
            {
                "cl_true": r.cl,
                "cd_true": r.cd,
                "cl_old": o.cl,
                "cd_old": o.cd,
                "cl_new": n.cl,
                "cd_new": n.cd,
            }
        )
    df = pd.DataFrame(rows)

    fig, axes = plt.subplots(2, 2, figsize=(7.0, 6.0))
    _parity_ax(axes[0, 0], df.cl_true, df.cl_old, "CFD $C_L$", "Chained $C_L$", COLORS["linear"])
    axes[0, 0].set_title("(a) Linear aero — $C_L$")
    _parity_ax(axes[0, 1], df.cd_true, df.cd_old, "CFD $C_D$", "Chained $C_D$", COLORS["linear"])
    axes[0, 1].set_title("(b) Linear aero — $C_D$")
    _parity_ax(axes[1, 0], df.cl_true, df.cl_new, "CFD $C_L$", "Chained $C_L$", COLORS["mlp"])
    axes[1, 0].set_title("(c) MLP aero — $C_L$")
    _parity_ax(axes[1, 1], df.cd_true, df.cd_new, "CFD $C_D$", "Chained $C_D$", COLORS["mlp"])
    axes[1, 1].set_title("(d) MLP aero — $C_D$")
    fig.suptitle("Full-chain validation against CFD (n = 201)", y=1.01, fontsize=12)
    fig.tight_layout()
    _save(fig, out_dir, "fig05_chain_comparison")


def figure_model_metrics_bar(out_dir: Path) -> None:
    metrics = pd.read_csv(out_dir.parent / "outputs_augmented_models" / "retrain_summary.csv")
    mlp = metrics[metrics["model"] == "mlp_regressor"]
    cl_mae = mlp[mlp["task"] == "aerodynamic_cl"]["mae"].iloc[0]
    cd_mae = mlp[mlp["task"] == "aerodynamic_cd"]["mae"].iloc[0]
    cl_r2 = mlp[mlp["task"] == "aerodynamic_cl"]["r2"].iloc[0]
    cd_r2 = mlp[mlp["task"] == "aerodynamic_cd"]["r2"].iloc[0]

    struct = pd.read_csv(out_dir.parent / "outputs_structural_surrogates" / "metrics.csv")
    struct_mae = struct.loc[struct["model"] == "linear_regression", "mae_mm"].iloc[0]
    struct_r2 = struct.loc[struct["model"] == "linear_regression", "r2"].iloc[0]

    fig, axes = plt.subplots(1, 2, figsize=(7.0, 3.0))
    labels = ["Structural\n(deflection)", "Aero $C_L$", "Aero $C_D$"]
    maes = [struct_mae, cl_mae, cd_mae]
    axes[0].bar(labels, maes, color=[COLORS["linear"], COLORS["mlp"], COLORS["pred"]], alpha=0.9)
    axes[0].set_ylabel("MAE")
    axes[0].set_title("(a) Mean absolute error")

    r2s = [struct_r2, cl_r2, cd_r2]
    axes[1].bar(labels, r2s, color=[COLORS["linear"], COLORS["mlp"], COLORS["pred"]], alpha=0.9)
    axes[1].set_ylim(0.8, 1.001)
    axes[1].set_ylabel("$R^2$")
    axes[1].set_title("(b) Coefficient of determination")
    fig.suptitle("Selected surrogate performance on real validation data", y=1.02)
    _save(fig, out_dir, "fig06_model_metrics")


def figure_cl_vs_pitch(cfd_df, chain, out_dir: Path) -> None:
    fig, ax = plt.subplots(figsize=(3.5, 3.0))
    cases = [(-50, 50), (-50, 750), (-50, 1500), (-500, 1500)]
    pitch = np.sort(cfd_df["pitch_deg"].unique())

    for lower_v, upper_v in cases:
        sub = cfd_df[(cfd_df.lower_mfc_v == lower_v) & (cfd_df.upper_mfc_v == upper_v)]
        if sub.empty:
            continue
        ax.plot(
            sub["pitch_deg"],
            sub["cl"],
            "o-",
            markersize=4,
            label=f"CFD: {int(lower_v)}/{int(upper_v)} V",
        )
        preds = [chain.predict(lower_v, upper_v, p).cl for p in sub["pitch_deg"]]
        ax.plot(sub["pitch_deg"], preds, "--", linewidth=1.2)

    ax.set_xlabel("Pitch angle (deg)")
    ax.set_ylabel("Lift coefficient $C_L$")
    ax.set_title("$C_L$ vs pitch for selected voltage cases")
    ax.legend(fontsize=7, frameon=True)
    _save(fig, out_dir, "fig07_cl_vs_pitch")


def figure_error_vs_pitch(cfd_df, chain, out_dir: Path) -> None:
    cl_err = []
    cd_err = []
    pitch_vals = []
    for _, r in cfd_df.iterrows():
        p = chain.predict(r.lower_mfc_v, r.upper_mfc_v, r.pitch_deg)
        cl_err.append(abs(r.cl - p.cl))
        cd_err.append(abs(r.cd - p.cd))
        pitch_vals.append(r.pitch_deg)

    err_df = pd.DataFrame({"pitch_deg": pitch_vals, "cl_err": cl_err, "cd_err": cd_err})
    grouped = err_df.groupby("pitch_deg").mean().reset_index()

    fig, ax = plt.subplots(figsize=(3.5, 3.0))
    ax.plot(grouped["pitch_deg"], grouped["cl_err"], "o-", color=COLORS["mlp"], label="$C_L$ error")
    ax.plot(grouped["pitch_deg"], grouped["cd_err"], "s--", color=COLORS["pred"], label="$C_D$ error")
    ax.set_xlabel("Pitch angle (deg)")
    ax.set_ylabel("Mean absolute error")
    ax.set_title("Chained model error vs pitch angle")
    ax.legend(frameon=True)
    _save(fig, out_dir, "fig08_error_vs_pitch")


def figure_inverse_illustration(chain, out_dir: Path) -> None:
    target_cls = [0.08, 0.12, 0.16, 0.20]
    pitch = 8.0
    lowers = []
    uppers = []
    achieved = []

    for tcl in target_cls:
        rec = chain.recommend_voltages(
            InverseSearchConfig(target_cl=tcl, pitch_deg=pitch, top_k=1, refine=True)
        )
        if rec.empty:
            continue
        row = rec.iloc[0]
        lowers.append(row.lower_mfc_v)
        uppers.append(row.upper_mfc_v)
        achieved.append(row.predicted_cl)

    fig, axes = plt.subplots(1, 2, figsize=(7.0, 3.0))
    axes[0].bar(
        [f"{t:.2f}" for t in target_cls],
        achieved,
        color=COLORS["actual"],
        alpha=0.85,
        label="Achieved $C_L$",
    )
    axes[0].plot([f"{t:.2f}" for t in target_cls], target_cls, "r--", label="Target $C_L$")
    axes[0].set_xlabel("Target $C_L$")
    axes[0].set_ylabel("Predicted $C_L$")
    axes[0].set_title(f"(a) Inverse control at pitch = {pitch:.0f}°")
    axes[0].legend(frameon=True, fontsize=8)

    axes[1].scatter(lowers, uppers, s=60, c=target_cls, cmap="viridis", edgecolors="k", linewidths=0.4)
    for lv, uv, tcl in zip(lowers, uppers, target_cls):
        axes[1].annotate(f"{tcl:.2f}", (lv, uv), textcoords="offset points", xytext=(4, 4), fontsize=8)
    axes[1].set_xlabel("Lower MFC voltage (V)")
    axes[1].set_ylabel("Upper MFC voltage (V)")
    axes[1].set_title("(b) Recommended voltage pairs")
    fig.suptitle("Inverse voltage search illustration", y=1.02)
    _save(fig, out_dir, "fig09_inverse_control")


def figure_data_coverage(struct_df, cfd_df, out_dir: Path) -> None:
    fig, axes = plt.subplots(1, 2, figsize=(8.8, 3.4))
    fig.subplots_adjust(wspace=0.55, top=0.84, bottom=0.14)

    sc0 = axes[0].scatter(
        struct_df["upper_mfc_v"],
        struct_df["lower_mfc_v"],
        s=18,
        alpha=0.75,
        c=struct_df["deflection_mm"],
        cmap="coolwarm",
    )
    cb0 = fig.colorbar(sc0, ax=axes[0], fraction=0.05, pad=0.06)
    cb0.set_label("Deflection (mm)")
    axes[0].set_xlabel("Upper MFC voltage (V)")
    axes[0].set_ylabel("Lower MFC voltage (V)")
    axes[0].set_title("(a) Structural dataset coverage")

    sc1 = axes[1].scatter(
        cfd_df["pitch_deg"],
        cfd_df["deflection_mm"],
        s=18,
        alpha=0.75,
        c=cfd_df["cl"],
        cmap="viridis",
    )
    cb1 = fig.colorbar(sc1, ax=axes[1], fraction=0.05, pad=0.06)
    cb1.set_label("$C_L$")
    axes[1].set_xlabel("Pitch angle (deg)")
    axes[1].set_ylabel("Deflection (mm)")
    axes[1].set_title("(b) CFD dataset coverage")
    fig.suptitle("Experimental design coverage", y=0.98)
    _save(fig, out_dir, "fig10_data_coverage")


def main() -> None:
    project_dir = Path(__file__).resolve().parent
    out_dir = project_dir / "outputs_publication_figures"
    out_dir.mkdir(exist_ok=True)

    struct_df = load_structure_samples(project_dir / "Structure samples.xlsx")
    cfd_df = load_cfd_dataset(project_dir / "C_L C_D Values - Sheet1.csv")

    struct_model = joblib.load(
        project_dir / "outputs_structural_surrogates" / "linear_regression.joblib"
    )
    aero_linear = joblib.load(
        project_dir
        / "outputs_augmented_models"
        / "retrained_strict"
        / "aerodynamic_linear_regression.joblib"
    )
    aero_mlp = joblib.load(
        project_dir
        / "outputs_augmented_models"
        / "retrained_strict"
        / "aerodynamic_mlp_regressor.joblib"
    )

    old_chain = SurrogateChain(
        project_dir / "outputs_structural_surrogates" / "linear_regression.joblib",
        project_dir
        / "outputs_aerodynamic_surrogates"
        / "shape_and_pitch_linear_regression.joblib",
    )
    new_chain = default_chain(project_dir)

    figure_pipeline_schematic(out_dir)
    figure_structural_parity(struct_df, struct_model, out_dir)
    figure_deflection_response(struct_df, struct_model, out_dir)
    figure_aerodynamic_parity(
        cfd_df,
        aero_linear,
        out_dir,
        "fig04a_aerodynamic_linear",
        "Aerodynamic surrogate — linear regression",
    )
    figure_aerodynamic_parity(
        cfd_df,
        aero_mlp,
        out_dir,
        "fig04b_aerodynamic_mlp",
        "Aerodynamic surrogate — MLP (retrained)",
    )
    figure_chain_comparison(cfd_df, old_chain, new_chain, out_dir)
    figure_model_metrics_bar(out_dir)
    figure_cl_vs_pitch(cfd_df, new_chain, out_dir)
    figure_error_vs_pitch(cfd_df, new_chain, out_dir)
    figure_inverse_illustration(new_chain, out_dir)
    figure_data_coverage(struct_df, cfd_df, out_dir)

    manifest = sorted(p.name for p in out_dir.glob("fig*.png"))
    with (out_dir / "figure_manifest.txt").open("w", encoding="utf-8") as f:
        f.write("Publication figures (PNG + PDF)\n")
        f.write("=" * 40 + "\n")
        for name in manifest:
            f.write(f"{name}\n")

    print("Publication figures generated.")
    print(f"Output directory: {out_dir}")
    print(f"Total figures: {len(manifest)}")
    for name in manifest:
        print(f"  - {name}")


if __name__ == "__main__":
    main()
