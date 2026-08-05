import math
import numpy as np
import pandas as pd
import datetime
import holidays
import logging
from sqlalchemy.orm import Session
import models
from services.weather_service import get_weather_data, get_weather_features_for_timestamp

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
    "aktif_lag_24": "Dünkü Aktif (Aynı Saat)",
    "aktif_lag_168": "Geçen Hafta Aktif (Aynı Saat)",
    "kapasitif_lag_24": "Dünkü Kapasitif (Aynı Saat)",
    "kapasitif_lag_168": "Geçen Hafta Kapasitif (Aynı Saat)",
    "enduktif_lag_24": "Dünkü Endüktif (Aynı Saat)",
    "enduktif_lag_168": "Geçen Hafta Endüktif (Aynı Saat)"
}

def calculate_confidence(y_true, y_pred):
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
        
        t = w_feat.get("temp", 20.0)
        rh = w_feat.get("humidity", 50.0)
        thi = t - (0.55 - 0.0055 * rh) * (t - 14.5) if t is not None else 20.0
        
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
            "wind_speed": w_feat.get("wind_speed", 0.0),
            "wind_direction": w_feat.get("wind_direction", 0.0),
            "precipitation": w_feat.get("precipitation", 0.0),
            "cloud_cover": w_feat.get("cloud_cover", 0.0),
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
    if len(vals) < 168:
        logger.warning(
            f"_extract_series_features: '{col_name}' icin sadece {len(vals)} nokta var "
            f"(168 bekleniyordu). lag_168 icin en eski deger kullanilacak (yaklasik deger)."
        )
    lag_24 = vals[-24] if len(vals) >= 24 else vals[0]
    lag_168 = vals[-168] if len(vals) >= 168 else vals[0]
    roll_24 = float(np.mean(vals[-24:]))
    roll_std_24 = float(np.std(vals[-24:], ddof=1)) if len(vals[-24:]) > 1 else 0.0
    diff_1 = vals[-1] - vals[-2] if len(vals) >= 2 else 0.0
    return [lag_24, lag_168, roll_24, roll_std_24, diff_1]

def _load_measurements(db: Session, transformer_id: str, limit: int = 0):
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
    if base_features is None:
        base_features = ['is_weekend', 'is_holiday', 'hour', 'day_of_week', 'sin_hour', 'cos_hour', 'sin_day', 'cos_day', 'temp', 'humidity', 'wind_speed', 'cloud_cover', 'thi']

    if not measurements:
        return None, None, None, None, None, None, None

    tr_holidays = holidays.country_holidays("TR", years=[
        measurements[0].timestamp.year,
        measurements[-1].timestamp.year,
        (measurements[-1].timestamp + datetime.timedelta(days=30)).year
    ])

    start_str = measurements[0].timestamp.strftime("%Y-%m-%d")
    end_str   = (measurements[-1].timestamp + datetime.timedelta(hours=steps)).strftime("%Y-%m-%d")
    weather_map = get_weather_data(start_str, end_str, db)

    df = prepare_dataframe(measurements, weather_map, tr_holidays)

    for c in ['aktif', 'kapasitif', 'enduktif']:
        col = f'y_{c}'
        mean_val = df[col].mean()
        std_val = df[col].std()
        if std_val > 0:
            df[col] = df[col].clip(lower=0, upper=mean_val + 4 * std_val)

    for c in ['aktif', 'kapasitif', 'enduktif']:
        df[f'{c}_lag_24']  = df[f'y_{c}'].shift(24)
        df[f'{c}_lag_168'] = df[f'y_{c}'].shift(168)
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
