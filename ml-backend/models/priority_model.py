"""
priority_model.py
Gradient Boosting Classifier — predicts patient priority (High/Medium/Low).
"""
import numpy as np
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.metrics import classification_report, accuracy_score
from sklearn.preprocessing import StandardScaler
import joblib, os, time

from data.seed_patients import augment_dataset, FEATURE_COLS

MODEL_PATH  = os.path.join(os.path.dirname(__file__), "saved", "priority_model.joblib")
SCALER_PATH = os.path.join(os.path.dirname(__file__), "saved", "priority_scaler.joblib")

LABEL_MAP    = {0: "Low", 1: "Medium", 2: "High"}
PRIORITY_MAP = {"Low": 0, "Medium": 1, "High": 2}


class PriorityModel:
    def __init__(self):
        self.model: GradientBoostingClassifier | None = None
        self.scaler: StandardScaler | None = None
        self.metrics: dict = {}

    def train(self, force: bool = False) -> dict:
        os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)

        if not force and os.path.exists(MODEL_PATH):
            self.model  = joblib.load(MODEL_PATH)
            self.scaler = joblib.load(SCALER_PATH)
            self.metrics = {"cached": True, "note": "Loaded from disk"}
            return self.metrics

        print("[PriorityModel] Training Gradient Boosting Classifier...")
        t0 = time.time()

        df = augment_dataset(n_augmented=600)
        X  = df[FEATURE_COLS].values
        y  = df["priority"].values

        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, stratify=y, random_state=42
        )

        self.scaler = StandardScaler()
        X_train_s = self.scaler.fit_transform(X_train)
        X_test_s  = self.scaler.transform(X_test)

        self.model = GradientBoostingClassifier(
            n_estimators=150,
            learning_rate=0.08,
            max_depth=4,
            min_samples_leaf=4,
            subsample=0.85,
            random_state=42,
        )
        self.model.fit(X_train_s, y_train)

        preds    = self.model.predict(X_test_s)
        accuracy = accuracy_score(y_test, preds)
        report   = classification_report(
            y_test, preds,
            target_names=["Low", "Medium", "High"],
            output_dict=True,
        )

        # Cross-validation score
        cv_scores = cross_val_score(self.model, X_train_s, y_train, cv=5, scoring="accuracy")

        self.metrics = {
            "algorithm":        "GradientBoostingClassifier",
            "n_estimators":     150,
            "training_rows":    len(X_train),
            "test_rows":        len(X_test),
            "accuracy":         round(accuracy, 4),
            "cv_mean_accuracy": round(float(cv_scores.mean()), 4),
            "cv_std":           round(float(cv_scores.std()), 4),
            "per_class_f1": {
                "Low":    round(report["Low"]["f1-score"], 3),
                "Medium": round(report["Medium"]["f1-score"], 3),
                "High":   round(report["High"]["f1-score"], 3),
            },
            "train_time_sec": round(time.time() - t0, 2),
        }

        joblib.dump(self.model,  MODEL_PATH)
        joblib.dump(self.scaler, SCALER_PATH)
        print(f"   Priority model trained | Acc={accuracy:.3f} | CV={cv_scores.mean():.3f}+/-{cv_scores.std():.3f} | {self.metrics['train_time_sec']}s")
        return self.metrics

    def predict(self, age: int, gender: str, condition: str, urgency: int,
                days_since_visit: int, insurance: str) -> dict:
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
        X_s   = self.scaler.transform(X)
        label = int(self.model.predict(X_s)[0])
        proba = self.model.predict_proba(X_s)[0].tolist()
        return {
            "priority":    LABEL_MAP[label],
            "confidence":  round(max(proba), 3),
            "probabilities": {
                "Low":    round(proba[0], 3),
                "Medium": round(proba[1], 3),
                "High":   round(proba[2], 3),
            }
        }
