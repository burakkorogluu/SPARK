from sklearn.ensemble import RandomForestRegressor
from sqlalchemy.orm import Session

from services.forecast.models.base import _get_or_train_models, generate_predictions_from_model

def forecast_random_forest(db: Session, transformer_id: str, steps: int = 168):
    base_features = ['is_weekend', 'is_holiday', 'hour', 'day_of_week', 'sin_hour', 'cos_hour', 'sin_day', 'cos_day', 'temp', 'humidity', 'wind_speed', 'cloud_cover', 'thi']
    
    def _create_rf():
        return (
            RandomForestRegressor(n_estimators=150, max_depth=6, min_samples_split=10, min_samples_leaf=4, n_jobs=-1, random_state=42),
            RandomForestRegressor(n_estimators=150, max_depth=6, min_samples_split=10, min_samples_leaf=4, n_jobs=-1, random_state=42),
            RandomForestRegressor(n_estimators=150, max_depth=6, min_samples_split=10, min_samples_leaf=4, n_jobs=-1, random_state=42)
        )

    rf_aktif, rf_kap, rf_end, confidence, df, X_aktif, X_kap, X_end, weather_map, tr_holidays, future_dates = _get_or_train_models(
        db, transformer_id, "random_forest", steps, base_features, _create_rf
    )
    if (
        rf_aktif is None or rf_kap is None or rf_end is None or
        df is None or df.empty or not future_dates
    ):
        return [], 0

    preds = generate_predictions_from_model(
        rf_aktif, rf_kap, rf_end, df, steps, transformer_id, future_dates,
        "randomForest", weather_map, tr_holidays
    )
    return preds, confidence
