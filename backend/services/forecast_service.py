import pandas as pd
import math
# pyrefly: ignore [missing-import]
import lightgbm as lgb
import numpy as np
from sklearn.model_selection import RandomizedSearchCV, TimeSeriesSplit
# pyrefly: ignore [missing-source-for-stubs]
from sklearn.ensemble import RandomForestRegressor
# pyrefly: ignore [missing-source-for-stubs]
from sklearn.linear_model import LinearRegression
# pyrefly: ignore [missing-import, missing-source-for-stubs]

from statsmodels.tsa.holtwinters import ExponentialSmoothing
import xgboost as xgb
import shap
from services.weather_service import get_weather_data, get_weather_features_for_timestamp, get_temperature_for_timestamp
import datetime
from sqlalchemy.orm import Session
import models
import time
import calendar
import warnings
import holidays
import os
import logging
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger("spark.forecast")

FEATURE_NAMES_TR = {
    "is_weekend": "Hafta Sonu",
    "is_holiday": "Resmi Tatil",
    "hour": "Saat",
    "temp": "Sıcaklık",
    "humidity": "Nem",
    "wind_speed": "Rüzgar Hızı",
    "cloud_cover": "Bulutluluk",
    "thi": "Sıcaklık-Nem İndeksi",
    "aktif_lag_1": "1 Saat Önceki Aktif",
    "aktif_lag_24": "Dünkü Aktif (Aynı Saat)",
    "aktif_lag_168": "Geçen Hafta Aktif (Aynı Saat)",
    "kapasitif_lag_1": "1 Saat Önceki Kapasitif",
    "kapasitif_lag_24": "Dünkü Kapasitif (Aynı Saat)",
    "kapasitif_lag_168": "Geçen Hafta Kapasitif (Aynı Saat)",
    "enduktif_lag_1": "1 Saat Önceki Endüktif",
    "enduktif_lag_24": "Dünkü Endüktif (Aynı Saat)",
    "enduktif_lag_168": "Geçen Hafta Endüktif (Aynı Saat)"
}

FORECAST_CACHE = {}
CACHE_TTL = int(os.getenv("FORECAST_CACHE_TTL", "3600"))  # Ortam değişkeninden oku

TRAINED_MODELS_CACHE = {}
MODEL_CACHE_TTL = int(os.getenv("MODEL_CACHE_TTL", "86400"))  # 24 saat

HYPERPARAM_CACHE = {}

def clear_caches():
    FORECAST_CACHE.clear()
    # Note: TRAINED_MODELS_CACHE is purposefully NOT cleared here. Maneuvers only change topology, 
    # not the underlying historical data of the original transformers. Keeping the models cached 
    # allows fast re-scaling.
    # Note: HYPERPARAM_CACHE is purposefully NOT cleared to preserve tuned hyperparams across topology maneuvers.

import concurrent.futures

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

def calculate_confidence(y_true, y_pred):
    """Calculates confidence score based on WMAPE (Weighted MAPE)."""
    y_true, y_pred = np.asarray(y_true), np.asarray(y_pred)
    sum_true = np.sum(np.abs(y_true))
    if sum_true < 1e-5:
        return 80.0
    wmape = (np.sum(np.abs(y_true - y_pred)) / sum_true) * 100
    return max(0, min(100, 100 - wmape))

def prepare_dataframe(measurements, weather_map=None, tr_holidays=None):
    data = []
    for m in measurements:
        d = m.timestamp
        is_holiday = 1 if tr_holidays and d in tr_holidays else 0
        w_feat = get_weather_features_for_timestamp(weather_map, d) if weather_map else {"temp": 20.0, "humidity": 50.0, "wind_speed": 0.0, "wind_direction": 0.0, "precipitation": 0.0, "cloud_cover": 0.0}
        
        # Calculate THI (Temperature-Humidity Index)
        # THI = T - (0.55 - 0.0055 * RH) * (T - 14.5)
        t = w_feat["temp"]
        rh = w_feat["humidity"]
        thi = t - (0.55 - 0.0055 * rh) * (t - 14.5) if t else 20.0
        
        data.append({
            "ds": d,
            "y_aktif": m.active_kwh,
            "y_kapasitif": m.capacitive_kvarh,
            "y_enduktif": m.inductive_kvarh,
            "is_weekend": 1 if d.weekday() >= 5 else 0,
            "is_holiday": is_holiday,
            "day_of_week": d.weekday(),
            "month": d.month,
            "temp": t,
            "humidity": rh,
            "wind_speed": w_feat["wind_speed"],
            "wind_direction": w_feat["wind_direction"],
            "precipitation": w_feat["precipitation"],
            "cloud_cover": w_feat["cloud_cover"],
            "thi": thi,
            "hour": d.hour,
            "sin_hour": math.sin(2 * math.pi * d.hour / 24.0),
            "cos_hour": math.cos(2 * math.pi * d.hour / 24.0),
            "sin_day": math.sin(2 * math.pi * d.weekday() / 7.0),
            "cos_day": math.cos(2 * math.pi * d.weekday() / 7.0)
        })
    df = pd.DataFrame(data)
    df.sort_values(by="ds", inplace=True)
    df.set_index("ds", inplace=True)
    return df

def _extract_series_features(last_168, col_name):
    vals = [r[col_name] for r in last_168]
    lag_24 = vals[-24]
    lag_168 = vals[-168]
    roll_24 = float(np.mean(vals[-24:]))
    roll_std_24 = float(np.std(vals[-24:], ddof=1)) if len(vals[-24:]) > 1 else 0.0
    diff_1 = vals[-1] - vals[-2] if len(vals) >= 2 else 0.0
    return [lag_24, lag_168, roll_24, roll_std_24, diff_1]

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
            from services.weather_service import get_weather_features_for_timestamp
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
            
            if method_name == "lightgbm":
                feat_aktif = feat_aktif.values
                feat_kap = feat_kap.values
                feat_end = feat_end.values
                
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



# ─── Ortak Yardımcı Fonksiyonlar ───────────────────────────────────────────

def _load_measurements(db: Session, transformer_id: str, limit: int = 0):
    """Belirli bir trafo için en son N ölçümü çeker. limit=0 ise tüm veriyi çeker."""
    sim_now = datetime.datetime.now()
    query = db.query(models.Measurement).filter(
        models.Measurement.transformer_id == transformer_id,
        models.Measurement.timestamp <= sim_now
    ).order_by(models.Measurement.timestamp.desc())
    
    if limit > 0:
        query = query.limit(limit)
        
    measurements = query.all()
    measurements.reverse()
    return measurements


def _prepare_training_data(db: Session, measurements, steps: int, base_features=None):
    """
    Ölçümlerden DataFrame hazırlar, hava durumu ve tatil verilerini ekler,
    lag & rolling feature'larını oluşturur, aykırı değerleri yumuşatır ve NaN satırlarını temizler.
    Döndürür: (df, X_aktif, X_kap, X_end, weather_map, tr_holidays, future_dates)
    """
    if base_features is None:
        base_features = ['is_weekend', 'is_holiday', 'hour', 'day_of_week', 'sin_hour', 'cos_hour', 'sin_day', 'cos_day', 'temp', 'humidity', 'wind_speed', 'cloud_cover', 'thi']

    tr_holidays = holidays.country_holidays("TR", years=[
        measurements[0].timestamp.year,
        measurements[-1].timestamp.year,
        (measurements[-1].timestamp + datetime.timedelta(days=30)).year
    ])

    start_str = measurements[0].timestamp.strftime("%Y-%m-%d")
    end_str   = (measurements[-1].timestamp + datetime.timedelta(hours=steps)).strftime("%Y-%m-%d")
    weather_map = get_weather_data(start_str, end_str, db)

    df = prepare_dataframe(measurements, weather_map, tr_holidays)

    # Aykırı değer (outlier) ve aşırı sıçrama yumuşatma
    for c in ['aktif', 'kapasitif', 'enduktif']:
        col = f'y_{c}'
        mean_val = df[col].mean()
        std_val = df[col].std()
        if std_val > 0:
            df[col] = df[col].clip(lower=0, upper=mean_val + 4 * std_val)

    for c in ['aktif', 'kapasitif', 'enduktif']:
        df[f'{c}_lag_1']   = df[f'y_{c}'].shift(1)
        df[f'{c}_lag_24']  = df[f'y_{c}'].shift(24)
        df[f'{c}_lag_168'] = df[f'y_{c}'].shift(168)
        df[f'{c}_roll_mean_6']  = df[f'y_{c}'].shift(1).rolling(6).mean()
        df[f'{c}_roll_mean_24'] = df[f'y_{c}'].shift(1).rolling(24).mean()
        df[f'{c}_roll_std_24']  = df[f'y_{c}'].shift(1).rolling(24).std().fillna(0)
        df[f'{c}_diff_1']       = df[f'y_{c}'].shift(1) - df[f'y_{c}'].shift(2)

    df.dropna(inplace=True)
    if df.empty:
        return None, None, None, None, None, None, None

    lag_cols_aktif = ['aktif_lag_24', 'aktif_lag_168', 'aktif_roll_mean_24', 'aktif_roll_std_24', 'aktif_diff_1']
    lag_cols_kap   = ['kapasitif_lag_24', 'kapasitif_lag_168', 'kapasitif_roll_mean_24', 'kapasitif_roll_std_24', 'kapasitif_diff_1']
    lag_cols_end   = ['enduktif_lag_24', 'enduktif_lag_168', 'enduktif_roll_mean_24', 'enduktif_roll_std_24', 'enduktif_diff_1']

    X_aktif = df[base_features + lag_cols_aktif]
    X_kap   = df[base_features + lag_cols_kap]
    X_end   = df[base_features + lag_cols_end]

    last_date    = df.index[-1]
    future_dates = [last_date + datetime.timedelta(hours=i) for i in range(1, steps + 1)]

    return df, X_aktif, X_kap, X_end, weather_map, tr_holidays, future_dates


def _calculate_holdout_confidence(df, X_aktif, X_kap, X_end, model_aktif, model_kap, model_end):
    """
    Kronolojik %80/%20 train/test split ile gerçek hold-out güven skoru hesaplar.
    - Modelin bir kopyası sadece train seti ile eğitilir ve test setinde değerlendirilir.
    - Test seti < 24 satır ise in-sample'a fallback yapılır ve uyarı verilir.
    """
    from sklearn.base import clone
    split_idx = int(len(df) * 0.8)
    test_df = df.iloc[split_idx:]

    if len(test_df) < 24:
        # Yeterli test verisi yok — in-sample'a dön, log at
        import logging
        logging.getLogger("spark.forecast").warning(
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

    # Train verilerini al
    X_aktif_train = X_aktif.iloc[:split_idx]
    X_kap_train   = X_kap.iloc[:split_idx]
    X_end_train   = X_end.iloc[:split_idx]
    
    y_aktif_train = df['y_aktif'].iloc[:split_idx]
    y_kap_train   = df['y_kapasitif'].iloc[:split_idx]
    y_end_train   = df['y_enduktif'].iloc[:split_idx]

    # Modelleri kopyala ve sadece train verisiyle eğit (data leakage'ı önlemek için)
    if "LGBM" in type(model_aktif).__name__:
        eval_model_aktif = clone(model_aktif).fit(X_aktif_train.values, y_aktif_train.values)
        eval_model_kap   = clone(model_kap).fit(X_kap_train.values, y_kap_train.values)
        eval_model_end   = clone(model_end).fit(X_end_train.values, y_end_train.values)
    else:
        eval_model_aktif = clone(model_aktif).fit(X_aktif_train, y_aktif_train)
        eval_model_kap   = clone(model_kap).fit(X_kap_train, y_kap_train)
        eval_model_end   = clone(model_end).fit(X_end_train, y_end_train)

    # Test setindeki feature sütunlarını al
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


def _tune_xgboost_hyperparameters(X, y, transformer_id: str):
    """
    Performs RandomizedSearchCV with TimeSeriesSplit(n_splits=19) on actual data
    for the given transformer_id. Results are cached in HYPERPARAM_CACHE.
    """
    if transformer_id in HYPERPARAM_CACHE:
        logger.info(f"Önbellekteki hiperparametreler kullanılıyor ({transformer_id}): {HYPERPARAM_CACHE[transformer_id]}")
        return HYPERPARAM_CACHE[transformer_id]

    logger.info(f"Trafo {transformer_id} için XGBoost hiperparametre optimizasyonu başlatılıyor (19-split TimeSeriesSplit)...")
    param_grid = {
        'max_depth': [3, 5, 7],
        'learning_rate': [0.01, 0.05, 0.1],
        'n_estimators': [100, 150, 200],
        'subsample': [0.8, 0.9, 1.0],
        'colsample_bytree': [0.8, 0.9, 1.0],
        'reg_alpha': [0.0, 0.1, 0.5],
        'reg_lambda': [0.5, 1.0, 2.0]
    }
    
    n_splits = 19
    if len(X) < 100:
        n_splits = 2
    elif len(X) < 500:
        n_splits = 5

    tscv = TimeSeriesSplit(n_splits=n_splits)
    base_xgb = xgb.XGBRegressor(random_state=42, n_jobs=-1)
    
    search = RandomizedSearchCV(
        estimator=base_xgb,
        param_distributions=param_grid,
        n_iter=5,
        cv=tscv,
        scoring='neg_mean_absolute_error',
        random_state=42,
        n_jobs=-1
    )
    
    try:
        search.fit(X, y)
        best_params = search.best_params_
        best_params['random_state'] = 42
        best_params['n_jobs'] = -1
        logger.info(f"Optimal XGBoost hiperparametreleri ({transformer_id}): {best_params}")
        HYPERPARAM_CACHE[transformer_id] = best_params
        return best_params
    except Exception as e:
        logger.warning(f"Hiperparametre optimizasyonu başarısız ({transformer_id}): {e}. Varsayılan parametreler kullanılıyor.")
        default_params = {
            'n_estimators': 150, 'max_depth': 5, 'learning_rate': 0.05,
            'subsample': 0.85, 'colsample_bytree': 0.85, 'reg_alpha': 0.1,
            'reg_lambda': 1.0, 'random_state': 42, 'n_jobs': -1
        }
        HYPERPARAM_CACHE[transformer_id] = default_params
        return default_params


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
    if len(measurements) < 168:
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


# ────────────────────────────────────────────────────────────────────────────

def forecast_xgboost(db: Session, transformer_id: str, steps: int = 168):
    base_features = ['is_weekend', 'is_holiday', 'hour', 'day_of_week', 'sin_hour', 'cos_hour', 'sin_day', 'cos_day', 'temp', 'humidity', 'wind_speed', 'cloud_cover', 'thi']
    
    def _create_xgb(X_a=None, y_a=None, X_k=None, y_k=None, X_e=None, y_e=None, t_id=None):
        if t_id is not None and X_a is not None:
            params_a = _tune_xgboost_hyperparameters(X_a, y_a, f"{t_id}_aktif")
            params_k = _tune_xgboost_hyperparameters(X_k, y_k, f"{t_id}_kap")
            params_e = _tune_xgboost_hyperparameters(X_e, y_e, f"{t_id}_end")
        else:
            default_p = {
                'n_estimators': 150, 'max_depth': 5, 'learning_rate': 0.05,
                'subsample': 0.85, 'colsample_bytree': 0.85, 'reg_alpha': 0.1,
                'reg_lambda': 1.0, 'random_state': 42, 'n_jobs': -1
            }
            params_a, params_k, params_e = default_p, default_p, default_p
        return (
            xgb.XGBRegressor(**params_a),
            xgb.XGBRegressor(**params_k),
            xgb.XGBRegressor(**params_e)
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

    # Create SHAP explainers once (not inside the loop) for performance
    shap_explainer_kap = shap.TreeExplainer(xgb_kap)
    shap_explainer_end = shap.TreeExplainer(xgb_end)
    # SHAP column name mappings
    kap_cols = list(X_kap.columns)
    end_cols = list(X_end.columns)

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

            f_a = pd.DataFrame([row_base + lags_a], columns=X_aktif.columns)
            f_k = pd.DataFrame([row_base + lags_k], columns=X_kap.columns)
            f_e = pd.DataFrame([row_base + lags_e], columns=X_end.columns)

            pa = max(0, xgb_aktif.predict(f_a)[0])
            pk = max(0, xgb_kap.predict(f_k)[0])
            pe = max(0, xgb_end.predict(f_e)[0])

            # SHAP: only compute for the first 48 steps to avoid O(steps) overhead
            kap_reason = None
            end_reason = None
            if i < 48:
                shap_values_kap = shap_explainer_kap.shap_values(f_k)[0]
                shap_values_end = shap_explainer_end.shap_values(f_e)[0]

                top_kap_idx = np.argmax(np.abs(shap_values_kap))
                top_end_idx = np.argmax(np.abs(shap_values_end))

                kap_feature_name = FEATURE_NAMES_TR.get(kap_cols[top_kap_idx], kap_cols[top_kap_idx])
                end_feature_name = FEATURE_NAMES_TR.get(end_cols[top_end_idx], end_cols[top_end_idx])
                kap_val = float(shap_values_kap[top_kap_idx])
                end_val = float(shap_values_end[top_end_idx])

                kap_reason = f"{kap_feature_name} ({kap_val:+.2f})"
                end_reason = f"{end_feature_name} ({end_val:+.2f})"

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


def forecast_regression(db: Session, transformer_id: str, steps: int = 168):
    base_features = ['is_weekend', 'is_holiday', 'hour', 'day_of_week', 'sin_hour', 'cos_hour', 'sin_day', 'cos_day', 'temp', 'humidity', 'wind_speed', 'cloud_cover', 'thi']

    def _create_lr():
        from sklearn.linear_model import Ridge
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


def forecast_holt_winters(db: Session, transformer_id: str, steps: int = 168):
    sim_now = datetime.datetime.now()
    measurements = db.query(models.Measurement).filter(
        models.Measurement.transformer_id == transformer_id,
        models.Measurement.timestamp <= sim_now
    ).order_by(models.Measurement.timestamp.desc()).limit(2160).all()
    measurements.reverse()
    
    if len(measurements) < 48: return [], 0
    df = prepare_dataframe(measurements)
    
    last_date = df.index[-1]
    future_dates = [last_date + datetime.timedelta(hours=i) for i in range(1, steps + 1)]
    predictions = []
    
    confidence = 0
    try:
        # Gerçek (Honest) güven skoru için 80/20 train/test split
        split_idx = int(len(df) * 0.8)
        train_df = df.iloc[:split_idx]
        test_df = df.iloc[split_idx:]
        
        if len(test_df) >= 24:
            hw_aktif_eval = ExponentialSmoothing(train_df['y_aktif'], seasonal_periods=24, trend='add', seasonal='add', initialization_method="heuristic").fit()
            hw_kap_eval = ExponentialSmoothing(train_df['y_kapasitif'], seasonal_periods=24, trend='add', seasonal='add', initialization_method="heuristic").fit()
            hw_end_eval = ExponentialSmoothing(train_df['y_enduktif'], seasonal_periods=24, trend='add', seasonal='add', initialization_method="heuristic").fit()
            
            test_steps = len(test_df)
            conf_a = calculate_confidence(test_df['y_aktif'], hw_aktif_eval.forecast(test_steps))
            conf_k = calculate_confidence(test_df['y_kapasitif'], hw_kap_eval.forecast(test_steps))
            conf_e = calculate_confidence(test_df['y_enduktif'], hw_end_eval.forecast(test_steps))
            confidence = round((conf_a + conf_k + conf_e) / 3, 1)
        else:
            confidence = 75.0 # fallback

        # Gerçek tahminler için modelin %100 veriyle tekrar eğitilmesi
        hw_aktif = ExponentialSmoothing(df['y_aktif'], seasonal_periods=24, trend='add', seasonal='add', initialization_method="heuristic").fit()
        hw_kap = ExponentialSmoothing(df['y_kapasitif'], seasonal_periods=24, trend='add', seasonal='add', initialization_method="heuristic").fit()
        hw_end = ExponentialSmoothing(df['y_enduktif'], seasonal_periods=24, trend='add', seasonal='add', initialization_method="heuristic").fit()
        
        pred_aktif = hw_aktif.forecast(steps)
        pred_kap = hw_kap.forecast(steps)
        pred_end = hw_end.forecast(steps)
        
        for i in range(steps):
            predictions.append({
                "transformer_id": transformer_id,
                "timestamp": future_dates[i].strftime("%Y-%m-%d %H:00:00"),
                "active_kwh": max(0, int(pred_aktif.iloc[i])),
                "capacitive_kvarh": max(0, int(pred_kap.iloc[i])),
                "inductive_kvarh": max(0, int(pred_end.iloc[i])),
                "is_forecast": True
            })
    except Exception as exc:
        import logging
        logging.getLogger("spark").warning(
            f"Holt-Winters forecast failed for {transformer_id}: {exc}"
        )
    return predictions, confidence



def forecast_ortalama(db: Session, transformer_id: str, steps: int = 168):
    sim_now = datetime.datetime.now()
    measurements = db.query(models.Measurement).filter(
        models.Measurement.transformer_id == transformer_id,
        models.Measurement.timestamp <= sim_now
    ).order_by(models.Measurement.timestamp.desc()).limit(336).all()
    measurements.reverse()
    
    if len(measurements) < 168: return [], 0
    df = prepare_dataframe(measurements)
    
    last_date = df.index[-1]
    predictions = []
    
    train_actuals = {"a": [], "k": [], "e": []}
    train_preds = {"a": [], "k": [], "e": []}
    
    # evaluate on last 7 days using the 7 days before it
    if len(df) >= 336:
        test_df = df.iloc[-168:]
        hist_df = df.iloc[:-168]
        for _, row in test_df.iterrows():
            target_hour = row['hour']
            same_hour_data = hist_df[hist_df['hour'] == target_hour]
            train_actuals["a"].append(row['y_aktif'])
            train_actuals["k"].append(row['y_kapasitif'])
            train_actuals["e"].append(row['y_enduktif'])
            train_preds["a"].append(same_hour_data['y_aktif'].mean() if not same_hour_data.empty else 0)
            train_preds["k"].append(same_hour_data['y_kapasitif'].mean() if not same_hour_data.empty else 0)
            train_preds["e"].append(same_hour_data['y_enduktif'].mean() if not same_hour_data.empty else 0)
            
        conf_a = calculate_confidence(train_actuals["a"], train_preds["a"])
        conf_k = calculate_confidence(train_actuals["k"], train_preds["k"])
        conf_e = calculate_confidence(train_actuals["e"], train_preds["e"])
        confidence = round((conf_a + conf_k + conf_e) / 3, 1)
    else:
        confidence = 78.0 # fallback

    for i in range(steps):
        target_date = last_date + datetime.timedelta(hours=i+1)
        target_hour = target_date.hour
        same_hour_data = df[df['hour'] == target_hour]
        
        pa = same_hour_data['y_aktif'].mean() if not same_hour_data.empty else 0
        pk = same_hour_data['y_kapasitif'].mean() if not same_hour_data.empty else 0
        pe = same_hour_data['y_enduktif'].mean() if not same_hour_data.empty else 0
        
        predictions.append({
            "transformer_id": transformer_id,
            "timestamp": target_date.strftime("%Y-%m-%d %H:00:00"),
            "active_kwh": max(0, int(pa)),
            "capacitive_kvarh": max(0, int(pk)),
            "inductive_kvarh": max(0, int(pe)),
            "is_forecast": True
        })
    return predictions, confidence


def forecast_persistence(db: Session, transformer_id: str, steps: int = 168):
    sim_now = datetime.datetime.now()
    measurements = db.query(models.Measurement).filter(
        models.Measurement.transformer_id == transformer_id,
        models.Measurement.timestamp <= sim_now
    ).order_by(models.Measurement.timestamp.desc()).limit(336).all()
    measurements.reverse()
    
    if len(measurements) < 168: return forecast_ortalama(db, transformer_id, steps)
    
    # Calculate real confidence using last 7 days compared to the 7 days prior
    if len(measurements) >= 336:
        y_a, p_a = [], []
        y_k, p_k = [], []
        y_e, p_e = [], []
        for i in range(168, 336):
            y_a.append(measurements[i].active_kwh)
            p_a.append(measurements[i-168].active_kwh)
            y_k.append(measurements[i].capacitive_kvarh)
            p_k.append(measurements[i-168].capacitive_kvarh)
            y_e.append(measurements[i].inductive_kvarh)
            p_e.append(measurements[i-168].inductive_kvarh)
        c_a = calculate_confidence(y_a, p_a)
        c_k = calculate_confidence(y_k, p_k)
        c_e = calculate_confidence(y_e, p_e)
        confidence = round((c_a + c_k + c_e) / 3, 1)
    else:
        confidence = 75.0

    last_date = measurements[-1].timestamp
    predictions = []
    
    hist_len = len(measurements)
    for i in range(steps):
        target_date = last_date + datetime.timedelta(hours=i+1)
        idx = hist_len - 168 + (i % 168)
        if idx < 0: idx = i % hist_len
        
        m = measurements[idx]
        predictions.append({
            "transformer_id": transformer_id,
            "timestamp": target_date.strftime("%Y-%m-%d %H:00:00"),
            "active_kwh": m.active_kwh,
            "capacitive_kvarh": m.capacitive_kvarh,
            "inductive_kvarh": m.inductive_kvarh,
            "is_forecast": True
        })
    return predictions, confidence


def forecast_gecen_ay(db: Session, transformer_id: str, steps: int = 168):
    sim_now = datetime.datetime.now()
    measurements = db.query(models.Measurement).filter(
        models.Measurement.transformer_id == transformer_id,
        models.Measurement.timestamp <= sim_now
    ).order_by(models.Measurement.timestamp.desc()).limit(1344).all()
    measurements.reverse()
    
    if len(measurements) < 672: return forecast_persistence(db, transformer_id, steps)
    
    if len(measurements) >= 1344:
        y_a, p_a = [], []
        y_k, p_k = [], []
        y_e, p_e = [], []
        for i in range(672, 1344):
            y_a.append(measurements[i].active_kwh)
            p_a.append(measurements[i-672].active_kwh)
            y_k.append(measurements[i].capacitive_kvarh)
            p_k.append(measurements[i-672].capacitive_kvarh)
            y_e.append(measurements[i].inductive_kvarh)
            p_e.append(measurements[i-672].inductive_kvarh)
        c_a = calculate_confidence(y_a, p_a)
        c_k = calculate_confidence(y_k, p_k)
        c_e = calculate_confidence(y_e, p_e)
        confidence = round((c_a + c_k + c_e) / 3, 1)
    else:
        confidence = 72.0

    last_date = measurements[-1].timestamp
    predictions = []
    for i in range(steps):
        target_date = last_date + datetime.timedelta(hours=i+1)
        m = measurements[i % 672]
        predictions.append({
            "transformer_id": transformer_id,
            "timestamp": target_date.strftime("%Y-%m-%d %H:00:00"),
            "active_kwh": m.active_kwh,
            "capacitive_kvarh": m.capacitive_kvarh,
            "inductive_kvarh": m.inductive_kvarh,
            "is_forecast": True
        })
    return predictions, confidence


def get_cached_forecast(db: Session, transformer_id: str, year: int, month: int, method: str):
    sim_now = datetime.datetime.now()
    last_day = calendar.monthrange(year, month)[1]
    end_of_month = datetime.datetime(year, month, last_day, 23, 59, 59)
    
    last_m = db.query(models.Measurement).filter(
        models.Measurement.transformer_id == transformer_id,
        models.Measurement.timestamp <= sim_now
    ).order_by(models.Measurement.timestamp.desc()).first()
    
    if not last_m or last_m.timestamp >= end_of_month:
        return {"predictions": [], "confidence_score": 0}
        
    delta = end_of_month - last_m.timestamp
    steps = int(delta.total_seconds() / 3600)
    if steps <= 0: return {"predictions": [], "confidence_score": 0}
    
    cache_key = f"{transformer_id}_{method}_{last_m.timestamp.isoformat()}_{steps}"
    
    now = time.time()
    if cache_key in FORECAST_CACHE:
        cached_time, cached_data = FORECAST_CACHE[cache_key]
        if now - cached_time < CACHE_TTL:
            return cached_data

    # BATCH PREDICTION FETCH: Veritabanından hazır tahminleri çek
    db_forecasts = db.query(models.ForecastMeasurement).filter(
        models.ForecastMeasurement.transformer_id == transformer_id,
        models.ForecastMeasurement.model_type == method,
        models.ForecastMeasurement.timestamp > last_m.timestamp,
        models.ForecastMeasurement.timestamp <= end_of_month
    ).order_by(models.ForecastMeasurement.timestamp.asc()).all()

    # Eğer istenen adım sayısının %90'ı kadarı veritabanında varsa direkt oradan dön!
    if db_forecasts and len(db_forecasts) >= (steps * 0.9):
        data = []
        confidence = db_forecasts[0].confidence_score or 80.0
        for f in db_forecasts:
            data.append({
                "transformer_id": f.transformer_id,
                "timestamp": f.timestamp.strftime("%Y-%m-%d %H:%M:%S"),
                "active_kwh": f.active_kwh,
                "capacitive_kvarh": f.capacitive_kvarh,
                "inductive_kvarh": f.inductive_kvarh,
                "is_forecast": True,
                "kap_reason": f.kap_reason,
                "end_reason": f.end_reason
            })
        result = {"predictions": data, "confidence_score": confidence}
        FORECAST_CACHE[cache_key] = (now, result)
        return result

    # FALLBACK: Veritabanında hazır yoksa On-the-fly (anlık) hesapla
    # BATCH PREDICTION FETCH FALLBACK: Eğer ensemble yoksa ama xgboost varsa, hizli olmasi icin xgboost'u dondur!
    if method == "ensemble":
        fallback_forecasts = db.query(models.ForecastMeasurement).filter(
            models.ForecastMeasurement.transformer_id == transformer_id,
            models.ForecastMeasurement.model_type == "xgboost",
            models.ForecastMeasurement.timestamp > last_m.timestamp,
            models.ForecastMeasurement.timestamp <= end_of_month
        ).order_by(models.ForecastMeasurement.timestamp.asc()).all()
        
        if fallback_forecasts and len(fallback_forecasts) >= (steps * 0.9):
            data = []
            confidence = fallback_forecasts[0].confidence_score or 80.0
            for f in fallback_forecasts:
                data.append({
                    "transformer_id": f.transformer_id,
                    "timestamp": f.timestamp.strftime("%Y-%m-%d %H:%M:%S"),
                    "active_kwh": f.active_kwh,
                    "capacitive_kvarh": f.capacitive_kvarh,
                    "inductive_kvarh": f.inductive_kvarh,
                    "is_forecast": True,
                    "kap_reason": f.kap_reason,
                    "end_reason": f.end_reason
                })
            result = {"predictions": data, "confidence_score": confidence}
            FORECAST_CACHE[cache_key] = (now, result)
            return result

    confidence = 0
    if method == "xgboost":
        data, confidence = forecast_xgboost(db, transformer_id, steps)
    elif method == "randomForest":
        data, confidence = forecast_random_forest(db, transformer_id, steps)
    elif method == "regression":
        data, confidence = forecast_regression(db, transformer_id, steps)
    elif method == "holtWinters":
        data, confidence = forecast_holt_winters(db, transformer_id, steps)
    elif method == "ortalama":
        data, confidence = forecast_ortalama(db, transformer_id, steps)
    elif method == "persistence":
        data, confidence = forecast_persistence(db, transformer_id, steps)
    elif method == "gecenAy":
        data, confidence = forecast_gecen_ay(db, transformer_id, steps)
    elif method == "lightgbm":
        data, confidence = forecast_lightgbm(db, transformer_id, steps)
    else:
        xgb_preds, xgb_conf = forecast_xgboost(db, transformer_id, steps)
        rf_preds, rf_conf = forecast_random_forest(db, transformer_id, steps)
        reg_preds, reg_conf = forecast_regression(db, transformer_id, steps)
        lgb_preds, lgb_conf = forecast_lightgbm(db, transformer_id, steps)
        data, confidence = _build_ensemble(xgb_preds, xgb_conf, rf_preds, rf_conf, reg_preds, reg_conf, lgb_preds, lgb_conf, transformer_id)
        
    result = {"predictions": data, "confidence_score": confidence}
    FORECAST_CACHE[cache_key] = (now, result)
    return result

def _build_ensemble(xgb_preds, xgb_conf, rf_preds, rf_conf, reg_preds, reg_conf, lgb_preds, lgb_conf, transformer_id):
    data = []
    
    xgb_c = max(0, xgb_conf) if xgb_conf is not None else 0
    rf_c = max(0, rf_conf) if rf_conf is not None else 0
    reg_c = max(0, reg_conf) if reg_conf is not None else 0
    lgb_c = max(0, lgb_conf) if lgb_conf is not None else 0
    
    max_len = max(len(xgb_preds or []), len(rf_preds or []), len(reg_preds or []), len(lgb_preds or []))
    for i in range(max_len):
        valid_models = []
        if i < len(xgb_preds or []): valid_models.append((xgb_preds[i], xgb_c))
        if i < len(rf_preds or []): valid_models.append((rf_preds[i], rf_c))
        if i < len(reg_preds or []): valid_models.append((reg_preds[i], reg_c))
        if i < len(lgb_preds or []): valid_models.append((lgb_preds[i], lgb_c))
        
        good_models = [m for m in valid_models if m[1] > 10]
        if not good_models:
            good_models = valid_models
            
        if len(good_models) > 0:
            total_weight = sum(m[1] for m in good_models)
            if total_weight == 0:
                avg_active = int(sum(m[0]["active_kwh"] for m in good_models) / len(good_models))
                avg_cap = int(sum(m[0]["capacitive_kvarh"] for m in good_models) / len(good_models))
                avg_ind = int(sum(m[0]["inductive_kvarh"] for m in good_models) / len(good_models))
            else:
                avg_active = int(sum(m[0]["active_kwh"] * (m[1] / total_weight) for m in good_models))
                avg_cap = int(sum(m[0]["capacitive_kvarh"] * (m[1] / total_weight) for m in good_models))
                avg_ind = int(sum(m[0]["inductive_kvarh"] * (m[1] / total_weight) for m in good_models))
            
            data.append({
                "transformer_id": transformer_id,
                "timestamp": good_models[0][0]["timestamp"],
                "active_kwh": avg_active,
                "capacitive_kvarh": avg_cap,
                "inductive_kvarh": avg_ind,
                "kap_reason": good_models[0][0].get("kap_reason"),
                "end_reason": good_models[0][0].get("end_reason"),
                "is_forecast": True
            })

    valid_confs = [c for c in [xgb_c, rf_c, reg_c, lgb_c] if c > 0]
    confidence = round(sum(valid_confs) / len(valid_confs), 1) if valid_confs else 90.0
    return data, confidence

def apply_topology_scaling_to_forecast(db, transformer_id, method, steps):
    from simulator import ORIGINAL_FEEDER_MAPPING, ORIGINAL_TRAFO_WEIGHTS, ORIGINAL_REACTOR_COMPENSATION
    
    current_feeders = db.query(models.Feeder).filter(models.Feeder.current_transformer_id == transformer_id).all()
    
    # Needs raw forecasts for all original transformers that have a feeder here
    raw_forecasts = {}
    
    def get_raw_forecast(t_id):
        if t_id not in raw_forecasts:
            preds, conf = _run_raw_forecast_algorithm(db, t_id, method, steps)
            raw_forecasts[t_id] = {"preds": preds, "conf": conf}
        return raw_forecasts[t_id]

    # Initialize empty scaled predictions array
    scaled_preds = []
    # Use the first fetched raw forecast to get timestamps
    # If no feeders, we still need timestamps, so fetch for the current transformer itself just for timestamps
    base_raw = get_raw_forecast(transformer_id)
    if not base_raw["preds"]:
        return [], 0
        
    # Calculate reactor delta once outside the loop
    current_reactors = db.query(models.Reactor).filter(
        models.Reactor.current_transformer_id == transformer_id,
        models.Reactor.status == "active"
    ).all()
    current_reactor_comp = sum(r.capacity_kvar for r in current_reactors)
    original_reactor_comp = ORIGINAL_REACTOR_COMPENSATION.get(transformer_id, 0.0)
    reactor_delta = current_reactor_comp - original_reactor_comp

    for i in range(len(base_raw["preds"])):
        timestamp = base_raw["preds"][i]["timestamp"]
        total_active = 0.0
        total_inductive = 0.0
        total_capacitive = 0.0
        kap_reason = None
        end_reason = None
        
        for feeder in current_feeders:
            mapping = ORIGINAL_FEEDER_MAPPING.get(feeder.id)
            if not mapping:
                orig_t_id = str(feeder.alternative_transformer_id) if hasattr(feeder, 'alternative_transformer_id') and feeder.alternative_transformer_id else str(feeder.current_transformer_id)
                orig_weight = ORIGINAL_TRAFO_WEIGHTS.get(orig_t_id, 1000.0)
                share = 500.0 / orig_weight
            else:
                orig_t_id = str(mapping["trafo"])
                orig_weight = ORIGINAL_TRAFO_WEIGHTS.get(orig_t_id, 1.0)
                share = float(mapping["weight"]) / orig_weight if orig_weight > 0 else 0
            
            raw_f = get_raw_forecast(orig_t_id)
            if i < len(raw_f["preds"]):
                p = raw_f["preds"][i]
                total_active += p["active_kwh"] * share
                total_inductive += p["inductive_kvarh"] * share
                total_capacitive += p["capacitive_kvarh"] * share
                
                # Carry over reasons if any
                if p.get("kap_reason"): kap_reason = p["kap_reason"]
                if p.get("end_reason"): end_reason = p["end_reason"]
                
        active = int(total_active)
        inductive = int(total_inductive)
        capacitive = int(total_capacitive)
        
        # Apply reactor compensation delta
        
        if reactor_delta > 0:
            cap_reduction = min(capacitive, int(reactor_delta))
            capacitive -= cap_reduction
            inductive += (int(reactor_delta) - cap_reduction)
        elif reactor_delta < 0:
            lost_comp = int(abs(reactor_delta))
            ind_reduction = min(inductive, lost_comp)
            inductive -= ind_reduction
            capacitive += (lost_comp - ind_reduction)
            
        scaled_preds.append({
            "transformer_id": transformer_id,
            "timestamp": timestamp,
            "active_kwh": active,
            "capacitive_kvarh": capacitive,
            "inductive_kvarh": inductive,
            "kap_reason": kap_reason,
            "end_reason": end_reason,
            "is_forecast": True
        })
        
    return scaled_preds, base_raw["conf"]



def forecast_lightgbm(db, transformer_id: str, steps: int = 168):
    base_features = ['is_weekend', 'is_holiday', 'hour', 'day_of_week', 'sin_hour', 'cos_hour', 'sin_day', 'cos_day', 'temp', 'humidity', 'wind_speed', 'cloud_cover', 'thi']
    
    def _create_lgb():
        # pyrefly: ignore [missing-import]
        import lightgbm as lgb
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

def _run_raw_forecast_algorithm(db, transformer_id, method, steps):
    if method == "xgboost": preds, conf = forecast_xgboost(db, transformer_id, steps)
    elif method == "randomForest": preds, conf = forecast_random_forest(db, transformer_id, steps)
    elif method == "regression": preds, conf = forecast_regression(db, transformer_id, steps)
    elif method == "holtWinters": preds, conf = forecast_holt_winters(db, transformer_id, steps)
    elif method == "ortalama": preds, conf = forecast_ortalama(db, transformer_id, steps)
    elif method == "persistence": preds, conf = forecast_persistence(db, transformer_id, steps)
    elif method == "gecenAy": preds, conf = forecast_gecen_ay(db, transformer_id, steps)
    elif method == "lightgbm": preds, conf = forecast_lightgbm(db, transformer_id, steps)
    elif method == "ensemble":
        xgb_preds, xgb_conf = forecast_xgboost(db, transformer_id, steps)
        rf_preds, rf_conf = forecast_random_forest(db, transformer_id, steps)
        reg_preds, reg_conf = forecast_regression(db, transformer_id, steps)
        lgb_preds, lgb_conf = forecast_lightgbm(db, transformer_id, steps)
        preds, conf = _build_ensemble(xgb_preds, xgb_conf, rf_preds, rf_conf, reg_preds, reg_conf, lgb_preds, lgb_conf, transformer_id)
    else:
        preds, conf = [], 0
        
    return preds, conf


def _run_forecast_algorithm(db, transformer_id, method, steps):
    return apply_topology_scaling_to_forecast(db, transformer_id, method, steps)


def run_weekly_batch_forecast(transformer_ids=None):
    """Asenkron arka plan görevi: 30 günlük tüm model tahminlerini üretip veritabanına kaydeder."""
    from database import SessionLocal
    db = SessionLocal()
    try:
        if transformer_ids:
            transformers = db.query(models.Transformer).filter(models.Transformer.id.in_(transformer_ids)).all()
        else:
            transformers = db.query(models.Transformer).all()
            
        methods = ["ensemble", "xgboost", "randomForest", "regression", "lightgbm"]
        steps = 720 # 30 gün
        
        for t in transformers:
            all_new_rows = []
            logger.info(f"Batch forecast uretimi basliyor: {t.id}")
            for m in methods:
                try:
                    logger.info(f"Model hesaplaniyor: {t.id} - {m}")
                    preds, conf = _run_forecast_algorithm(db, t.id, m, steps)
                    
                    for p in preds:
                        dt = datetime.datetime.strptime(p["timestamp"], "%Y-%m-%d %H:%M:%S")
                        fm = models.ForecastMeasurement(
                            transformer_id=t.id,
                            timestamp=dt,
                            model_type=m,
                            active_kwh=p["active_kwh"],
                            capacitive_kvarh=p["capacitive_kvarh"],
                            inductive_kvarh=p["inductive_kvarh"],
                            confidence_score=conf,
                            kap_reason=p.get("kap_reason"),
                            end_reason=p.get("end_reason")
                        )
                        all_new_rows.append(fm)
                except Exception as e:
                    logger.error(f"{t.id} - {m} hatasi: {e}")
            
            try:
                # Toplu olarak sil ve ekle (Çok hızlı DB işlemi)
                db.query(models.ForecastMeasurement).filter(
                    models.ForecastMeasurement.transformer_id == t.id
                ).delete(synchronize_session=False)
                
                db.add_all(all_new_rows)
                db.commit()
                logger.info(f"Batch forecast kaydedildi: {t.id} ({len(all_new_rows)} kayit)")
            except Exception as e:
                db.rollback()
                logger.error(f"{t.id} DB kayit hatasi: {e}")
                
        logger.info("Weekly batch forecast basariyla tamamlandi.")
    finally:
        db.close()
