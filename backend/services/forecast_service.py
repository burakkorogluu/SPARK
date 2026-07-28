import pandas as pd
import numpy as np
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

FORECAST_CACHE = {}
CACHE_TTL = int(os.getenv("FORECAST_CACHE_TTL", "3600"))  # Ortam değişkeninden oku

def calculate_confidence(y_true, y_pred):
    """Calculates confidence score based on MAPE."""
    y_true, y_pred = np.array(y_true), np.array(y_pred)
    mask = y_true != 0
    if not np.any(mask):
        return 80 # fallback if no active values
    mape = np.mean(np.abs((y_true[mask] - y_pred[mask]) / y_true[mask])) * 100
    return max(0, min(100, 100 - mape))

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
            "temp": t,
            "humidity": rh,
            "wind_speed": w_feat["wind_speed"],
            "wind_direction": w_feat["wind_direction"],
            "precipitation": w_feat["precipitation"],
            "cloud_cover": w_feat["cloud_cover"],
            "thi": thi,
            "hour": d.hour
        })
    df = pd.DataFrame(data)
    df.sort_values(by="ds", inplace=True)
    df.set_index("ds", inplace=True)
    return df

def generate_predictions_from_model(model_aktif, model_kap, model_end, df, steps, transformer_id, future_dates, method_name="regression", weather_map=None, tr_holidays=None):
    predictions = []
    last_168 = df[['y_aktif', 'y_kapasitif', 'y_enduktif']].tail(168).to_dict('records')

    # Eğitimde kullanılan kolon adları ve sırası (_prepare_training_data ile birebir
    # aynı olmalı) — modeller adlandırılmış DataFrame ile eğitildiği için tahmin
    # girdisi de aynı isimlerle DataFrame olarak verilmeli, aksi halde sklearn
    # "X does not have valid feature names" uyarısı veriyor.
    cols_aktif = ['is_weekend', 'is_holiday', 'hour', 'temp', 'aktif_lag_1', 'aktif_lag_24', 'aktif_lag_168']
    cols_kap   = ['is_weekend', 'is_holiday', 'hour', 'temp', 'kapasitif_lag_1', 'kapasitif_lag_24', 'kapasitif_lag_168']
    cols_end   = ['is_weekend', 'is_holiday', 'hour', 'temp', 'enduktif_lag_1', 'enduktif_lag_24', 'enduktif_lag_168']

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for i in range(steps):
            d = future_dates[i]
            
            lag_1 = last_168[-1]
            lag_24 = last_168[-24]
            lag_168 = last_168[-168]
            
            is_weekend = 1 if d.weekday() >= 5 else 0
            is_holiday = 1 if tr_holidays and d in tr_holidays else 0
            temp = get_temperature_for_timestamp(weather_map, d) if weather_map else 20.0
            
            feat_aktif = pd.DataFrame([[is_weekend, is_holiday, d.hour, temp, lag_1['y_aktif'], lag_24['y_aktif'], lag_168['y_aktif']]], columns=cols_aktif)
            feat_kap = pd.DataFrame([[is_weekend, is_holiday, d.hour, temp, lag_1['y_kapasitif'], lag_24['y_kapasitif'], lag_168['y_kapasitif']]], columns=cols_kap)
            feat_end = pd.DataFrame([[is_weekend, is_holiday, d.hour, temp, lag_1['y_enduktif'], lag_24['y_enduktif'], lag_168['y_enduktif']]], columns=cols_end)
            
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

def _load_measurements(db: Session, transformer_id: str, limit: int = 720):
    """Belirli bir trafo için en son N ölçümü çeker."""
    sim_now = datetime.datetime.now()
    measurements = db.query(models.Measurement).filter(
        models.Measurement.transformer_id == transformer_id,
        models.Measurement.timestamp <= sim_now
    ).order_by(models.Measurement.timestamp.desc()).limit(limit).all()
    measurements.reverse()
    return measurements


def _prepare_training_data(db: Session, measurements, steps: int, base_features=None):
    """
    Ölçümlerden DataFrame hazırlar, hava durumu ve tatil verilerini ekler,
    lag feature'larını (1h, 24h, 168h) oluşturur ve NaN satırlarını temizler.
    Döndürür: (df, X_aktif, X_kap, X_end, weather_map, tr_holidays, future_dates)
    """
    if base_features is None:
        base_features = ['is_weekend', 'is_holiday', 'hour', 'temp']

    tr_holidays = holidays.TR(years=[
        measurements[0].timestamp.year,
        measurements[-1].timestamp.year,
        (measurements[-1].timestamp + datetime.timedelta(days=30)).year
    ])

    start_str = measurements[0].timestamp.strftime("%Y-%m-%d")
    end_str   = (measurements[-1].timestamp + datetime.timedelta(hours=steps)).strftime("%Y-%m-%d")
    weather_map = get_weather_data(start_str, end_str, db)

    df = prepare_dataframe(measurements, weather_map, tr_holidays)

    for c in ['aktif', 'kapasitif', 'enduktif']:
        df[f'{c}_lag_1']   = df[f'y_{c}'].shift(1)
        df[f'{c}_lag_24']  = df[f'y_{c}'].shift(24)
        df[f'{c}_lag_168'] = df[f'y_{c}'].shift(168)

    df.dropna(inplace=True)

    X_aktif = df[base_features + ['aktif_lag_1',    'aktif_lag_24',    'aktif_lag_168']]
    X_kap   = df[base_features + ['kapasitif_lag_1','kapasitif_lag_24','kapasitif_lag_168']]
    X_end   = df[base_features + ['enduktif_lag_1', 'enduktif_lag_24', 'enduktif_lag_168']]

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
    eval_model_aktif = clone(model_aktif).fit(X_aktif_train, y_aktif_train)
    eval_model_kap   = clone(model_kap).fit(X_kap_train, y_kap_train)
    eval_model_end   = clone(model_end).fit(X_end_train, y_end_train)

    # Test setindeki feature sütunlarını al
    X_aktif_test = X_aktif.iloc[split_idx:]
    X_kap_test   = X_kap.iloc[split_idx:]
    X_end_test   = X_end.iloc[split_idx:]

    conf_a = calculate_confidence(test_df['y_aktif'],     eval_model_aktif.predict(X_aktif_test))
    conf_k = calculate_confidence(test_df['y_kapasitif'], eval_model_kap.predict(X_kap_test))
    conf_e = calculate_confidence(test_df['y_enduktif'],  eval_model_end.predict(X_end_test))
    return round((conf_a + conf_k + conf_e) / 3, 1)


# ────────────────────────────────────────────────────────────────────────────

def forecast_xgboost(db: Session, transformer_id: str, steps: int = 168):
    measurements = _load_measurements(db, transformer_id, limit=720)
    if len(measurements) < 168: return [], 0
    
    base_features = ['is_weekend', 'is_holiday', 'hour', 'temp', 'humidity', 'wind_speed', 'cloud_cover', 'thi']
    df, X_aktif, X_kap, X_end, weather_map, tr_holidays, future_dates = _prepare_training_data(
        db, measurements, steps, base_features
    )
    
    # Train XGBoost
    xgb_aktif = xgb.XGBRegressor(n_estimators=100, max_depth=6, learning_rate=0.1, random_state=42).fit(X_aktif, df['y_aktif'])
    xgb_kap = xgb.XGBRegressor(n_estimators=100, max_depth=6, learning_rate=0.1, random_state=42).fit(X_kap, df['y_kapasitif'])
    xgb_end = xgb.XGBRegressor(n_estimators=100, max_depth=6, learning_rate=0.1, random_state=42).fit(X_end, df['y_enduktif'])
    
    # Hold-out güven skoru: kronolojik %80/%20 split — data leakage yok
    confidence = _calculate_holdout_confidence(df, X_aktif, X_kap, X_end, xgb_aktif, xgb_kap, xgb_end)
    
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
            lag_1 = last_168[-1]
            lag_24 = last_168[-24]
            lag_168 = last_168[-168]

            is_weekend = 1 if d.weekday() >= 5 else 0
            is_holiday = 1 if tr_holidays and d in tr_holidays else 0
            w_feat = get_weather_features_for_timestamp(weather_map, d) if weather_map else {"temp": 20.0, "humidity": 50.0, "wind_speed": 0.0, "cloud_cover": 0.0}
            t = w_feat.get("temp", 20.0)
            rh = w_feat.get("humidity", 50.0)
            thi = t - (0.55 - 0.0055 * rh) * (t - 14.5)

            row_base = [is_weekend, is_holiday, d.hour, t, rh, w_feat.get("wind_speed", 0.0), w_feat.get("cloud_cover", 0.0), thi]

            f_a = pd.DataFrame([row_base + [lag_1['y_aktif'], lag_24['y_aktif'], lag_168['y_aktif']]], columns=X_aktif.columns)
            f_k = pd.DataFrame([row_base + [lag_1['y_kapasitif'], lag_24['y_kapasitif'], lag_168['y_kapasitif']]], columns=X_kap.columns)
            f_e = pd.DataFrame([row_base + [lag_1['y_enduktif'], lag_24['y_enduktif'], lag_168['y_enduktif']]], columns=X_end.columns)

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

                kap_reason = f"{kap_cols[top_kap_idx]} ({round(shap_values_kap[top_kap_idx], 2)})"
                end_reason = f"{end_cols[top_end_idx]} ({round(shap_values_end[top_end_idx], 2)})"

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
    measurements = _load_measurements(db, transformer_id, limit=720)
    if len(measurements) < 168: return [], 0

    base_features = ['is_weekend', 'is_holiday', 'hour', 'temp']
    df, X_aktif, X_kap, X_end, weather_map, tr_holidays, future_dates = _prepare_training_data(
        db, measurements, steps, base_features
    )

    rf_aktif = RandomForestRegressor(n_estimators=100, max_depth=15, n_jobs=1, random_state=42).fit(X_aktif, df['y_aktif'])
    rf_kap   = RandomForestRegressor(n_estimators=100, max_depth=15, n_jobs=1, random_state=42).fit(X_kap, df['y_kapasitif'])
    rf_end   = RandomForestRegressor(n_estimators=100, max_depth=15, n_jobs=1, random_state=42).fit(X_end, df['y_enduktif'])

    # Hold-out güven skoru: kronolojik %80/%20 split
    confidence = _calculate_holdout_confidence(df, X_aktif, X_kap, X_end, rf_aktif, rf_kap, rf_end)

    preds = generate_predictions_from_model(
        rf_aktif, rf_kap, rf_end, df, steps, transformer_id, future_dates,
        "randomForest", weather_map, tr_holidays
    )
    return preds, confidence


def forecast_regression(db: Session, transformer_id: str, steps: int = 168):
    measurements = _load_measurements(db, transformer_id, limit=720)
    if len(measurements) < 168: return [], 0

    base_features = ['is_weekend', 'is_holiday', 'hour', 'temp']
    df, X_aktif, X_kap, X_end, weather_map, tr_holidays, future_dates = _prepare_training_data(
        db, measurements, steps, base_features
    )

    lr_aktif = LinearRegression().fit(X_aktif, df['y_aktif'])
    lr_kap   = LinearRegression().fit(X_kap, df['y_kapasitif'])
    lr_end   = LinearRegression().fit(X_end, df['y_enduktif'])

    # Hold-out güven skoru: kronolojik %80/%20 split
    confidence = _calculate_holdout_confidence(df, X_aktif, X_kap, X_end, lr_aktif, lr_kap, lr_end)

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
    ).order_by(models.Measurement.timestamp.desc()).limit(720).all()
    measurements.reverse()
    
    if len(measurements) < 48: return [], 0
    df = prepare_dataframe(measurements)
    
    last_date = df.index[-1]
    future_dates = [last_date + datetime.timedelta(hours=i) for i in range(1, steps + 1)]
    predictions = []
    
    confidence = 0
    try:
        hw_aktif = ExponentialSmoothing(df['y_aktif'], seasonal_periods=24, trend='add', seasonal='add', initialization_method="heuristic").fit()
        hw_kap = ExponentialSmoothing(df['y_kapasitif'], seasonal_periods=24, trend='add', seasonal='add', initialization_method="heuristic").fit()
        hw_end = ExponentialSmoothing(df['y_enduktif'], seasonal_periods=24, trend='add', seasonal='add', initialization_method="heuristic").fit()
        
        conf_a = calculate_confidence(df['y_aktif'], hw_aktif.fittedvalues)
        conf_k = calculate_confidence(df['y_kapasitif'], hw_kap.fittedvalues)
        conf_e = calculate_confidence(df['y_enduktif'], hw_end.fittedvalues)
        confidence = round((conf_a + conf_k + conf_e) / 3, 1)
        
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
    else:
        # ensemble
        rf_preds, rf_conf = forecast_random_forest(db, transformer_id, steps)
        hw_preds, hw_conf = forecast_holt_winters(db, transformer_id, steps)
        
        data = []
        for i in range(len(rf_preds)):
            if i < len(hw_preds):
                data.append({
                    "transformer_id": transformer_id,
                    "timestamp": rf_preds[i]["timestamp"],
                    "active_kwh": int((rf_preds[i]["active_kwh"] + hw_preds[i]["active_kwh"]) / 2),
                    "capacitive_kvarh": int((rf_preds[i]["capacitive_kvarh"] + hw_preds[i]["capacitive_kvarh"]) / 2),
                    "inductive_kvarh": int((rf_preds[i]["inductive_kvarh"] + hw_preds[i]["inductive_kvarh"]) / 2),
                    "is_forecast": True
                })
            else:
                data.append(rf_preds[i])
        confidence = round((rf_conf + hw_conf) / 2, 1) if rf_conf and hw_conf else (rf_conf or hw_conf or 90.0)
        
    result = {"predictions": data, "confidence_score": confidence}
    FORECAST_CACHE[cache_key] = (now, result)
    return result
