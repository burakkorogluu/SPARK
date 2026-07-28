# pyrefly: ignore [missing-import]
from sqlalchemy.orm import Session
from services.forecast_service import (
    forecast_xgboost,
    forecast_random_forest,
    forecast_regression,
    forecast_holt_winters,
    forecast_ortalama,
    forecast_persistence,
    forecast_gecen_ay
)

def evaluate_all_models(db: Session, transformer_id: str, steps: int = 168):
    """
    Tüm tahmin yöntemlerini çalıştırıp güven skorlarını ve karşılaştırmalı performans metriğini döndürür.
    """
    models_to_test = [
        ("XGBoost", "xgboost", forecast_xgboost),
        ("Random Forest", "randomForest", forecast_random_forest),
        ("Lineer Regresyon", "regression", forecast_regression),
        ("Holt-Winters", "holtWinters", forecast_holt_winters),
        ("Hareketli Ortalama", "ortalama", forecast_ortalama),
        ("Persistence", "persistence", forecast_persistence),
        ("Geçen Ay", "gecenAy", forecast_gecen_ay)
    ]

    results = []
    for name, method_key, func in models_to_test:
        try:
            preds, conf = func(db, transformer_id, steps)
            results.append({
                "name": name,
                "key": method_key,
                "confidence_score": conf,
                "step_count": len(preds),
                "status": "success"
            })
        except Exception as e:
            results.append({
                "name": name,
                "key": method_key,
                "confidence_score": 0,
                "step_count": 0,
                "status": f"error: {str(e)}"
            })

    results.sort(key=lambda x: x["confidence_score"], reverse=True)
    return results
