"""
risk_model.py
Random Forest Regressor — predicts patient risk score (0–100).
"""
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.preprocessing import StandardScaler
import joblib, os, time

from data.seed_patients import augment_dataset, FEATURE_COLS

MODEL_PATH = os.path.join(os.path.dirname(__file__), "saved", "risk_model.joblib")
SCALER_PATH = os.path.join(os.path.dirname(__file__), "saved", "risk_scaler.joblib")


class RiskModel:
    def __init__(self):
        self.model: RandomForestRegressor | None = None
        self.scaler: StandardScaler | None = None
        self.metrics: dict = {}
        self.feature_importances: dict = {}

    def train(self, force: bool = False) -> dict:
        os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)

        if not force and os.path.exists(MODEL_PATH):
            self.model = joblib.load(MODEL_PATH)
            self.scaler = joblib.load(SCALER_PATH)
            self.metrics = {"cached": True, "note": "Loaded from disk"}
            return self.metrics

        print("🔬 Training RiskModel (Random Forest Regressor)...")
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
        print(f"   ✓ Risk model trained | MAE={mae:.2f} | R²={r2:.3f} | {self.metrics['train_time_sec']}s")
        return self.metrics

    def predict(self, age: int, gender: str, condition: str, urgency: int,
                days_since_visit: int, insurance: str) -> float:
        from data.seed_patients import (
            CONDITION_RISK_MAP, GENDER_MAP, INSURANCE_MAP
        )
        X = np.array([[
            age,
            GENDER_MAP.get(gender, 0),
            CONDITION_RISK_MAP.get(condition, 50),
            urgency,
            days_since_visit,
            INSURANCE_MAP.get(insurance, 2),
        ]])
        X_s = self.scaler.transform(X)
        score = float(self.model.predict(X_s)[0])
        return round(float(np.clip(score, 0, 100)), 1)
