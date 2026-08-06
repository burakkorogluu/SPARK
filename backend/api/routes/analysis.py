from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from api.deps import get_db

router = APIRouter(prefix='/analysis')
@router.get("/summary")
def get_analysis_summary(
    year: int = Query(..., description="Year"),
    month: int = Query(..., description="Month (1-12)"),
    transformer_id: str = Query(None, description="Optional filter by trafo ID"),
    db: Session = Depends(get_db)
):
    from services.analysis_service import get_monthly_summary
    return get_monthly_summary(db, year, month, transformer_id)

