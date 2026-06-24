from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from scipy.optimize import minimize

LOWER_V_MIN = -500.0
LOWER_V_MAX = -50.0
UPPER_V_MIN = 50.0
UPPER_V_MAX = 1500.0


@dataclass(frozen=True)
class ChainPrediction:
    lower_mfc_v: float
    upper_mfc_v: float
    pitch_deg: float
    deflection_mm: float
    cl: float
    cd: float
    lift_to_drag: float


@dataclass(frozen=True)
class InverseSearchConfig:
    target_cl: float
    pitch_deg: float
    max_cd: float | None = None
    top_k: int = 5
    refine: bool = True
    refine_seeds: int = 5
    quantize_step: float | None = None
    lower_values: np.ndarray | None = None
    upper_values: np.ndarray | None = None


class SurrogateChain:
    """Two-stage forward model: voltages -> deflection -> CL/CD."""

    def __init__(
        self,
        structural_model_path: Path,
        aerodynamic_model_path: Path,
    ) -> None:
        self.structural_model = joblib.load(structural_model_path)
        self.aerodynamic_model = joblib.load(aerodynamic_model_path)

    def predict_deflection(self, lower_mfc_v: float, upper_mfc_v: float) -> float:
        features = pd.DataFrame(
            [{"lower_mfc_v": lower_mfc_v, "upper_mfc_v": upper_mfc_v}]
        )
        return float(self.structural_model.predict(features)[0])

    def predict_aerodynamics(
        self, deflection_mm: float, pitch_deg: float
    ) -> tuple[float, float]:
        features = pd.DataFrame(
            [{"deflection_mm": deflection_mm, "pitch_deg": pitch_deg}]
        )
        cl, cd = self.aerodynamic_model.predict(features)[0]
        return float(cl), float(cd)

    def predict(
        self, lower_mfc_v: float, upper_mfc_v: float, pitch_deg: float
    ) -> ChainPrediction:
        deflection_mm = self.predict_deflection(lower_mfc_v, upper_mfc_v)
        cl, cd = self.predict_aerodynamics(deflection_mm, pitch_deg)
        lift_to_drag = cl / cd if cd != 0 else float("inf")
        return ChainPrediction(
            lower_mfc_v=lower_mfc_v,
            upper_mfc_v=upper_mfc_v,
            pitch_deg=pitch_deg,
            deflection_mm=deflection_mm,
            cl=cl,
            cd=cd,
            lift_to_drag=lift_to_drag,
        )

    def _quantize_voltage(
        self, value: float, step: float | None, vmin: float, vmax: float
    ) -> float:
        if step is None or step <= 0:
            return float(np.clip(value, vmin, vmax))
        quantized = np.round(value / step) * step
        return float(np.clip(quantized, vmin, vmax))

    def _prediction_row(
        self,
        result: ChainPrediction,
        target_cl: float,
        max_cd: float | None,
        method: str,
    ) -> dict:
        cl_error = abs(result.cl - target_cl)
        cd_violation = max(0.0, result.cd - max_cd) if max_cd is not None else 0.0
        satisfies_cd = cd_violation == 0.0
        voltage_magnitude = abs(result.lower_mfc_v) + abs(result.upper_mfc_v)
        return {
            "lower_mfc_v": result.lower_mfc_v,
            "upper_mfc_v": result.upper_mfc_v,
            "pitch_deg": result.pitch_deg,
            "deflection_mm": result.deflection_mm,
            "predicted_cl": result.cl,
            "predicted_cd": result.cd,
            "predicted_lift_to_drag": result.lift_to_drag,
            "cl_error": cl_error,
            "cd_violation": cd_violation,
            "satisfies_cd_constraint": satisfies_cd,
            "voltage_magnitude": voltage_magnitude,
            "method": method,
        }

    def _rank_dataframe(self, df: pd.DataFrame) -> pd.DataFrame:
        return df.sort_values(
            ["cl_error", "cd_violation", "predicted_cd", "voltage_magnitude"],
            ascending=[True, True, True, True],
        ).reset_index(drop=True)

    def _grid_search(self, config: InverseSearchConfig) -> pd.DataFrame:
        lower_values = (
            config.lower_values
            if config.lower_values is not None
            else np.arange(LOWER_V_MIN, LOWER_V_MAX + 1, 50, dtype=float)
        )
        upper_values = (
            config.upper_values
            if config.upper_values is not None
            else np.arange(UPPER_V_MIN, UPPER_V_MAX + 1, 50, dtype=float)
        )

        rows: list[dict] = []
        for lower_v in lower_values:
            for upper_v in upper_values:
                result = self.predict(lower_v, upper_v, config.pitch_deg)
                rows.append(
                    self._prediction_row(
                        result,
                        config.target_cl,
                        config.max_cd,
                        method="grid_search",
                    )
                )
        return self._rank_dataframe(pd.DataFrame(rows))

    def _optimization_objective(
        self,
        voltages: np.ndarray,
        target_cl: float,
        pitch_deg: float,
        max_cd: float | None,
    ) -> float:
        lower_v = float(voltages[0])
        upper_v = float(voltages[1])
        result = self.predict(lower_v, upper_v, pitch_deg)
        loss = (result.cl - target_cl) ** 2
        if max_cd is not None and result.cd > max_cd:
            loss += 100.0 * (result.cd - max_cd) ** 2
        return loss

    def _refine_from_seed(
        self,
        lower_seed: float,
        upper_seed: float,
        config: InverseSearchConfig,
    ) -> dict | None:
        bounds = [(LOWER_V_MIN, LOWER_V_MAX), (UPPER_V_MIN, UPPER_V_MAX)]
        x0 = np.array([lower_seed, upper_seed], dtype=float)
        opt = minimize(
            self._optimization_objective,
            x0,
            args=(config.target_cl, config.pitch_deg, config.max_cd),
            method="L-BFGS-B",
            bounds=bounds,
        )
        if not opt.success and opt.fun > self._optimization_objective(x0, *(
            config.target_cl,
            config.pitch_deg,
            config.max_cd,
        )):
            return None

        lower_v = self._quantize_voltage(
            float(opt.x[0]), config.quantize_step, LOWER_V_MIN, LOWER_V_MAX
        )
        upper_v = self._quantize_voltage(
            float(opt.x[1]), config.quantize_step, UPPER_V_MIN, UPPER_V_MAX
        )

        result = self.predict(lower_v, upper_v, config.pitch_deg)
        return self._prediction_row(
            result,
            config.target_cl,
            config.max_cd,
            method="continuous_refine",
        )

    def search_voltages_for_target_cl(
        self,
        target_cl: float,
        pitch_deg: float,
        lower_values: np.ndarray | None = None,
        upper_values: np.ndarray | None = None,
        top_k: int = 5,
        max_cd: float | None = None,
        refine: bool = True,
        refine_seeds: int = 5,
        quantize_step: float | None = None,
    ) -> pd.DataFrame:
        config = InverseSearchConfig(
            target_cl=target_cl,
            pitch_deg=pitch_deg,
            max_cd=max_cd,
            top_k=top_k,
            refine=refine,
            refine_seeds=refine_seeds,
            quantize_step=quantize_step,
            lower_values=lower_values,
            upper_values=upper_values,
        )
        return self.recommend_voltages(config)

    def recommend_voltages(self, config: InverseSearchConfig) -> pd.DataFrame:
        grid_candidates = self._grid_search(config)
        all_candidates = [grid_candidates]

        if config.refine:
            seed_count = min(config.refine_seeds, len(grid_candidates))
            refined_rows: list[dict] = []
            for _, row in grid_candidates.head(seed_count).iterrows():
                refined = self._refine_from_seed(
                    row["lower_mfc_v"],
                    row["upper_mfc_v"],
                    config,
                )
                if refined is not None:
                    refined_rows.append(refined)
            if refined_rows:
                all_candidates.append(self._rank_dataframe(pd.DataFrame(refined_rows)))

        combined = pd.concat(all_candidates, ignore_index=True)
        combined = combined.drop_duplicates(
            subset=["lower_mfc_v", "upper_mfc_v", "pitch_deg"],
            keep="first",
        )
        ranked = self._rank_dataframe(combined)

        if config.max_cd is not None:
            feasible = ranked[ranked["satisfies_cd_constraint"]]
            if not feasible.empty:
                ranked = feasible

        return ranked.head(config.top_k)


def default_chain(
    project_dir: Path | None = None,
    augmentation: str = "strict",
    aerodynamic_model: str = "mlp_regressor",
) -> SurrogateChain:
    """Build the default forward chain using retrained augmented surrogates."""
    root = project_dir or Path(__file__).resolve().parent

    structural = root / "outputs_structural_surrogates" / "linear_regression.joblib"
    aerodynamic = (
        root
        / "outputs_augmented_models"
        / f"retrained_{augmentation}"
        / f"aerodynamic_{aerodynamic_model}.joblib"
    )

    if not structural.exists():
        raise FileNotFoundError(f"Structural model not found: {structural}")
    if not aerodynamic.exists():
        legacy = (
            root
            / "outputs_aerodynamic_surrogates"
            / "shape_and_pitch_linear_regression.joblib"
        )
        if aerodynamic_model == "mlp_regressor" and legacy.exists():
            raise FileNotFoundError(
                "Retrained aerodynamic MLP not found. Run train_augmented_surrogates.py "
                f"first. Expected: {aerodynamic}"
            )
        raise FileNotFoundError(f"Aerodynamic model not found: {aerodynamic}")

    return SurrogateChain(structural, aerodynamic)
