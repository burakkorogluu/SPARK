import math
import warnings
import pandas as pd
import numpy as np
import xgboost as xgb
import logging
from sqlalchemy.orm import Session
from services.forecast.data_prep import _extract_series_features
from services.forecast.models.base import _get_or_train_models, generate_predictions_from_model

logger = logging.getLogger("spark.forecast")


def forecast_xgboost(db: Session, transformer_id: str, steps: int = 168):
    base_features = ['is_weekend', 'is_holiday', 'hour', 'day_of_week', 'sin_hour', 'cos_hour', 'sin_day', 'cos_day', 'temp', 'humidity', 'wind_speed', 'cloud_cover', 'thi']
    
    def _create_xgb():
        default_p = {
            'n_estimators': 150, 'max_depth': 5, 'learning_rate': 0.05,
            'subsample': 0.85, 'colsample_bytree': 0.85, 'reg_alpha': 0.1,
            'reg_lambda': 1.0, 'random_state': 42, 'n_jobs': -1
        }
        return (
            xgb.XGBRegressor(**default_p),
            xgb.XGBRegressor(**default_p),
            xgb.XGBRegressor(**default_p)
        )

    xgb_aktif, xgb_kap, xgb_end, confidence, df, X_aktif, X_kap, X_end, weather_map, tr_holidays, future_dates = _get_or_train_models(
        db, transformer_id, "xgboost", steps, base_features, _create_xgb
    )
    if (
        xgb_aktif is None or xgb_kap is None or xgb_end is None or
        df is None or df.empty or X_aktif is None or X_kap is None or X_end is None or not future_dates
    ):
        return [], 0
    
    preds = generate_predictions_from_model(
        xgb_aktif, xgb_kap, xgb_end, df, steps, transformer_id, future_dates,
        "xgboost", weather_map, tr_holidays
    )
    return preds, confidence
