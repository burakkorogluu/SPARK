from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy.orm import Session
from typing import List
import schemas
from db import models
from api.deps import get_db
from datetime import datetime
import pandas as pd
import io
import logging

logger = logging.getLogger('spark')

router = APIRouter(prefix='/osos')

def invalidate_caches_for_transformer(transformer_id: str):
    from services.forecast_service import FORECAST_CACHE, TRAINED_MODELS_CACHE
    forecast_keys = [k for k in FORECAST_CACHE.keys() if k.startswith(transformer_id)]
    for k in forecast_keys:
        del FORECAST_CACHE[k]
    model_keys = [k for k in TRAINED_MODELS_CACHE.keys() if k.startswith(transformer_id)]
    for k in model_keys:
        del TRAINED_MODELS_CACHE[k]

from fastapi.responses import JSONResponse

@router.get("/fetch")
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

    query = db.query(
        models.Measurement.id,
        models.Measurement.transformer_id,
        models.Measurement.timestamp,
        models.Measurement.active_kwh,
        models.Measurement.inductive_kvarh,
        models.Measurement.capacitive_kvarh
    ).filter(
        models.Measurement.timestamp >= start,
        models.Measurement.timestamp <= actual_end
    )
    if transformer_id:
        t_ids = [t.strip() for t in transformer_id.split(',')]
        query = query.filter(models.Measurement.transformer_id.in_(t_ids))
        
    measurements = query.order_by(models.Measurement.timestamp.asc()).all()
    
    res = [
        {
            "id": r[0],
            "transformer_id": r[1],
            "timestamp": r[2].isoformat() if hasattr(r[2], 'isoformat') else r[2],
            "active_kwh": r[3],
            "inductive_kvarh": r[4],
            "capacitive_kvarh": r[5]
        }
        for r in measurements
    ]
    return JSONResponse(content=res)

def invalidate_caches_for_transformer(transformer_id: str):
    from services.forecast_service import FORECAST_CACHE, TRAINED_MODELS_CACHE
    forecast_keys = [k for k in FORECAST_CACHE.keys() if k.startswith(transformer_id)]
    for k in forecast_keys:
        del FORECAST_CACHE[k]
    model_keys = [k for k in TRAINED_MODELS_CACHE.keys() if k.startswith(transformer_id)]
    for k in model_keys:
        del TRAINED_MODELS_CACHE[k]

@router.post("/measurements", response_model=schemas.Measurement)
def add_osos_measurement(
    measurement: schemas.MeasurementCreate,
    db: Session = Depends(get_db)
):
    existing = db.query(models.Measurement).filter(
        models.Measurement.transformer_id == measurement.transformer_id,
        models.Measurement.timestamp == measurement.timestamp
    ).first()

    if existing:
        existing.active_kwh = measurement.active_kwh  # type: ignore
        existing.inductive_kvarh = measurement.inductive_kvarh  # type: ignore
        existing.capacitive_kvarh = measurement.capacitive_kvarh  # type: ignore
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

@router.post("/measurements/bulk")
def add_osos_measurements_bulk(
    measurements: List[schemas.MeasurementCreate],
    db: Session = Depends(get_db)
):
    try:
        new_measurements = []
        updated_count = 0
        
        t_ids = list(set([m.transformer_id for m in measurements]))
        t_stamps = list(set([m.timestamp for m in measurements]))
        
        existing = db.query(models.Measurement).filter(
            models.Measurement.transformer_id.in_(t_ids),
            models.Measurement.timestamp.in_(t_stamps)
        ).all()
        
        existing_map = {(e.transformer_id, e.timestamp): e for e in existing}
        
        for m in measurements:
            key = (m.transformer_id, m.timestamp)
            if key in existing_map:
                e = existing_map[key]
                e.active_kwh = m.active_kwh
                e.inductive_kvarh = m.inductive_kvarh
                e.capacitive_kvarh = m.capacitive_kvarh
                updated_count += 1
            else:
                new_m = models.Measurement(
                    transformer_id=m.transformer_id,
                    timestamp=m.timestamp,
                    active_kwh=m.active_kwh,
                    inductive_kvarh=m.inductive_kvarh,
                    capacitive_kvarh=m.capacitive_kvarh
                )
                new_measurements.append(new_m)
                
        if new_measurements:
            db.add_all(new_measurements)
            
        db.commit()
        
        for t_id in t_ids:
            invalidate_caches_for_transformer(t_id)
            
        return {"status": "success", "message": f"{len(new_measurements)} inserted, {updated_count} updated."}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/measurements")
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

@router.post("/upload-excel")
async def upload_excel(file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not file.filename or not file.filename.endswith(('.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="Invalid file type. Only Excel files are accepted.")
    
    try:
        contents = await file.read()
        df = pd.read_excel(io.BytesIO(contents))
        
        # Check if first column exists
        if df.empty or len(df.columns) < 2:
            raise HTTPException(status_code=400, detail="Excel file is empty or invalid format.")
            
        measurements = []
        new_transformers = []
        
        import re
        # Sütunları 1. sütundan itibaren ikişer ikişer işle (Aktif, Reaktif)
        # 0. sütun Tarih sütunu
        for i in range(1, len(df.columns), 2):
            if i + 1 >= len(df.columns):
                break # Reaktif eşi yoksa atla
                
            col_p = df.columns[i]
            col_q = df.columns[i+1]
            
            # Başlıktan trafo adını çıkar (örn: "UMR-TRA Aktif" -> "UMR-TRA")
            trafo_name = col_p.replace(' (P)', '').replace(' Aktif', '').replace(' (Q)', '').replace(' Reaktif', '').strip()
            
            if not re.match(r"^[^<>]+$", trafo_name):
                raise HTTPException(status_code=400, detail=f"Geçersiz trafo adı (XSS şüphesi): {trafo_name}")
            
            # Trafo veritabanında var mı kontrol et
            trafo = db.query(models.Transformer).filter(models.Transformer.name == trafo_name).first()
            if not trafo:
                # Trafo ID'sini oluştur (boşlukları tire yap)
                trafo_id = trafo_name.replace(' ', '-').upper()
                if not re.match(r"^[a-zA-Z0-9_-]+$", trafo_id):
                    raise HTTPException(status_code=400, detail=f"Trafo adı geçerli değil: {trafo_name}")
                
                trafo = models.Transformer(
                    id=trafo_id,
                    name=trafo_name,
                    region="Bilinmiyor",
                    power_mva=100
                )
                db.add(trafo)
                # DO NOT FLUSH YET! To keep it in the same transaction cleanly.
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
                
                try:
                    active = max(0, int(p_val))
                    # Negatif reaktif = kapasitif, pozitif reaktif = endüktif
                    inductive = int(q_val) if q_val > 0 else 0
                    capacitive = int(abs(q_val)) if q_val < 0 else 0
                except (ValueError, TypeError):
                    raise HTTPException(status_code=400, detail=f"Satır {str(idx)} '{trafo_name}' için geçersiz sayısal değer.")
                
                measurements.append(models.Measurement(
                    transformer_id=trafo_id,
                    timestamp=ts,
                    active_kwh=active,
                    inductive_kvarh=inductive,
                    capacitive_kvarh=capacitive
                ))
                
        # Batch insert
        new_measurements = []
        updated_count = 0
        if measurements:
            t_ids = list(set([m.transformer_id for m in measurements]))
            t_stamps = list(set([m.timestamp for m in measurements]))
            existing = db.query(models.Measurement).filter(
                models.Measurement.transformer_id.in_(t_ids),
                models.Measurement.timestamp.in_(t_stamps)
            ).all()
            
            existing_map = {(e.transformer_id, e.timestamp): e for e in existing}
            
            for m in measurements:
                key = (m.transformer_id, m.timestamp)
                if key in existing_map:
                    e = existing_map[key]
                    e.active_kwh = m.active_kwh
                    e.inductive_kvarh = m.inductive_kvarh
                    e.capacitive_kvarh = m.capacitive_kvarh
                    updated_count += 1
                else:
                    new_measurements.append(m)
            
            batch_size = 5000
            for i in range(0, len(new_measurements), batch_size):
                db.add_all(new_measurements[i:i+batch_size])
                
        db.commit()
            
        # Cache'leri temizle
        unique_trafos = list(set([m.transformer_id for m in measurements]))
        for t_id in unique_trafos:
            invalidate_caches_for_transformer(t_id)
            
        return {
            "status": "success",
            "message": f"{len(new_measurements)} yeni veri eklendi, {updated_count} güncellendi.",
            "new_transformers": new_transformers
        }
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error importing excel: {str(e)}")
        raise HTTPException(status_code=500, detail=f"An error occurred while importing the Excel file: {str(e)}")


