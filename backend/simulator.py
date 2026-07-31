import random
from datetime import datetime, timedelta
from typing import cast, Optional, Tuple
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import Session
from database import SessionLocal
import models
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def get_historical_baseline(db: Session, transformer_id: str, target_time: datetime) -> Optional[Tuple[int, int, int]]:
    """
    Looks back 52 weeks (364 days) to find real 2025 measurement data as baseline.
    Handles maintenance periods (where active_kwh <= 100) by searching back week-by-week up to 4 weeks.
    """
    ref_time = target_time - timedelta(days=364)
    for _ in range(4): # Check up to 4 weeks prior if maintenance (active_kwh <= 100)
        baseline = db.query(models.Measurement).filter(
            models.Measurement.transformer_id == transformer_id,
            models.Measurement.timestamp == ref_time
        ).first()
        
        if baseline and (baseline.active_kwh or 0) > 100:
            return cast(int, baseline.active_kwh), cast(int, baseline.inductive_kvarh), cast(int, baseline.capacitive_kvarh)
        
        ref_time -= timedelta(days=7)
        
    return None

ORIGINAL_FEEDER_MAPPING = {
    "FDR-UMR-1": {"trafo": "UMR-TRA", "weight": 1200.0},
    "FDR-UMR-2": {"trafo": "UMR-TRA", "weight": 850.0},
    "FDR-UMR-3": {"trafo": "UMR-TRB", "weight": 400.0},
    "FDR-KRT-1": {"trafo": "KRT-TRA", "weight": 950.0},
    "FDR-KRT-2": {"trafo": "KRT-TRB", "weight": 300.0},
}

ORIGINAL_TRAFO_WEIGHTS = {
    "UMR-TRA": 2050.0,
    "UMR-TRB": 400.0,
    "KRT-TRA": 950.0,
    "KRT-TRB": 300.0
}

ORIGINAL_REACTOR_COMPENSATION = {
    "UMR-TRA": 500.0,
    "UMR-TRB": 0.0,
    "KRT-TRA": 0.0,
    "KRT-TRB": 350.0
}

def generate_measurement_values(db: Session, trafo: models.Transformer, target_time: datetime) -> Tuple[int, int, int]:
    """
    Generates measurement values (active_kwh, inductive_kvarh, capacitive_kvarh)
    using historical 2025 baseline data if available, or falls back to random logic.
    Applies real-time scaling based on current topology (maneuvers).
    """
    current_feeders = db.query(models.Feeder).filter(models.Feeder.current_transformer_id == trafo.id).all()
    
    total_active = 0.0
    total_inductive = 0.0
    total_capacitive = 0.0
    
    baseline_cache = {}
    
    def get_trafo_baseline(t_id):
        if t_id in baseline_cache:
            return baseline_cache[t_id]
            
        baseline = get_historical_baseline(db, t_id, target_time)
        if baseline:
            b_active, b_inductive, b_capacitive = baseline
            noise = random.uniform(0.97, 1.03)  # ±3% natural variation noise
            res = (b_active * noise, b_inductive * noise, b_capacitive * noise)
        else:
            orig_trafo = db.query(models.Transformer).filter(models.Transformer.id == t_id).first()
            power_mva = float(cast(int, orig_trafo.power_mva)) if orig_trafo and orig_trafo.power_mva is not None else 100.0
            base_active = (power_mva / 100) * random.randint(20000, 50000)
            hour = target_time.hour
            if 0 <= hour < 7: multiplier = random.uniform(0.4, 0.6)
            elif 7 <= hour < 18: multiplier = random.uniform(0.9, 1.2)
            else: multiplier = random.uniform(0.7, 0.9)
            
            active = base_active * multiplier
            if t_id == "UMR-TRB":
                capacitive = active * random.uniform(0.12, 0.18)
                inductive = active * random.uniform(0.02, 0.08)
            else:
                inductive = active * random.uniform(0.10, 0.15)
                capacitive = active * random.uniform(0.02, 0.06)
            res = (active, inductive, capacitive)
            
        baseline_cache[t_id] = res
        return res

    # Aggregate physical loads from all currently connected feeders
    for feeder in current_feeders:
        mapping = ORIGINAL_FEEDER_MAPPING.get(str(feeder.id))
        if not mapping:
            continue
            
        orig_t_id = str(mapping["trafo"])
        orig_weight = ORIGINAL_TRAFO_WEIGHTS.get(orig_t_id, 1.0)
        
        b_act, b_ind, b_cap = get_trafo_baseline(orig_t_id)
        
        share = float(mapping["weight"]) / orig_weight if orig_weight > 0 else 0
        total_active += b_act * share
        total_inductive += b_ind * share
        total_capacitive += b_cap * share

    active = int(total_active)
    inductive = int(total_inductive)
    capacitive = int(total_capacitive)

    # Get current active reactor compensation
    current_reactors = db.query(models.Reactor).filter(
        models.Reactor.current_transformer_id == trafo.id,
        models.Reactor.status == "active"
    ).all()
    current_reactor_comp = sum(cast(float, r.capacity_kvar) for r in current_reactors)
    original_reactor_comp = ORIGINAL_REACTOR_COMPENSATION.get(str(trafo.id), 0.0)
    
    reactor_delta = current_reactor_comp - original_reactor_comp
    
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

    return active, inductive, capacitive

def generate_hourly_data():
    """
    Generates realistic hourly data for all active transformers.
    This simulates the TEIAS OSOS system gathering real-time data.
    """
    db: Session = SessionLocal()
    try:
        transformers = db.query(models.Transformer).filter(models.Transformer.status == "active").all()
        now = datetime.now()
        # Round to current hour (e.g. 14:32 -> 14:00)
        current_hour = now.replace(minute=0, second=0, microsecond=0)

        for trafo in transformers:
            # Find the last measurement timestamp for this transformer
            last_measurement = db.query(models.Measurement).filter(
                models.Measurement.transformer_id == trafo.id
            ).order_by(models.Measurement.timestamp.desc()).first()

            if last_measurement and last_measurement.timestamp < current_hour:
                start_hour = last_measurement.timestamp + timedelta(hours=1)
            elif not last_measurement:
                start_hour = current_hour
            else:
                start_hour = current_hour + timedelta(hours=1)  # Already up to date

            # Generate data for all missing hours up to current_hour
            temp_hour = start_hour
            while temp_hour <= current_hour:
                existing = db.query(models.Measurement).filter(
                    models.Measurement.transformer_id == trafo.id,
                    models.Measurement.timestamp == temp_hour
                ).first()

                if existing:
                    temp_hour += timedelta(hours=1)
                    continue

                active, inductive, capacitive = generate_measurement_values(db, trafo, cast(datetime, temp_hour))

                measurement = models.Measurement(
                    transformer_id=trafo.id,
                    timestamp=temp_hour,
                    active_kwh=active,
                    inductive_kvarh=inductive,
                    capacitive_kvarh=capacitive
                )
                db.add(measurement)

                # Gerçek veri geldiği için geçmişin tahminini sil
                db.query(models.ForecastMeasurement).filter(
                    models.ForecastMeasurement.transformer_id == trafo.id,
                    models.ForecastMeasurement.timestamp == temp_hour
                ).delete(synchronize_session=False)

                temp_hour += timedelta(hours=1)
        
        db.commit()
        logger.info(f"OSOS Simulation: Catch-up/Generated data up to {current_hour}")

    except Exception as e:
        logger.error(f"Error in OSOS Simulator: {e}")
        db.rollback()
    finally:
        db.close()

def generate_historical_data(days=30):
    """
    Generate past N days of data to populate the system initially.
    """
    db: Session = SessionLocal()
    try:
        transformers = db.query(models.Transformer).filter(models.Transformer.status == "active").all()
        # Start from current time so historical data is always up-to-date
        now = datetime.now()
        
        for d in range(days * 24, 0, -1):
            timestamp = now - timedelta(hours=d)
            
            for trafo in transformers:
                existing = db.query(models.Measurement).filter(
                    models.Measurement.transformer_id == trafo.id,
                    models.Measurement.timestamp == timestamp
                ).first()
                if existing:
                    continue

                active, inductive, capacitive = generate_measurement_values(db, trafo, timestamp)

                measurement = models.Measurement(
                    transformer_id=trafo.id,
                    timestamp=timestamp,
                    active_kwh=active,
                    inductive_kvarh=inductive,
                    capacitive_kvarh=capacitive
                )
                db.add(measurement)
                
                # Gerçek veri geldiği için geçmişin tahminini sil
                db.query(models.ForecastMeasurement).filter(
                    models.ForecastMeasurement.transformer_id == trafo.id,
                    models.ForecastMeasurement.timestamp == timestamp
                ).delete(synchronize_session=False)

        db.commit()
        logger.info(f"Generated historical data for the past {days} days.")
    except Exception as e:
        logger.error(f"Error generating historical data: {e}")
        db.rollback()
    finally:
        db.close()
