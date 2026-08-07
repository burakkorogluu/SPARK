from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List
import schemas
from db import models
from api.deps import get_db

router = APIRouter()
@router.get("/transformers", response_model=List[schemas.Transformer])
def get_transformers(db: Session = Depends(get_db)):
    return db.query(models.Transformer).all()

@router.delete("/transformers/{transformer_id}")
def delete_transformer(transformer_id: str, db: Session = Depends(get_db)):
    trafo = db.query(models.Transformer).filter(models.Transformer.id == transformer_id).first()
    if not trafo:
        raise HTTPException(status_code=404, detail="Trafo bulunamadı")
    
    # İlgili tüm kayıtları sil
    db.query(models.Measurement).filter(models.Measurement.transformer_id == transformer_id).delete()
    db.query(models.SystemAlert).filter(models.SystemAlert.transformer_id == transformer_id).delete()
    db.query(models.ForecastMeasurement).filter(models.ForecastMeasurement.transformer_id == transformer_id).delete()
    
    # Manevra kayıtları (source veya target olabilir)
    db.query(models.ManeuverLog).filter(
        (models.ManeuverLog.source_trafo_id == transformer_id) | 
        (models.ManeuverLog.target_trafo_id == transformer_id)
    ).delete()

    # Fider ve Reaktörleri sil
    db.query(models.Feeder).filter(models.Feeder.current_transformer_id == transformer_id).delete()
    db.query(models.Feeder).filter(models.Feeder.alternative_transformer_id == transformer_id).delete()
    
    db.query(models.Reactor).filter(models.Reactor.current_transformer_id == transformer_id).delete()
    db.query(models.Reactor).filter(models.Reactor.alternative_transformer_id == transformer_id).delete()
    
    db.delete(trafo)
    db.commit()
    return {"status": "success", "message": f"{transformer_id} başarıyla silindi"}

