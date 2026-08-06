import time
import math
import warnings
import pandas as pd
import numpy as np
import concurrent.futures
from sqlalchemy.orm import Session
import logging

from services.forecast.cache_manager import TRAINED_MODELS_CACHE, MODEL_CACHE_TTL, MIN_MEASUREMENTS_FOR_ML_FORECAST
from services.forecast.data_prep import calculate_confidence, _load_measurements, _prepare_training_data, _extract_series_features
from services.weather_service import get_weather_features_for_timestamp

logger = logging.getLogger("spark.forecast")

def _fit_models_parallel(m_a, m_k, m_e, X_a, y_a, X_k, y_k, X_e, y_e):
    if "LGBM" in type(m_a).__name__:
        X_a, y_a = X_a.values, y_a.values
        X_k, y_k = X_k.values, y_k.values
        X_e, y_e = X_e.values, y_e.values
        
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        f_a = executor.submit(m_a.fit, X_a, y_a)
        f_k = executor.submit(m_k.fit, X_k, y_k)
        f_e = executor.submit(m_e.fit, X_e, y_e)
        return f_a.result(), f_k.result(), f_e.result()

def _calculate_holdout_confidence(df, X_aktif, X_kap, X_end, model_aktif, model_kap, model_end):
    from sklearn.base import clone
    split_idx = int(len(df) * 0.8)
    test_df = df.iloc[split_idx:]

    if len(test_df) < 24:
        logger.warning(
            f"Hold-out için yetersiz veri ({len(test_df)} satır < 24). In-sample güven kullanılıyor."
        )
        if "LGBM" in type(model_aktif).__name__:
            conf_a = calculate_confidence(df['y_aktif'],     model_aktif.predict(X_aktif.values))
            conf_k = calculate_confidence(df['y_kapasitif'], model_kap.predict(X_kap.values))
            conf_e = calculate_confidence(df['y_enduktif'],  model_end.predict(X_end.values))
        else:
            conf_a = calculate_confidence(df['y_aktif'],     model_aktif.predict(X_aktif))
            conf_k = calculate_confidence(df['y_kapasitif'], model_kap.predict(X_kap))
            conf_e = calculate_confidence(df['y_enduktif'],  model_end.predict(X_end))
        return round((conf_a + conf_k + conf_e) / 3, 1)

    X_aktif_train = X_aktif.iloc[:split_idx]
    X_kap_train   = X_kap.iloc[:split_idx]
    X_end_train   = X_end.iloc[:split_idx]
    
    y_aktif_train = df['y_aktif'].iloc[:split_idx]
    y_kap_train   = df['y_kapasitif'].iloc[:split_idx]
    y_end_train   = df['y_enduktif'].iloc[:split_idx]

    if "LGBM" in type(model_aktif).__name__:
        eval_model_aktif = clone(model_aktif).fit(X_aktif_train.values, y_aktif_train.values)
        eval_model_kap   = clone(model_kap).fit(X_kap_train.values, y_kap_train.values)
        eval_model_end   = clone(model_end).fit(X_end_train.values, y_end_train.values)
    else:
        eval_model_aktif = clone(model_aktif).fit(X_aktif_train, y_aktif_train)
        eval_model_kap   = clone(model_kap).fit(X_kap_train, y_kap_train)
        eval_model_end   = clone(model_end).fit(X_end_train, y_end_train)

    X_aktif_test = X_aktif.iloc[split_idx:]
    X_kap_test   = X_kap.iloc[split_idx:]
    X_end_test   = X_end.iloc[split_idx:]

    if "LGBM" in type(model_aktif).__name__:
        conf_a = calculate_confidence(test_df['y_aktif'],     eval_model_aktif.predict(X_aktif_test.values))
        conf_k = calculate_confidence(test_df['y_kapasitif'], eval_model_kap.predict(X_kap_test.values))
        conf_e = calculate_confidence(test_df['y_enduktif'],  eval_model_end.predict(X_end_test.values))
    else:
        conf_a = calculate_confidence(test_df['y_aktif'],     eval_model_aktif.predict(X_aktif_test))
        conf_k = calculate_confidence(test_df['y_kapasitif'], eval_model_kap.predict(X_kap_test))
        conf_e = calculate_confidence(test_df['y_enduktif'],  eval_model_end.predict(X_end_test))
    return round((conf_a + conf_k + conf_e) / 3, 1)

def _get_or_train_models(db: Session, transformer_id: str, model_type: str, steps: int, base_features, create_models_fn):
    cache_key = f"{transformer_id}_{model_type}"
    now_ts = time.time()
    
    if cache_key in TRAINED_MODELS_CACHE:
        cached = TRAINED_MODELS_CACHE[cache_key]
        if (now_ts - cached.get("timestamp", 0) < MODEL_CACHE_TTL and
            cached.get("m_aktif") is not None and
            cached.get("m_kap") is not None and
            cached.get("m_end") is not None and
            cached.get("X_aktif") is not None and
            cached.get("X_kap") is not None and
            cached.get("X_end") is not None):
            return (
                cached["m_aktif"], cached["m_kap"], cached["m_end"],
                cached["confidence"], cached["df"], cached["X_aktif"],
                cached["X_kap"], cached["X_end"], cached["weather_map"],
                cached["tr_holidays"], cached["future_dates"]
            )

    measurements = _load_measurements(db, transformer_id, limit=0)
    if len(measurements) < MIN_MEASUREMENTS_FOR_ML_FORECAST:
        return None, None, None, 0, None, None, None, None, None, None, None

    df, X_aktif, X_kap, X_end, weather_map, tr_holidays, future_dates = _prepare_training_data(
        db, measurements, steps, base_features
    )
    if df is None or df.empty:
        return None, None, None, 0, None, None, None, None, None, None, None

    try:
        m_a_init, m_k_init, m_e_init = create_models_fn(
            X_aktif, df['y_aktif'],
            X_kap, df['y_kapasitif'],
            X_end, df['y_enduktif'],
            transformer_id
        )
    except TypeError:
        m_a_init, m_k_init, m_e_init = create_models_fn()
    
    m_aktif, m_kap, m_end = _fit_models_parallel(
        m_a_init, m_k_init, m_e_init,
        X_aktif, df['y_aktif'],
        X_kap, df['y_kapasitif'],
        X_end, df['y_enduktif']
    )

    confidence = _calculate_holdout_confidence(df, X_aktif, X_kap, X_end, m_aktif, m_kap, m_end)

    TRAINED_MODELS_CACHE[cache_key] = {
        "m_aktif": m_aktif,
        "m_kap": m_kap,
        "m_end": m_end,
        "confidence": confidence,
        "df": df,
        "X_aktif": X_aktif,
        "X_kap": X_kap,
        "X_end": X_end,
        "weather_map": weather_map,
        "tr_holidays": tr_holidays,
        "future_dates": future_dates,
        "timestamp": now_ts
    }

    return (
        m_aktif, m_kap, m_end, confidence, df,
        X_aktif, X_kap, X_end, weather_map, tr_holidays, future_dates
    )

def generate_predictions_from_model(model_aktif, model_kap, model_end, df, steps, transformer_id, future_dates, method_name="regression", weather_map=None, tr_holidays=None):
    if df is None or (isinstance(df, pd.DataFrame) and df.empty) or not future_dates:
        return []
    predictions = []
    last_168 = df[['y_aktif', 'y_kapasitif', 'y_enduktif']].tail(168).to_dict('records')

    def _get_feat_cols(m, fallback):
        val = getattr(m, "feature_names_in_", None)
        if val is not None:
            return list(val)
        return fallback

    base_feats = ['is_weekend', 'is_holiday', 'hour', 'day_of_week', 'sin_hour', 'cos_hour', 'sin_day', 'cos_day', 'temp', 'humidity', 'wind_speed', 'cloud_cover', 'thi']
    cols_aktif = _get_feat_cols(model_aktif, base_feats + ['aktif_lag_24', 'aktif_lag_168', 'aktif_roll_mean_24', 'aktif_roll_std_24', 'aktif_diff_1'])
    cols_kap   = _get_feat_cols(model_kap, base_feats + ['kapasitif_lag_24', 'kapasitif_lag_168', 'kapasitif_roll_mean_24', 'kapasitif_roll_std_24', 'kapasitif_diff_1'])
    cols_end   = _get_feat_cols(model_end, base_feats + ['enduktif_lag_24', 'enduktif_lag_168', 'enduktif_roll_mean_24', 'enduktif_roll_std_24', 'enduktif_diff_1'])

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
            
            lags_a = _extract_series_features(last_168, 'y_aktif')
            lags_k = _extract_series_features(last_168, 'y_kapasitif')
            lags_e = _extract_series_features(last_168, 'y_enduktif')

            base_row = [is_weekend, is_holiday, d.hour, d.weekday(), math.sin(2 * math.pi * d.hour / 24.0), math.cos(2 * math.pi * d.hour / 24.0), math.sin(2 * math.pi * d.weekday() / 7.0), math.cos(2 * math.pi * d.weekday() / 7.0), t, rh, w_feat.get("wind_speed", 0.0), w_feat.get("cloud_cover", 0.0), thi]
            
            feat_aktif = pd.DataFrame([base_row + lags_a], columns=cols_aktif)
            feat_kap   = pd.DataFrame([base_row + lags_k], columns=cols_kap)
            feat_end   = pd.DataFrame([base_row + lags_e], columns=cols_end)
                
            pa = max(0, model_aktif.predict(feat_aktif)[0])
            pk = max(0, model_kap.predict(feat_kap)[0])
            pe = max(0, model_end.predict(feat_end)[0])
            
            predictions.append({
                "transformer_id": transformer_id,
                "timestamp": d.strftime("%Y-%m-%d %H:00:00"),
                "active_kwh": pa,
                "capacitive_kvarh": pk,
                "inductive_kvarh": pe,
                "is_forecast": True
            })
            
            last_168.append({'y_aktif': pa, 'y_kapasitif': pk, 'y_enduktif': pe})
            last_168.pop(0)

    return predictions
