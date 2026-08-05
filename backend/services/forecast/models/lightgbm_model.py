import lightgbm as lgb
from sqlalchemy.orm import Session

from services.forecast.models.base import _get_or_train_models, generate_predictions_from_model

def forecast_lightgbm(db: Session, transformer_id: str, steps: int = 168):
    base_features = ['is_weekend', 'is_holiday', 'hour', 'day_of_week', 'sin_hour', 'cos_hour', 'sin_day', 'cos_day', 'temp', 'humidity', 'wind_speed', 'cloud_cover', 'thi']
    
    def _create_lgb():
        params = {'n_estimators': 150, 'max_depth': 6, 'learning_rate': 0.05, 'subsample': 0.8, 'colsample_bytree': 0.8, 'random_state': 42, 'n_jobs': -1, 'verbose': -1}
        return (
            lgb.LGBMRegressor(**params),
            lgb.LGBMRegressor(**params),
            lgb.LGBMRegressor(**params)
        )

    lgb_aktif, lgb_kap, lgb_end, confidence, df, X_aktif, X_kap, X_end, weather_map, tr_holidays, future_dates = _get_or_train_models(
        db, transformer_id, "lightgbm", steps, base_features, _create_lgb
    )
    if (
        lgb_aktif is None or lgb_kap is None or lgb_end is None or
        df is None or df.empty or not future_dates
    ):
        return [], 0

    preds = generate_predictions_from_model(
        lgb_aktif, lgb_kap, lgb_end, df, steps, transformer_id, future_dates,
        "lightgbm", weather_map, tr_holidays
    )
    return preds, confidence
