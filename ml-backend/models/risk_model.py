"""
risk_model.py
Random Forest Regressor — predicts patient risk score (0–100).
SHAP (TreeExplainer) for local interpretability of individual predictions.
"""
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.preprocessing import StandardScaler
import joblib, os, time
from typing import Any, Dict, List, Tuple

import shap

from data.seed_patients import augment_dataset, FEATURE_COLS

MODEL_PATH = os.path.join(os.path.dirname(__file__), "saved", "risk_model.joblib")
SCALER_PATH = os.path.join(os.path.dirname(__file__), "saved", "risk_scaler.joblib")

# Human-facing copy for SHAP feature names (Care / transparency)
FEATURE_CLINICAL_LABELS: Dict[str, str] = {
    "age": "older age and related physiologic vulnerability",
    "gender": "sex-specific risk pattern in the training cohort",
    "condition_risk": "condition severity / comorbidity burden signal",
    "urgency": "acute symptom urgency and triage acuity",
    "days_since_visit": "prolonged interval since last in-person contact",
    "insurance_ord": "coverage / access pathway (ordinal proxy)",
}


class RiskModel:
    def __init__(self):
        self.model: RandomForestRegressor | None = None
        self.scaler: StandardScaler | None = None
        self.metrics: dict = {}
        self.feature_importances: dict = {}
        self._explainer: Any = None

    def train(self, force: bool = False) -> dict:
        os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)

        if not force and os.path.exists(MODEL_PATH):
            self.model = joblib.load(MODEL_PATH)
            self.scaler = joblib.load(SCALER_PATH)
            self.metrics = {"cached": True, "note": "Loaded from disk"}
            self._attach_shap_explainer()
            return self.metrics

        print("[RiskModel] Training Random Forest Regressor...")
        t0 = time.time()

        df = augment_dataset(n_augmented=600)
        X = df[FEATURE_COLS].values
        y = df["risk_score"].values

        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42
        )

        self.scaler = StandardScaler()
        X_train_s = self.scaler.fit_transform(X_train)
        X_test_s  = self.scaler.transform(X_test)

        self.model = RandomForestRegressor(
            n_estimators=200,
            max_depth=10,
            min_samples_leaf=3,
            n_jobs=-1,
            random_state=42,
        )
        self.model.fit(X_train_s, y_train)

        preds = self.model.predict(X_test_s)
        mae   = mean_absolute_error(y_test, preds)
        r2    = r2_score(y_test, preds)

        self.feature_importances = dict(
            zip(FEATURE_COLS, self.model.feature_importances_.round(4).tolist())
        )

        self.metrics = {
            "algorithm":       "RandomForestRegressor",
            "n_estimators":    200,
            "training_rows":   len(X_train),
            "test_rows":       len(X_test),
            "mae":             round(mae, 2),
            "r2_score":        round(r2, 4),
            "train_time_sec":  round(time.time() - t0, 2),
            "feature_importance": self.feature_importances,
        }

        joblib.dump(self.model,  MODEL_PATH)
        joblib.dump(self.scaler, SCALER_PATH)
        print(f"   Risk model trained | MAE={mae:.2f} | R2={r2:.3f} | {self.metrics['train_time_sec']}s")
        self._attach_shap_explainer()
        return self.metrics

    def _attach_shap_explainer(self) -> None:
        """TreeExplainer for the fitted RF; safe to call after train or joblib load."""
        if self.model is None:
            self._explainer = None
            return
        self._explainer = shap.TreeExplainer(
            self.model,
            feature_perturbation="tree_path_dependent",
        )

    def _encode_row(
        self,
        age: int,
        gender: str,
        condition: str,
        urgency: int,
        days_since_visit: int,
        insurance: str,
    ) -> Tuple[np.ndarray, np.ndarray]:
        from data.seed_patients import (
            CONDITION_RISK_MAP,
            GENDER_MAP,
            INSURANCE_MAP,
        )
        X = np.array(
            [[
                age,
                GENDER_MAP.get(gender, 0),
                CONDITION_RISK_MAP.get(condition, 50),
                urgency,
                days_since_visit,
                INSURANCE_MAP.get(insurance, 2),
            ]],
            dtype=np.float64,
        )
        X_s = self.scaler.transform(X)
        return X, X_s

    def predict(self, age: int, gender: str, condition: str, urgency: int,
                days_since_visit: int, insurance: str) -> float:
        _, X_s = self._encode_row(
            age, gender, condition, urgency, days_since_visit, insurance
        )
        score = float(self.model.predict(X_s)[0])
        return round(float(np.clip(score, 0, 100)), 1)

    def get_explanation(
        self,
        age: int,
        gender: str,
        condition: str,
        urgency: int,
        days_since_visit: int,
        insurance: str,
        top_k: int = 3,
    ) -> Dict[str, Any]:
        """
        SHAP local explanation: top_k features by |SHAP value| on the scaled input.
        Returns structured dict including clinical_rationale for those features only.
        """
        if self.model is None or self.scaler is None:
            raise RuntimeError("RiskModel is not trained.")

        _, X_s = self._encode_row(
            age, gender, condition, urgency, days_since_visit, insurance
        )

        if self._explainer is None:
            self._attach_shap_explainer()
        assert self._explainer is not None

        sv = self._explainer.shap_values(X_s)
        if isinstance(sv, list):
            sv = np.asarray(sv[0])
        sv = np.asarray(sv).reshape(-1)
        if sv.size != len(FEATURE_COLS):
            raise RuntimeError("Unexpected SHAP vector shape.")

        order = np.argsort(-np.abs(sv))[:top_k]
        top: List[Dict[str, Any]] = []
        clinical_rationale: Dict[str, str] = {}
        for idx in order:
            name = FEATURE_COLS[int(idx)]
            val = float(sv[int(idx)])
            label = FEATURE_CLINICAL_LABELS.get(name, name.replace("_", " "))
            clinical_rationale[name] = label
            top.append(
                {
                    "feature": name,
                    "shap_value": round(val, 4),
                    "direction": "increases_risk" if val >= 0 else "decreases_risk",
                    "clinical_rationale": label,
                }
            )

        return {
            "top_contributions": top,
            "clinical_rationale": clinical_rationale,
        }
