from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Literal
from api.deps import get_db

FORECAST_METHODS = Literal['xgboost', 'holtWinters', 'ortalama', 'persistence', 'gecenAy', 'ensemble', 'lightgbm']

router = APIRouter(prefix='/forecast')
@router.get("")
def get_forecast(
    transformer_id: str = Query(..., description="Transformer ID"),
    year: int = Query(..., description="Target Year"),
    month: int = Query(..., description="Target Month"),
    method: FORECAST_METHODS = Query("ensemble", description="xgboost, lightgbm, ensemble, holtWinters, ortalama, persistence, gecenAy"),
    db: Session = Depends(get_db)
):
    from services.forecast_service import get_cached_forecast
    return get_cached_forecast(db, transformer_id, year, month, method)

