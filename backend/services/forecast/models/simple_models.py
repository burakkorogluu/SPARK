import datetime
from sqlalchemy.orm import Session

import models
from services.forecast.data_prep import prepare_dataframe, calculate_confidence

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
        confidence = 78.0

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
