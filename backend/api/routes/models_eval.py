from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from api.deps import get_db

router = APIRouter(prefix='/models')
@router.get("/evaluate")
def evaluate_models_endpoint(transformer_id: str = Query(..., description="Transformer ID"), steps: int = 168, db: Session = Depends(get_db)):
    from services.model_eval_service import evaluate_all_models
    return evaluate_all_models(db, transformer_id, steps)

from services import scada_service

