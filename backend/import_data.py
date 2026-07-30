import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import random
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import Session
from database import engine, SessionLocal
import models
import math

def setup_db():
    print("Dropping all existing tables...")
    models.Base.metadata.drop_all(bind=engine)
    print("Creating tables fresh...")
    models.Base.metadata.create_all(bind=engine)
    
    db: Session = SessionLocal()
    transformers = [
        models.Transformer(id="UMR-TRA", name="Ümraniye TM – TRA", region="Ümraniye", power_mva=100),
        models.Transformer(id="UMR-TRB", name="Ümraniye TM – TRB", region="Ümraniye", power_mva=100),
        models.Transformer(id="KRT-TRA", name="Kartal TM – TRA", region="Kartal", power_mva=80),
        models.Transformer(id="KRT-TRB", name="Kartal TM – TRB", region="Kartal", power_mva=80),
    ]
    db.add_all(transformers)
    db.commit()
    db.close()

def import_excel_2025():
    db: Session = SessionLocal()
    print("Reading Excel file...")
    df = pd.read_excel('../docs/TEİAŞ TM YÜKLERİ.xlsx')
    
    print(f"Loaded {len(df)} rows from Excel.")
    measurements = []
    
    trafo_map = {
        "ÜMRANİYE TRA": "UMR-TRA",
        "ÜMRANİYE TRB": "UMR-TRB",
        "KARTAL TRA": "KRT-TRA",
        "KARTAL TRB": "KRT-TRB"
    }
    
    batch_size = 5000
    for idx, row in df.iterrows():
        ts = row['CREATED_AT']
        if pd.isna(ts):
            continue
        
        if isinstance(ts, str):
            ts = datetime.strptime(ts, "%Y-%m-%d %H:%M:%S")
            
        for prefix, t_id in trafo_map.items():
            p_val = row.get(f"{prefix} (P)", 0)
            q_val = row.get(f"{prefix} (Q)", 0)
            
            if pd.isna(p_val): p_val = 0
            if pd.isna(q_val): q_val = 0
            
            active = max(0, int(p_val * 1000))
            inductive = int(q_val * 1000) if q_val > 0 else 0
            capacitive = int(abs(q_val) * 1000) if q_val < 0 else 0
            
            measurements.append(models.Measurement(
                transformer_id=t_id,
                timestamp=ts,
                active_kwh=active,
                inductive_kvarh=inductive,
                capacitive_kvarh=capacitive
            ))
            
        if len(measurements) >= batch_size:
            db.add_all(measurements)
            db.commit()
            measurements = []
            
    if measurements:
        db.add_all(measurements)
        db.commit()
        
    print("Excel import for 2025 completed!")
    db.close()

def generate_synthetic_2026():
    db: Session = SessionLocal()
    print("Generating synthetic data for 2026 up to current time...")
    
    transformers = db.query(models.Transformer).all()
    start_time = datetime(2026, 1, 1, 0, 0, 0)
    now = datetime.now().replace(minute=0, second=0, microsecond=0)
    
    if now < start_time:
        print("Current date is before 2026. Skipping synthetic generation.")
        db.close()
        return
        
    print("Pre-loading 2025 data for fast cloning...")
    start_2025 = datetime(2025, 1, 1, 0, 0, 0)
    end_2025 = datetime(2025, 12, 31, 23, 59, 59)
    hist_data = db.query(models.Measurement).filter(
        models.Measurement.timestamp >= start_2025,
        models.Measurement.timestamp <= end_2025
    ).all()
    
    # Create lookup dictionary (transformer_id, timestamp) -> measurement
    lookup = {}
    for m in hist_data:
        lookup[(m.transformer_id, m.timestamp)] = m
        
    print(f"Loaded {len(lookup)} historical records. Starting cloning...")
    
    delta_hours = int((now - start_time).total_seconds() / 3600)
    measurements = []
    batch_size = 5000
    
    for h in range(delta_hours + 1):
        current_ts = start_time + timedelta(hours=h)
        # Shift back exactly 364 days (52 weeks) to preserve day of week seasonality
        past_ts = current_ts - timedelta(days=364)
        
        for trafo in transformers:
            # Find the corresponding data in 2025
            hist_m = lookup.get((trafo.id, past_ts))
            
            if hist_m:
                # Add +/- 5% noise
                noise = random.uniform(0.95, 1.05)
                active = int(hist_m.active_kwh * noise)
                inductive = int(hist_m.inductive_kvarh * noise)
                capacitive = int(hist_m.capacitive_kvarh * noise)
            else:
                # Fallback if somehow missing
                active = random.randint(20000, 50000)
                inductive = int(active * 0.12)
                capacitive = int(active * 0.08)
                
            measurements.append(models.Measurement(
                transformer_id=trafo.id,
                timestamp=current_ts,
                active_kwh=active,
                inductive_kvarh=inductive,
                capacitive_kvarh=capacitive
            ))
            
        if len(measurements) >= batch_size:
            db.add_all(measurements)
            db.commit()
            measurements = []
            
    if measurements:
        db.add_all(measurements)
        db.commit()
        
    print(f"High-quality synthetic generation for {delta_hours} hours in 2026 completed!")
    db.close()

if __name__ == "__main__":
    setup_db()
    import_excel_2025()
    generate_synthetic_2026()
    print("All done!")
