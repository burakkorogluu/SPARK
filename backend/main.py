# pyrefly: ignore [missing-import]
from fastapi import FastAPI, Depends, HTTPException, Query
# pyrefly: ignore [missing-import]
from fastapi.middleware.cors import CORSMiddleware
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import Session
# pyrefly: ignore [missing-import]
from apscheduler.schedulers.background import BackgroundScheduler
import models
import schemas
from database import engine, SessionLocal
from typing import List
from datetime import datetime, date
import simulator
from contextlib import asynccontextmanager

models.Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Start scheduler
scheduler = BackgroundScheduler()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize DB & Seed Data
    import init_db
    init_db.seed_transformers()
    
    # Generate 10 days of historical data if it doesn't exist
    db = SessionLocal()
    count = db.query(models.Measurement).count()
    if count == 0:
        print("Generating historical data for the first time...")
        simulator.generate_historical_data(days=10)
    db.close()

    # Schedule the simulator to run every hour at minute 1
    scheduler.add_job(simulator.generate_hourly_data, 'cron', minute=1)
    scheduler.start()
    
    yield
    
    # Shutdown
    scheduler.shutdown()

app = FastAPI(title="SPARK TEIAS OSOS API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, restrict to frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/transformers", response_model=List[schemas.Transformer])
def get_transformers(db: Session = Depends(get_db)):
    return db.query(models.Transformer).all()

@app.get("/api/osos/fetch", response_model=List[schemas.Measurement])
def fetch_osos_measurements(
    transformer_id: str = Query(None, description="Optional filter by trafo ID"),
    start_date: str = Query(..., description="Start date YYYY-MM-DD"),
    end_date: str = Query(..., description="End date YYYY-MM-DD"),
    db: Session = Depends(get_db)
):
    try:
        start = datetime.strptime(start_date, "%Y-%m-%d")
        # End of the day
        end = datetime.strptime(end_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")

    SIM_NOW = datetime.now()
    actual_end = min(end, SIM_NOW)

    query = db.query(models.Measurement).filter(
        models.Measurement.timestamp >= start,
        models.Measurement.timestamp <= actual_end
    )
    if transformer_id:
        query = query.filter(models.Measurement.transformer_id == transformer_id)
        
    measurements = query.order_by(models.Measurement.timestamp.asc()).all()
    return measurements

@app.post("/api/osos/measurements", response_model=schemas.Measurement)
def add_osos_measurement(
    measurement: schemas.MeasurementCreate,
    db: Session = Depends(get_db)
):
    existing = db.query(models.Measurement).filter(
        models.Measurement.transformer_id == measurement.transformer_id,
        models.Measurement.timestamp == measurement.timestamp
    ).first()

    if existing:
        existing.active_kwh = measurement.active_kwh
        existing.inductive_kvarh = measurement.inductive_kvarh
        existing.capacitive_kvarh = measurement.capacitive_kvarh
        db.commit()
        db.refresh(existing)
        return existing
    else:
        new_m = models.Measurement(
            transformer_id=measurement.transformer_id,
            timestamp=measurement.timestamp,
            active_kwh=measurement.active_kwh,
            inductive_kvarh=measurement.inductive_kvarh,
            capacitive_kvarh=measurement.capacitive_kvarh
        )
        db.add(new_m)
        db.commit()
        db.refresh(new_m)
        return new_m

@app.delete("/api/osos/measurements")
def delete_osos_measurement(
    transformer_id: str = Query(..., description="Transformer ID"),
    timestamp: str = Query(..., description="Timestamp YYYY-MM-DD HH:MM:SS or YYYY-MM-DDTHH:MM:SS"),
    db: Session = Depends(get_db)
):
    try:
        if 'T' in timestamp:
            dt = datetime.fromisoformat(timestamp)
        elif len(timestamp) == 10:
            dt = datetime.strptime(timestamp, "%Y-%m-%d")
        else:
            dt = datetime.strptime(timestamp, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD HH:MM:SS")

    # Match exact timestamp or any timestamp starting on that date/hour if needed
    query = db.query(models.Measurement).filter(
        models.Measurement.transformer_id == transformer_id,
        models.Measurement.timestamp == dt
    )
    deleted_count = query.delete(synchronize_session=False)
    db.commit()

    if deleted_count == 0:
        raise HTTPException(status_code=404, detail="Measurement record not found")

    return {"status": "success", "message": f"{deleted_count} record(s) deleted."}

@app.get("/api/analysis/summary")
def get_analysis_summary(
    year: int = Query(..., description="Year"),
    month: int = Query(..., description="Month (1-12)"),
    transformer_id: str = Query(None, description="Optional filter by trafo ID"),
    db: Session = Depends(get_db)
):
    from services.analysis_service import get_monthly_summary
    return get_monthly_summary(db, year, month, transformer_id)

@app.get("/api/forecast")
def get_forecast(
    transformer_id: str = Query(..., description="Transformer ID"),
    year: int = Query(..., description="Target Year"),
    month: int = Query(..., description="Target Month"),
    method: str = Query("ensemble", description="ensemble, randomForest, holtWinters"),
    db: Session = Depends(get_db)
):
    from services.forecast_service import get_cached_forecast
    return get_cached_forecast(db, transformer_id, year, month, method)

@app.get("/api/maneuver/assets")
def get_maneuver_assets(db: Session = Depends(get_db)):
    feeders = db.query(models.Feeder).all()
    reactors = db.query(models.Reactor).all()
    return {
        "feeders": [
            {
                "id": f.id,
                "name": f.name,
                "current_transformer_id": f.current_transformer_id,
                "alternative_transformer_id": f.alternative_transformer_id,
                "simulated_load_kw": f.simulated_load_kw
            } for f in feeders
        ],
        "reactors": [
            {
                "id": r.id,
                "name": r.name,
                "current_transformer_id": r.current_transformer_id,
                "alternative_transformer_id": r.alternative_transformer_id,
                "capacity_kvar": r.capacity_kvar,
                "status": r.status
            } for r in reactors
        ]
    }

@app.get("/api/maneuver/suggest")
def get_maneuver_suggestions(db: Session = Depends(get_db)):
    from services.maneuver_service import analyze_and_suggest_maneuvers
    return analyze_and_suggest_maneuvers(db)

@app.post("/api/maneuver/apply")
def apply_maneuver_endpoint(
    asset_type: str = Query(..., description="feeder or reactor"),
    asset_id: str = Query(..., description="ID of the asset"),
    target_trafo_id: str = Query(..., description="Destination Transformer ID"),
    db: Session = Depends(get_db)
):
    from services.maneuver_service import apply_maneuver
    success = apply_maneuver(db, asset_type, asset_id, target_trafo_id)
    if not success:
        raise HTTPException(status_code=400, detail="Manevra uygulanamadı veya varlık bulunamadı.")
    return {"status": "success", "message": f"{asset_id} varlığı {target_trafo_id} trafosuna başarıyla aktarıldı."}

