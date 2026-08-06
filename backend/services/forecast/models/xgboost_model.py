import math
import warnings
import pandas as pd
import numpy as np
import xgboost as xgb
import logging
from sqlalchemy.orm import Session
from services.forecast.data_prep import _extract_series_features
from services.forecast.models.base import _get_or_train_models
from services.weather_service import get_weather_features_for_timestamp

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
    
    predictions = []
    last_168 = df[['y_aktif', 'y_kapasitif', 'y_enduktif']].tail(168).to_dict('records')

    def _get_feat_cols(m, fallback):
        val = getattr(m, "feature_names_in_", None)
        if val is not None:
            return list(val)
        return fallback

    cols_aktif = _get_feat_cols(xgb_aktif, base_features + ['aktif_lag_24', 'aktif_lag_168', 'aktif_roll_mean_24', 'aktif_roll_std_24', 'aktif_diff_1'])
    cols_kap   = _get_feat_cols(xgb_kap, base_features + ['kapasitif_lag_24', 'kapasitif_lag_168', 'kapasitif_roll_mean_24', 'kapasitif_roll_std_24', 'kapasitif_diff_1'])
    cols_end   = _get_feat_cols(xgb_end, base_features + ['enduktif_lag_24', 'enduktif_lag_168', 'enduktif_roll_mean_24', 'enduktif_roll_std_24', 'enduktif_diff_1'])

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for i in range(steps):
            d = future_dates[i]

            is_weekend = 1 if d.weekday() >= 5 else 0
            is_holiday = 1 if tr_holidays and d in tr_holidays else 0
            w_feat = get_weather_features_for_timestamp(weather_map, d) if weather_map else {"temp": 20.0, "humidity": 50.0, "wind_speed": 0.0, "cloud_cover": 0.0}
            t = w_feat.get("temp", 20.0)
            rh = w_feat.get("humidity", 50.0)
            thi = t - (0.55 - 0.0055 * rh) * (t - 14.5)

            row_base = [is_weekend, is_holiday, d.hour, d.weekday(), math.sin(2 * math.pi * d.hour / 24.0), math.cos(2 * math.pi * d.hour / 24.0), math.sin(2 * math.pi * d.weekday() / 7.0), math.cos(2 * math.pi * d.weekday() / 7.0), t, rh, w_feat.get("wind_speed", 0.0), w_feat.get("cloud_cover", 0.0), thi]

            lags_a = _extract_series_features(last_168, 'y_aktif')
            lags_k = _extract_series_features(last_168, 'y_kapasitif')
            lags_e = _extract_series_features(last_168, 'y_enduktif')

            f_a = pd.DataFrame([row_base + lags_a], columns=cols_aktif)
            f_k = pd.DataFrame([row_base + lags_k], columns=cols_kap)
            f_e = pd.DataFrame([row_base + lags_e], columns=cols_end)

            pa = max(0, xgb_aktif.predict(f_a)[0])
            pk = max(0, xgb_kap.predict(f_k)[0])
            pe = max(0, xgb_end.predict(f_e)[0])

            kap_reason = None
            end_reason = None

            predictions.append({
                "transformer_id": transformer_id,
                "timestamp": d.strftime("%Y-%m-%d %H:00:00"),
                "active_kwh": float(pa),
                "capacitive_kvarh": float(pk),
                "inductive_kvarh": float(pe),
                "is_forecast": True,
                "kap_reason": kap_reason,
                "end_reason": end_reason
            })

            last_168.append({'y_aktif': pa, 'y_kapasitif': pk, 'y_enduktif': pe})
            last_168.pop(0)

    return predictions, confidence
