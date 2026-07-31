# pyrefly: ignore [missing-import]
from fastapi import FastAPI, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, UploadFile, File
# pyrefly: ignore [missing-import]
from fastapi.middleware.cors import CORSMiddleware
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import Session
# pyrefly: ignore [missing-import]
from apscheduler.schedulers.background import BackgroundScheduler
import models
import schemas
from database import engine, SessionLocal
from typing import List, Literal, Optional
from ws_handler import ws_manager
import pandas as pd
import io
FORECAST_METHODS = Literal["xgboost", "randomForest", "regression", "holtWinters", "ortalama", "persistence", "gecenAy", "ensemble"]
from datetime import datetime, date
import simulator
from contextlib import asynccontextmanager
import os
import logging
from dotenv import load_dotenv

load_dotenv()  # .env dosyasındaki değişkenleri yükle

# Logging yapılandırması
log_level = getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO)
logging.basicConfig(
    level=log_level,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("spark")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Start scheduler
import asyncio

scheduler = BackgroundScheduler()

simulator_ready_event = asyncio.Event()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize DB & Seed Data
    import init_db
    init_db.seed_transformers()
    
    loop = asyncio.get_running_loop()
    
    def startup_data_generation():
        db = SessionLocal()
        try:
            count = db.query(models.Measurement).count()
            if count == 0:
                print("Generating historical data for the first time...")
                simulator.generate_historical_data(days=10)
        finally:
            db.close()
        # Catch up any missing hours between last run and now
        simulator.generate_hourly_data()
            
        loop.call_soon_threadsafe(simulator_ready_event.set)

        
    import threading
    threading.Thread(target=startup_data_generation, daemon=True).start()

    # Schedule the simulator to run every hour at minute 1
    scheduler.add_job(simulator.generate_hourly_data, 'cron', minute=1)

    # Schedule automatic system alert generation every hour at minute 5
    def run_alert_check_job():
        db_job = SessionLocal()
        try:
            from services.alert_service import check_and_generate_alerts
            check_and_generate_alerts(db_job)
        except Exception as err:
            print(f"Alert check job error: {err}")
        finally:
            db_job.close()
            
    scheduler.add_job(run_alert_check_job, 'cron', minute=5)

    # Schedule the batch forecast to run once a week (e.g., Sunday at 02:00)
    from services.forecast_service import run_weekly_batch_forecast
    scheduler.add_job(run_weekly_batch_forecast, 'cron', day_of_week='sun', hour=2, minute=0)
    
    scheduler.start()
    
    # SCADA Canlı Telemetri Broadcast Döngüsü (2 saniyede bir)
    async def scada_telemetry_loop():
        while True:
            await asyncio.sleep(2)
            if ws_manager.active_connections:
                db_sub = SessionLocal()
                try:
                    snap = scada_service.generate_telemetry_snapshot(db_sub)
                    await ws_manager.broadcast({"type": "scada_telemetry", "data": snap})
                except Exception as e:
                    logger.error(f"SCADA Telemetri Döngü Hatası: {e}")
                finally:
                    db_sub.close()

    telemetry_task = asyncio.create_task(scada_telemetry_loop())

    yield
    
    # Shutdown
    telemetry_task.cancel()
    scheduler.shutdown()

app = FastAPI(title="SPARK TEIAS OSOS API", lifespan=lifespan)

from fastapi import Request

@app.middleware("http")
async def wait_for_simulator(request: Request, call_next):
    # Eğer websocket isteği ise engelleme (SCADA telemetrisi vs. için)
    if request.url.path == "/ws" or request.url.path.startswith("/docs") or request.url.path.startswith("/openapi"):
        return await call_next(request)
        
    await simulator_ready_event.wait()
    response = await call_next(request)
    return response


# CORS: .env'den oku, varsayılan olarak geliştirme adreslerine izin ver
_cors_origins_raw = os.getenv("CORS_ORIGINS", "http://localhost:8080,http://localhost:8000,http://127.0.0.1:8080,http://127.0.0.1:8000")
cors_origins = [o.strip() for o in _cors_origins_raw.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
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
        if "T" in start_date:
            start = datetime.strptime(start_date, "%Y-%m-%dT%H:%M")
        else:
            start = datetime.strptime(start_date, "%Y-%m-%d")
            
        if "T" in end_date:
            end = datetime.strptime(end_date, "%Y-%m-%dT%H:%M")
        else:
            end = datetime.strptime(end_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD or YYYY-MM-DDTHH:MM")

    SIM_NOW = datetime.now()
    actual_end = min(end, SIM_NOW)

    query = db.query(models.Measurement).filter(
        models.Measurement.timestamp >= start,
        models.Measurement.timestamp <= actual_end
    )
    if transformer_id:
        t_ids = [t.strip() for t in transformer_id.split(',')]
        query = query.filter(models.Measurement.transformer_id.in_(t_ids))
        
    measurements = query.order_by(models.Measurement.timestamp.asc()).all()
    return measurements

def invalidate_caches_for_transformer(transformer_id: str):
    from services.forecast_service import FORECAST_CACHE, TRAINED_MODELS_CACHE
    forecast_keys = [k for k in FORECAST_CACHE.keys() if k.startswith(transformer_id)]
    for k in forecast_keys:
        del FORECAST_CACHE[k]
    model_keys = [k for k in TRAINED_MODELS_CACHE.keys() if k.startswith(transformer_id)]
    for k in model_keys:
        del TRAINED_MODELS_CACHE[k]

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
        existing.active_kwh = measurement.active_kwh  # pyrefly: ignore
        existing.inductive_kvarh = measurement.inductive_kvarh  # pyrefly: ignore
        existing.capacitive_kvarh = measurement.capacitive_kvarh  # pyrefly: ignore
        db.commit()
        db.refresh(existing)
        invalidate_caches_for_transformer(measurement.transformer_id)
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
        invalidate_caches_for_transformer(measurement.transformer_id)
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

    invalidate_caches_for_transformer(transformer_id)
    return {"status": "success", "message": f"{deleted_count} record(s) deleted."}

@app.post("/api/upload-excel")
async def upload_excel(file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not file.filename.endswith(('.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="Invalid file type. Only Excel files are accepted.")
    
    try:
        contents = await file.read()
        df = pd.read_excel(io.BytesIO(contents))
        
        # Check if first column exists
        if df.empty or len(df.columns) < 2:
            raise HTTPException(status_code=400, detail="Excel file is empty or invalid format.")
            
        measurements = []
        new_transformers = []
        
        # Sütunları 1. sütundan itibaren ikişer ikişer işle (Aktif, Reaktif)
        # 0. sütun Tarih sütunu
        for i in range(1, len(df.columns), 2):
            if i + 1 >= len(df.columns):
                break # Reaktif eşi yoksa atla
                
            col_p = df.columns[i]
            col_q = df.columns[i+1]
            
            # Başlıktan trafo adını çıkar (örn: "UMR-TRA Aktif" -> "UMR-TRA")
            # En basit yöntemle, son boşluktan önceki kısmı isim olarak alabiliriz veya "(P)", "(Q)" yi temizleyebiliriz.
            # "ÜMRANİYE TRA (P)" veya "ÜMRANİYE TRA Aktif" gibi olabilir.
            trafo_name = col_p.replace(' (P)', '').replace(' Aktif', '').replace(' (Q)', '').replace(' Reaktif', '').strip()
            
            # Trafo veritabanında var mı kontrol et
            trafo = db.query(models.Transformer).filter(models.Transformer.name == trafo_name).first()
            if not trafo:
                # Trafo ID'sini oluştur (boşlukları tire yap)
                trafo_id = trafo_name.replace(' ', '-').upper()
                trafo = models.Transformer(
                    id=trafo_id,
                    name=trafo_name,
                    region="Bilinmiyor",
                    power_mva=100
                )
                db.add(trafo)
                db.commit()
                db.refresh(trafo)
                new_transformers.append(trafo_name)
            else:
                trafo_id = trafo.id
                
            for idx, row in df.iterrows():
                ts = row.iloc[0]
                if pd.isna(ts):
                    continue
                    
                if isinstance(ts, str):
                    try:
                        ts = datetime.strptime(ts, "%Y-%m-%d %H:%M:%S")
                    except ValueError:
                        # try to parse just date or let pandas handle it
                        ts = pd.to_datetime(ts).to_pydatetime()
                elif isinstance(ts, pd.Timestamp):
                    ts = ts.to_pydatetime()
                    
                p_val = row.iloc[i]
                q_val = row.iloc[i+1]
                
                if pd.isna(p_val): p_val = 0
                if pd.isna(q_val): q_val = 0
                
                active = max(0, int(p_val))
                # Negatif reaktif = kapasitif, pozitif reaktif = endüktif
                inductive = int(q_val) if q_val > 0 else 0
                capacitive = int(abs(q_val)) if q_val < 0 else 0
                
                measurements.append(models.Measurement(
                    transformer_id=trafo_id,
                    timestamp=ts,
                    active_kwh=active,
                    inductive_kvarh=inductive,
                    capacitive_kvarh=capacitive
                ))
                
        # Batch insert
        if measurements:
            batch_size = 5000
            for i in range(0, len(measurements), batch_size):
                db.add_all(measurements[i:i+batch_size])
            db.commit()
            
        # Cache'leri temizle
        unique_trafos = list(set([m.transformer_id for m in measurements]))
        for t_id in unique_trafos:
            invalidate_caches_for_transformer(t_id)
            
        return {
            "status": "success",
            "message": f"Successfully imported {len(measurements)} records.",
            "new_transformers": new_transformers
        }
    except Exception as e:
        logger.error(f"Error importing excel: {str(e)}")
        raise HTTPException(status_code=500, detail=f"An error occurred while importing the Excel file: {str(e)}")


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
    method: FORECAST_METHODS = Query("ensemble", description="xgboost, randomForest, regression, holtWinters, ortalama, persistence, gecenAy, ensemble"),
    db: Session = Depends(get_db)
):
    from services.forecast_service import get_cached_forecast
    return get_cached_forecast(db, transformer_id, year, month, method)

@app.get("/api/maneuver/assets")
def get_maneuver_assets(db: Session = Depends(get_db)):
    trafos = db.query(models.Transformer).all()
    feeders = db.query(models.Feeder).all()
    reactors = db.query(models.Reactor).all()
    return {
        "transformers": [
            {
                "id": t.id,
                "name": t.name,
                "region": t.region,
                "power_mva": t.power_mva,
                "status": t.status,
                "pos_x": t.pos_x,
                "pos_y": t.pos_y
            } for t in trafos
        ],
        "feeders": [
            {
                "id": f.id,
                "name": f.name,
                "current_transformer_id": f.current_transformer_id,
                "alternative_transformer_id": f.alternative_transformer_id,
                "simulated_load_kw": f.simulated_load_kw,
                "pos_x": f.pos_x,
                "pos_y": f.pos_y
            } for f in feeders
        ],
        "reactors": [
            {
                "id": r.id,
                "name": r.name,
                "current_transformer_id": r.current_transformer_id,
                "alternative_transformer_id": r.alternative_transformer_id,
                "capacity_kvar": r.capacity_kvar,
                "status": r.status,
                "pos_x": r.pos_x,
                "pos_y": r.pos_y
            } for r in reactors
        ]
    }

@app.get("/api/maneuver/suggest")
def get_maneuver_suggestions(db: Session = Depends(get_db)):
    from services.maneuver_service import analyze_and_suggest_maneuvers
    return analyze_and_suggest_maneuvers(db)

@app.post("/api/maneuver/simulate")
def simulate_maneuver_endpoint(
    asset_type: str,
    asset_id: str,
    target_trafo_id: str,
    db: Session = Depends(get_db)
):
    from services.maneuver_service import simulate_maneuver
    try:
        res = simulate_maneuver(db, asset_type, asset_id, target_trafo_id)
        if not res:
            raise HTTPException(status_code=404, detail="Manevra simülasyonu başarısız. Varlık veya trafo bulunamadı.")
        return res
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/maneuver/apply")
def apply_maneuver_endpoint(
    req: schemas.ManeuverApplyRequest,
    db: Session = Depends(get_db)
):
    from services.maneuver_service import apply_maneuver
    try:
        return apply_maneuver(
            db,
            req.asset_type,
            req.asset_id,
            req.target_trafo_id,
            reason=req.reason or "Manevra Ekranı Operatör Müdahalesi",
            override_overload=req.override_overload
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/maneuver/history", response_model=schemas.ManeuverHistoryResponse)
def get_maneuver_history_endpoint(
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db)
):
    from services.maneuver_service import get_maneuver_history
    return get_maneuver_history(db, limit=limit, offset=offset)

@app.post("/api/maneuver/rollback/{log_id}")
def rollback_maneuver_endpoint(
    log_id: int,
    db: Session = Depends(get_db)
):
    from services.maneuver_service import rollback_maneuver
    log = rollback_maneuver(db, log_id)
    if not log:
        raise HTTPException(status_code=400, detail="Geri alma başarısız. Log bulunamadı veya zaten geri alınmış.")
    return {
        "status": "success",
        "message": f"{log.asset_name} manevrasının geri alınması başarılı. Orijinal durum geri yüklendi.",
        "log_id": log.id
    }

@app.post("/api/maneuver/transformer")
def create_transformer_endpoint(
    trafo_data: schemas.TransformerCreate,
    db: Session = Depends(get_db)
):
    from services.maneuver_service import create_transformer
    trafo = create_transformer(db, trafo_data)
    if not trafo:
        raise HTTPException(status_code=400, detail="Trafo oluşturulamadı. ID zaten mevcut.")
    return {
        "status": "success",
        "message": f"'{trafo.name}' trafosu başarıyla oluşturuldu.",
        "transformer": {
            "id": trafo.id,
            "name": trafo.name,
            "region": trafo.region,
            "power_mva": trafo.power_mva,
            "status": trafo.status,
            "pos_x": trafo.pos_x,
            "pos_y": trafo.pos_y
        }
    }

@app.post("/api/maneuver/feeder")
def create_feeder_endpoint(
    feeder_data: schemas.FeederCreate,
    db: Session = Depends(get_db)
):
    from services.maneuver_service import create_feeder
    feeder = create_feeder(db, feeder_data)
    if not feeder:
        raise HTTPException(status_code=400, detail="Fider oluşturulamadı. ID zaten mevcut veya trafo bulunamadı.")
    return {
        "status": "success",
        "message": f"'{feeder.name}' fideri başarıyla oluşturuldu.",
        "feeder": {
            "id": feeder.id,
            "name": feeder.name,
            "current_transformer_id": feeder.current_transformer_id,
            "alternative_transformer_id": feeder.alternative_transformer_id,
            "simulated_load_kw": feeder.simulated_load_kw,
            "pos_x": feeder.pos_x,
            "pos_y": feeder.pos_y
        }
    }

@app.post("/api/maneuver/reactor")
def create_reactor_endpoint(
    reactor_data: schemas.ReactorCreate,
    db: Session = Depends(get_db)
):
    from services.maneuver_service import create_reactor
    reactor = create_reactor(db, reactor_data)
    if not reactor:
        raise HTTPException(status_code=400, detail="Reaktör oluşturulamadı. ID zaten mevcut veya trafo bulunamadı.")
    return {
        "status": "success",
        "message": f"'{reactor.name}' reaktörü başarıyla oluşturuldu.",
        "reactor": {
            "id": reactor.id,
            "name": reactor.name,
            "current_transformer_id": reactor.current_transformer_id,
            "alternative_transformer_id": reactor.alternative_transformer_id,
            "capacity_kvar": reactor.capacity_kvar,
            "status": reactor.status,
            "pos_x": reactor.pos_x,
            "pos_y": reactor.pos_y
        }
    }

@app.post("/api/maneuver/topology/bulk-update")
def bulk_update_topology_endpoint(
    bulk_data: schemas.TopologyBulkUpdateRequest,
    db: Session = Depends(get_db)
):
    from services.maneuver_service import bulk_update_topology
    result = bulk_update_topology(db, bulk_data)
    return {
        "status": "success",
        "message": "Topoloji değişiklikleri ve konumlar başarıyla kaydedildi.",
        "result": result
    }

@app.delete("/api/maneuver/feeder/{feeder_id}")
def delete_feeder_endpoint(feeder_id: str, db: Session = Depends(get_db)):
    from services.maneuver_service import delete_feeder
    success = delete_feeder(db, feeder_id)
    if not success:
        raise HTTPException(status_code=404, detail="Fider bulunamadı.")
    return {"status": "success", "message": "Fider başarıyla silindi."}

@app.delete("/api/maneuver/reactor/{reactor_id}")
def delete_reactor_endpoint(reactor_id: str, db: Session = Depends(get_db)):
    from services.maneuver_service import delete_reactor
    success = delete_reactor(db, reactor_id)
    if not success:
        raise HTTPException(status_code=404, detail="Reaktör bulunamadı.")
    return {"status": "success", "message": "Reaktör başarıyla silindi."}

@app.get("/api/alerts")
def get_alerts_endpoint(limit: int = 20, db: Session = Depends(get_db)):
    from services.alert_service import get_active_alerts
    return get_active_alerts(db, limit)

@app.post("/api/alerts/check")
def check_alerts_endpoint(year: Optional[int] = None, month: Optional[int] = None, db: Session = Depends(get_db)):
    from services.alert_service import check_and_generate_alerts, get_active_alerts
    check_and_generate_alerts(db, year, month)
    return get_active_alerts(db)

@app.get("/api/models/evaluate")
def evaluate_models_endpoint(transformer_id: str = Query(..., description="Transformer ID"), steps: int = 168, db: Session = Depends(get_db)):
    from services.model_eval_service import evaluate_all_models
    return evaluate_all_models(db, transformer_id, steps)

from services import scada_service

@app.get("/api/scada/state")
def get_scada_state_endpoint(db: Session = Depends(get_db)):
    return scada_service.generate_telemetry_snapshot(db)

@app.post("/api/scada/breaker")
async def scada_toggle_breaker_endpoint(req: schemas.ScadaBreakerToggleRequest, db: Session = Depends(get_db)):
    res = scada_service.toggle_breaker(db, req.breaker_id, req.target_state, req.trafo_id or "UMR-TRA", req.reason or "SCADA Operatör Manevrası")
    snap = scada_service.generate_telemetry_snapshot(db)
    await ws_manager.broadcast({"type": "scada_telemetry", "data": snap})
    return res

@app.post("/api/scada/alarm/ack")
async def scada_ack_alarm_endpoint(req: schemas.ScadaAlarmAckRequest, db: Session = Depends(get_db)):
    res = scada_service.ack_alarm(req.alarm_id)
    snap = scada_service.generate_telemetry_snapshot(db)
    await ws_manager.broadcast({"type": "scada_telemetry", "data": snap})
    return res

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            await ws_manager.broadcast({"type": "ping", "data": data})
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)

