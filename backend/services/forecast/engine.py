import time
import datetime
import calendar
import logging
from sqlalchemy.orm import Session

from db import models
from services.forecast.cache_manager import FORECAST_CACHE, CACHE_TTL, _purge_expired_forecast_cache

from services.forecast.models.xgboost_model import forecast_xgboost
from services.forecast.models.random_forest_model import forecast_random_forest
from services.forecast.models.regression_model import forecast_regression
from services.forecast.models.lightgbm_model import forecast_lightgbm
from services.forecast.models.holt_winters_model import forecast_holt_winters
from services.forecast.models.simple_models import forecast_ortalama, forecast_persistence, forecast_gecen_ay
from services.forecast.models.ensemble import _build_ensemble

logger = logging.getLogger("spark.forecast")

from cachetools import TTLCache
import threading
RAW_FORECAST_CACHE = TTLCache(maxsize=10000, ttl=600)
RAW_FORECAST_CACHE_LOCK = threading.Lock()

def _run_raw_forecast_algorithm(db: Session, transformer_id: str, method: str, steps: int):
    cache_key = f"{transformer_id}_{method}_{steps}"
    with RAW_FORECAST_CACHE_LOCK:
        if cache_key in RAW_FORECAST_CACHE:
            return RAW_FORECAST_CACHE[cache_key]

    if method == "xgboost": preds, conf = forecast_xgboost(db, transformer_id, steps)
    elif method == "randomForest": preds, conf = forecast_random_forest(db, transformer_id, steps)
    elif method == "regression": preds, conf = forecast_regression(db, transformer_id, steps)
    elif method == "holtWinters": preds, conf = forecast_holt_winters(db, transformer_id, steps)
    elif method == "ortalama": preds, conf = forecast_ortalama(db, transformer_id, steps)
    elif method == "persistence": preds, conf = forecast_persistence(db, transformer_id, steps)
    elif method == "gecenAy": preds, conf = forecast_gecen_ay(db, transformer_id, steps)
    elif method == "lightgbm": preds, conf = forecast_lightgbm(db, transformer_id, steps)
    elif method == "ensemble":
        xgb_preds, xgb_conf = _run_raw_forecast_algorithm(db, transformer_id, "xgboost", steps)
        rf_preds, rf_conf = _run_raw_forecast_algorithm(db, transformer_id, "randomForest", steps)
        reg_preds, reg_conf = _run_raw_forecast_algorithm(db, transformer_id, "regression", steps)
        lgb_preds, lgb_conf = _run_raw_forecast_algorithm(db, transformer_id, "lightgbm", steps)
        preds, conf = _build_ensemble(xgb_preds, xgb_conf, rf_preds, rf_conf, reg_preds, reg_conf, lgb_preds, lgb_conf, transformer_id)
    else:
        preds, conf = [], 0
        
    with RAW_FORECAST_CACHE_LOCK:
        RAW_FORECAST_CACHE[cache_key] = (preds, conf)
    return preds, conf

def apply_topology_scaling_to_forecast(db: Session, transformer_id: str, method: str, steps: int):
    from core.simulator import ORIGINAL_FEEDER_MAPPING, ORIGINAL_TRAFO_WEIGHTS, ORIGINAL_REACTOR_COMPENSATION
    
    current_feeders = db.query(models.Feeder).filter(models.Feeder.current_transformer_id == transformer_id).all()
    
    raw_forecasts = {}
    
    def get_raw_forecast(t_id):
        if t_id not in raw_forecasts:
            preds, conf = _run_raw_forecast_algorithm(db, t_id, method, steps)
            raw_forecasts[t_id] = {"preds": preds, "conf": conf}
        return raw_forecasts[t_id]

    scaled_preds = []
    base_raw = get_raw_forecast(transformer_id)
    if not base_raw["preds"]:
        return [], 0
        
    current_reactors = db.query(models.Reactor).filter(
        models.Reactor.current_transformer_id == transformer_id,
        models.Reactor.status == "active"
    ).all()
    current_reactor_comp = int(sum(r.capacity_kvar for r in current_reactors))

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
                orig_weight = ORIGINAL_TRAFO_WEIGHTS.get(orig_t_id, float(mapping["weight"]))
                share = float(mapping["weight"]) / orig_weight if orig_weight > 0 else 0
            
            raw_f = get_raw_forecast(orig_t_id)
            if i < len(raw_f["preds"]):
                p = raw_f["preds"][i]
                p_active = p["active_kwh"]
                p_inductive = p["inductive_kvarh"]
                p_capacitive = p["capacitive_kvarh"]
                
                # Uncompensate original raw data by removing the effect of its original reactor
                orig_reactor_comp = int(ORIGINAL_REACTOR_COMPENSATION.get(orig_t_id, 0.0))
                if orig_reactor_comp > 0:
                    ind_reduction = min(p_inductive, orig_reactor_comp)
                    p_inductive -= ind_reduction
                    p_capacitive += (orig_reactor_comp - ind_reduction)
                
                total_active += p_active * share
                total_inductive += p_inductive * share
                total_capacitive += p_capacitive * share
                
                if p.get("kap_reason"): kap_reason = p["kap_reason"]
                if p.get("end_reason"): end_reason = p["end_reason"]
                
        active = int(total_active)
        inductive = int(total_inductive)
        capacitive = int(total_capacitive)
        
        # Apply the current transformer's reactors to the uncompensated total load
        if current_reactor_comp > 0:
            cap_reduction = min(capacitive, current_reactor_comp)
            capacitive -= cap_reduction
            inductive += (current_reactor_comp - cap_reduction)
            
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


def _run_forecast_algorithm(db: Session, transformer_id: str, method: str, steps: int):
    return apply_topology_scaling_to_forecast(db, transformer_id, method, steps)


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

    _purge_expired_forecast_cache()

    db_forecasts = db.query(models.ForecastMeasurement).filter(
        models.ForecastMeasurement.transformer_id == transformer_id,
        models.ForecastMeasurement.model_type == method,
        models.ForecastMeasurement.timestamp > last_m.timestamp,
        models.ForecastMeasurement.timestamp <= end_of_month
    ).order_by(models.ForecastMeasurement.timestamp.asc()).all()

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
        result = {"predictions": data, "confidence_score": confidence, "model_used": method}
        FORECAST_CACHE[cache_key] = (now, result)
        return result

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
            result = {
                "predictions": data,
                "confidence_score": confidence,
                "model_used": "xgboost",
                "requested_method": "ensemble",
            }
            FORECAST_CACHE[cache_key] = (now, result)
            return result

    data, confidence = apply_topology_scaling_to_forecast(db, transformer_id, method, steps)

    # Veritabanında eksik veri olduğu fark edildi, bu trafoya ait verileri arka planda hesaplayıp tabloyu doldurması için tetikliyoruz.
    import threading
    threading.Thread(target=run_weekly_batch_forecast, args=([transformer_id],)).start()

    result = {"predictions": data, "confidence_score": confidence, "model_used": method}
    FORECAST_CACHE[cache_key] = (now, result)
    return result


def _process_single_transformer_batch(t_id, methods, steps):
    from db.database import SessionLocal
    db = SessionLocal()
    try:
        all_new_rows = []
        succeeded_methods = []
        logger.info(f"Batch forecast uretimi basliyor: {t_id}")
        for m in methods:
            try:
                logger.info(f"Model hesaplaniyor: {t_id} - {m}")
                preds, conf = _run_forecast_algorithm(db, t_id, m, steps)
                
                for p in preds:
                    dt = datetime.datetime.strptime(p["timestamp"], "%Y-%m-%d %H:%M:%S")
                    fm = models.ForecastMeasurement(
                        transformer_id=t_id,
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
                succeeded_methods.append(m)
            except Exception as e:
                logger.error(f"{t_id} - {m} hatasi: {e}. Bu metodun onceki verisi silinmeyecek.")
        
        # SQLite db locking on delete retry loop
        import time
        max_retries = 3
        for retry in range(max_retries):
            try:
                if succeeded_methods:
                    db.query(models.ForecastMeasurement).filter(
                        models.ForecastMeasurement.transformer_id == t_id,
                        models.ForecastMeasurement.model_type.in_(succeeded_methods)
                    ).delete(synchronize_session=False)

                    db.add_all(all_new_rows)
                    db.commit()
                    logger.info(f"Batch forecast kaydedildi: {t_id} (Metotlar: {succeeded_methods})")
                else:
                    logger.warning(f"{t_id} icin hicbir metot basarili olmadi, veriler korunuyor.")
                break
            except Exception as e:
                db.rollback()
                if "database is locked" in str(e).lower() and retry < max_retries - 1:
                    logger.warning(f"{t_id} DB locked, retrying {retry+1}/{max_retries} in 2s...")
                    time.sleep(2)
                else:
                    logger.error(f"{t_id} DB kayit hatasi: {e}")
                    break
    finally:
        db.close()

_CURRENTLY_FORECASTING = set()

def run_weekly_batch_forecast(transformer_ids=None):
    from db.database import SessionLocal
    db = SessionLocal()
    try:
        if transformer_ids:
            transformers = db.query(models.Transformer).filter(models.Transformer.id.in_(transformer_ids)).all()
        else:
            transformers = db.query(models.Transformer).all()
        t_ids = [t.id for t in transformers]
    finally:
        db.close()
        
    methods = ["ensemble", "xgboost", "randomForest", "regression", "lightgbm"]
    steps = 720
    
    for t_id in t_ids:
        if t_id in _CURRENTLY_FORECASTING:
            logger.info(f"{t_id} is already being forecasted by another thread, skipping.")
            continue
        
        _CURRENTLY_FORECASTING.add(t_id)
        try:
            _process_single_transformer_batch(t_id, methods, steps)
        finally:
            _CURRENTLY_FORECASTING.remove(t_id)
        
    logger.info("Weekly batch forecast basariyla tamamlandi.")

def seed_missing_forecasts():
    import datetime
    import calendar
    from db import models
    from db.database import SessionLocal
    
    db = SessionLocal()
    try:
        trafos = db.query(models.Transformer).all()
        missing_trafos = []
        sim_now = datetime.datetime.now()
        year, month = sim_now.year, sim_now.month
        last_day = calendar.monthrange(year, month)[1]
        end_of_month = datetime.datetime(year, month, last_day, 23, 59, 59)
        
        for t in trafos:
            last_m = db.query(models.Measurement).filter(
                models.Measurement.transformer_id == t.id,
                models.Measurement.timestamp <= sim_now
            ).order_by(models.Measurement.timestamp.desc()).first()
            
            if not last_m:
                continue
                
            delta = end_of_month - last_m.timestamp
            steps = int(delta.total_seconds() / 3600)
            if steps <= 0: continue
            
            db_forecasts = db.query(models.ForecastMeasurement).filter(
                models.ForecastMeasurement.transformer_id == t.id,
                models.ForecastMeasurement.model_type == "ensemble",
                models.ForecastMeasurement.timestamp > last_m.timestamp,
                models.ForecastMeasurement.timestamp <= end_of_month
            ).count()
            
            if db_forecasts < (steps * 0.9):
                missing_trafos.append(t.id)
                
        if missing_trafos:
            logger.info(f"Eksik tahminler arka planda olusturuluyor: {missing_trafos}")
            run_weekly_batch_forecast(missing_trafos)
    except Exception as e:
        logger.error(f"Eksik tahmin uretim hatasi: {e}")
    finally:
        db.close()

