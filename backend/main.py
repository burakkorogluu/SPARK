# pyrefly: ignore [missing-import]
from fastapi import FastAPI, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, UploadFile, File
# pyrefly: ignore [missing-import]
from fastapi.middleware.cors import CORSMiddleware
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import Session
# pyrefly: ignore [missing-import]
from apscheduler.schedulers.background import BackgroundScheduler
from db import models
import schemas
from db.database import engine, SessionLocal
from typing import List, Literal, Optional
from core.ws_handler import ws_manager
import pandas as pd
import io
FORECAST_METHODS = Literal["xgboost", "randomForest", "regression", "holtWinters", "ortalama", "persistence", "gecenAy", "ensemble", "lightgbm"]
from datetime import datetime, date
from core import simulator
from contextlib import asynccontextmanager
import os
import logging
from dotenv import load_dotenv
from services import scada_service

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
    from db import init_db
    init_db.seed_transformers()
    
    if os.getenv("TESTING") == "True":
        simulator_ready_event.set()
        yield
        return

    loop = asyncio.get_running_loop()
    
    def startup_data_generation():
        try:
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
        except Exception as e:
            print(f"Startup data generation failed: {e}")
        finally:
            loop.call_soon_threadsafe(simulator_ready_event.set)
            
            # Start seeding missing forecasts slowly in background to not block UI
            import threading
            from services.forecast.engine import seed_missing_forecasts
            threading.Thread(target=seed_missing_forecasts, daemon=True).start()

        
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
        
    try:
        await asyncio.wait_for(simulator_ready_event.wait(), timeout=30.0)
    except asyncio.TimeoutError:
        logger.error("Simulator ready event timed out (30s).")
        simulator_ready_event.set()
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


from api.main_router import api_router
app.include_router(api_router)
