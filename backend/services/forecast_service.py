import pandas as pd
import numpy as np
# pyrefly: ignore [missing-source-for-stubs]
from sklearn.ensemble import RandomForestRegressor
# pyrefly: ignore [missing-source-for-stubs]
from sklearn.linear_model import LinearRegression
# pyrefly: ignore [missing-import, missing-source-for-stubs]
from statsmodels.tsa.holtwinters import ExponentialSmoothing
import datetime
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import Session
import models
import time
import calendar
import warnings

FORECAST_CACHE = {}
CACHE_TTL = 3600 # 1 hour
SIM_NOW = datetime.datetime.now()

def calculate_confidence(y_true, y_pred):
    """Calculates confidence score based on MAPE."""
    y_true, y_pred = np.array(y_true), np.array(y_pred)
    mask = y_true != 0
    if not np.any(mask):
        return 80 # fallback if no active values
    mape = np.mean(np.abs((y_true[mask] - y_pred[mask]) / y_true[mask])) * 100
    return max(0, min(100, 100 - mape))

def prepare_dataframe(measurements):
    df = pd.DataFrame([{
        "ds": m.timestamp,
        "y_aktif": m.active_kwh,
        "y_kapasitif": m.capacitive_kvarh,
        "y_enduktif": m.inductive_kvarh,
        "is_weekend": 1 if m.timestamp.weekday() >= 5 else 0,
        "hour": m.timestamp.hour
    } for m in measurements])
    df.sort_values(by="ds", inplace=True)
    df.set_index("ds", inplace=True)
    return df

def generate_predictions_from_model(model_aktif, model_kap, model_end, df, steps, transformer_id, future_dates, method_name="regression"):
    predictions = []
    last_24 = df[['y_aktif', 'y_kapasitif', 'y_enduktif']].tail(24).to_dict('records')
    
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for chunk_start in range(0, steps, 24):
            chunk_end = min(chunk_start + 24, steps)
            chunk_size = chunk_end - chunk_start
            feats = []
            for j in range(chunk_size):
                d = future_dates[chunk_start + j]
                lag = last_24[j]
                feats.append([
                    1 if d.weekday() >= 5 else 0,
                    d.hour,
                    lag['y_aktif'],
                    lag['y_kapasitif'],
                    lag['y_enduktif']
                ])
                
            pred_aktif = model_aktif.predict(feats)
            pred_kap = model_kap.predict(feats)
            pred_end = model_end.predict(feats)
            
            new_last_24 = []
            for j in range(chunk_size):
                date = future_dates[chunk_start + j]
                pa = max(0, pred_aktif[j])
                pk = max(0, pred_kap[j])
                pe = max(0, pred_end[j])
                
                predictions.append({
                    "transformer_id": transformer_id,
                    "timestamp": date.strftime("%Y-%m-%d %H:00:00"),
                    "active_kwh": pa,
                    "capacitive_kvarh": pk,
                    "inductive_kvarh": pe,
                    "is_forecast": True
                })
                new_last_24.append({
                    'y_aktif': pa,
                    'y_kapasitif': pk,
                    'y_enduktif': pe
                })
                
            if chunk_size == 24:
                last_24 = new_last_24
            else:
                last_24 = last_24[chunk_size:] + new_last_24

    return predictions


def forecast_random_forest(db: Session, transformer_id: str, steps: int = 168):
    measurements = db.query(models.Measurement).filter(
        models.Measurement.transformer_id == transformer_id,
        models.Measurement.timestamp <= SIM_NOW
    ).order_by(models.Measurement.timestamp.desc()).limit(720).all()
    measurements.reverse()
    
    if len(measurements) < 48: return [], 0
    df = prepare_dataframe(measurements)
    
    df['aktif_lag_24'] = df['y_aktif'].shift(24)
    df['kapasitif_lag_24'] = df['y_kapasitif'].shift(24)
    df['enduktif_lag_24'] = df['y_enduktif'].shift(24)
    df.dropna(inplace=True)
    
    X = df[['is_weekend', 'hour', 'aktif_lag_24', 'kapasitif_lag_24', 'enduktif_lag_24']]
    
    rf_aktif = RandomForestRegressor(n_estimators=15, max_depth=8, n_jobs=1, random_state=42).fit(X, df['y_aktif'])
    rf_kap = RandomForestRegressor(n_estimators=15, max_depth=8, n_jobs=1, random_state=42).fit(X, df['y_kapasitif'])
    rf_end = RandomForestRegressor(n_estimators=15, max_depth=8, n_jobs=1, random_state=42).fit(X, df['y_enduktif'])
    
    # Calculate real confidence
    conf_a = calculate_confidence(df['y_aktif'], rf_aktif.predict(X))
    conf_k = calculate_confidence(df['y_kapasitif'], rf_kap.predict(X))
    conf_e = calculate_confidence(df['y_enduktif'], rf_end.predict(X))
    confidence = round((conf_a + conf_k + conf_e) / 3, 1)
    
    last_date = df.index[-1]
    future_dates = [last_date + datetime.timedelta(hours=i) for i in range(1, steps + 1)]
    
    preds = generate_predictions_from_model(rf_aktif, rf_kap, rf_end, df, steps, transformer_id, future_dates, "randomForest")
    return preds, confidence


def forecast_regression(db: Session, transformer_id: str, steps: int = 168):
    measurements = db.query(models.Measurement).filter(
        models.Measurement.transformer_id == transformer_id,
        models.Measurement.timestamp <= SIM_NOW
    ).order_by(models.Measurement.timestamp.desc()).limit(720).all()
    measurements.reverse()
    
    if len(measurements) < 48: return [], 0
    df = prepare_dataframe(measurements)
    
    df['aktif_lag_24'] = df['y_aktif'].shift(24)
    df['kapasitif_lag_24'] = df['y_kapasitif'].shift(24)
    df['enduktif_lag_24'] = df['y_enduktif'].shift(24)
    df.dropna(inplace=True)
    
    X = df[['is_weekend', 'hour', 'aktif_lag_24', 'kapasitif_lag_24', 'enduktif_lag_24']]
    
    lr_aktif = LinearRegression().fit(X, df['y_aktif'])
    lr_kap = LinearRegression().fit(X, df['y_kapasitif'])
    lr_end = LinearRegression().fit(X, df['y_enduktif'])
    
    conf_a = calculate_confidence(df['y_aktif'], lr_aktif.predict(X))
    conf_k = calculate_confidence(df['y_kapasitif'], lr_kap.predict(X))
    conf_e = calculate_confidence(df['y_enduktif'], lr_end.predict(X))
    confidence = round((conf_a + conf_k + conf_e) / 3, 1)
    
    last_date = df.index[-1]
    future_dates = [last_date + datetime.timedelta(hours=i) for i in range(1, steps + 1)]
    
    preds = generate_predictions_from_model(lr_aktif, lr_kap, lr_end, df, steps, transformer_id, future_dates, "regression")
    return preds, confidence


def forecast_holt_winters(db: Session, transformer_id: str, steps: int = 168):
    measurements = db.query(models.Measurement).filter(
        models.Measurement.transformer_id == transformer_id,
        models.Measurement.timestamp <= SIM_NOW
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
    except Exception:
        pass
    return predictions, confidence


def forecast_ortalama(db: Session, transformer_id: str, steps: int = 168):
    measurements = db.query(models.Measurement).filter(
        models.Measurement.transformer_id == transformer_id,
        models.Measurement.timestamp <= SIM_NOW
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
    measurements = db.query(models.Measurement).filter(
        models.Measurement.transformer_id == transformer_id,
        models.Measurement.timestamp <= SIM_NOW
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
    measurements = db.query(models.Measurement).filter(
        models.Measurement.transformer_id == transformer_id,
        models.Measurement.timestamp <= SIM_NOW
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
    last_day = calendar.monthrange(year, month)[1]
    end_of_month = datetime.datetime(year, month, last_day, 23, 59, 59)
    
    last_m = db.query(models.Measurement).filter(
        models.Measurement.transformer_id == transformer_id,
        models.Measurement.timestamp <= SIM_NOW
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
    if method == "randomForest":
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
