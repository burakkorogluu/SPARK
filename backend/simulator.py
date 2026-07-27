import random
from datetime import datetime, timedelta
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import Session
from database import SessionLocal
import models
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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
            # Check if we already have data for this hour to avoid duplicates
            existing = db.query(models.Measurement).filter(
                models.Measurement.transformer_id == trafo.id,
                models.Measurement.timestamp == current_hour
            ).first()

            if existing:
                continue

            # Simulate base loads depending on power_mva
            # e.g., 100 MVA trafo -> active energy roughly around 20,000 - 50,000 kWh per hour
            base_active = (trafo.power_mva / 100) * random.randint(20000, 50000)
            
            # Simulate daily load curve (lower at night, higher during day)
            hour = current_hour.hour
            if 0 <= hour < 7:
                multiplier = random.uniform(0.4, 0.6)
            elif 7 <= hour < 18:
                multiplier = random.uniform(0.9, 1.2)
            else:
                multiplier = random.uniform(0.7, 0.9)

            active = int(base_active * multiplier)

            # Inductive is typically 10-15% of active
            inductive = int(active * random.uniform(0.10, 0.15))

            # Capacitive is typically 5-10% of active, but sometimes spikes (e.g., UMR-TRB)
            if trafo.id == "UMR-TRB":
                capacitive = int(active * random.uniform(0.12, 0.18)) # high risk
            else:
                capacitive = int(active * random.uniform(0.05, 0.10))

            measurement = models.Measurement(
                transformer_id=trafo.id,
                timestamp=current_hour,
                active_kwh=active,
                inductive_kvarh=inductive,
                capacitive_kvarh=capacitive
            )
            db.add(measurement)
        
        db.commit()
        logger.info(f"OSOS Simulation: Generated data for {len(transformers)} transformers at {current_hour}")

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
        # SPARK User specifically works with July 2025 data
        now = datetime(2025, 7, 22, 14, 0, 0)
        
        for d in range(days * 24, 0, -1):
            timestamp = now - timedelta(hours=d)
            
            for trafo in transformers:
                existing = db.query(models.Measurement).filter(
                    models.Measurement.transformer_id == trafo.id,
                    models.Measurement.timestamp == timestamp
                ).first()
                if existing:
                    continue

                base_active = (trafo.power_mva / 100) * random.randint(20000, 50000)
                hour = timestamp.hour
                if 0 <= hour < 7:
                    multiplier = random.uniform(0.4, 0.6)
                elif 7 <= hour < 18:
                    multiplier = random.uniform(0.9, 1.2)
                else:
                    multiplier = random.uniform(0.7, 0.9)

                active = int(base_active * multiplier)
                inductive = int(active * random.uniform(0.10, 0.15))
                if trafo.id == "UMR-TRB":
                    capacitive = int(active * random.uniform(0.12, 0.18))
                else:
                    capacitive = int(active * random.uniform(0.05, 0.10))

                measurement = models.Measurement(
                    transformer_id=trafo.id,
                    timestamp=timestamp,
                    active_kwh=active,
                    inductive_kvarh=inductive,
                    capacitive_kvarh=capacitive
                )
                db.add(measurement)
        db.commit()
        logger.info(f"Generated historical data for the past {days} days.")
    except Exception as e:
        logger.error(f"Error generating historical data: {e}")
        db.rollback()
    finally:
        db.close()
