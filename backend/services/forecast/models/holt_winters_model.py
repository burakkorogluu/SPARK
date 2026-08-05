import datetime
import logging
from sqlalchemy.orm import Session
from statsmodels.tsa.holtwinters import ExponentialSmoothing

import models
from services.forecast.data_prep import prepare_dataframe, calculate_confidence

logger = logging.getLogger("spark.forecast")

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
            confidence = 75.0

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
        logger.warning(
            f"Holt-Winters forecast failed for {transformer_id}: {exc}"
        )
    return predictions, confidence
