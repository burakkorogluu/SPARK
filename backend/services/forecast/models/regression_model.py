from sklearn.linear_model import Ridge
from sqlalchemy.orm import Session

from services.forecast.models.base import _get_or_train_models, generate_predictions_from_model

def forecast_regression(db: Session, transformer_id: str, steps: int = 168):
    base_features = ['is_weekend', 'is_holiday', 'hour', 'day_of_week', 'sin_hour', 'cos_hour', 'sin_day', 'cos_day', 'temp', 'humidity', 'wind_speed', 'cloud_cover', 'thi']

    def _create_lr():
        return Ridge(alpha=1.0), Ridge(alpha=1.0), Ridge(alpha=1.0)

    lr_aktif, lr_kap, lr_end, confidence, df, X_aktif, X_kap, X_end, weather_map, tr_holidays, future_dates = _get_or_train_models(
        db, transformer_id, "regression", steps, base_features, _create_lr
    )
    if (
        lr_aktif is None or lr_kap is None or lr_end is None or
        df is None or df.empty or not future_dates
    ):
        return [], 0

    preds = generate_predictions_from_model(
        lr_aktif, lr_kap, lr_end, df, steps, transformer_id, future_dates,
        "regression", weather_map, tr_holidays
    )
    return preds, confidence
