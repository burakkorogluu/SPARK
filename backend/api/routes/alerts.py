from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import Optional
from api.deps import get_db

router = APIRouter(prefix='/alerts')
@router.get("")
def get_alerts_endpoint(limit: int = 20, year: Optional[int] = None, month: Optional[int] = None, db: Session = Depends(get_db)):
    print(f"API called: year={year}, month={month}")
    from services.alert_service import get_active_alerts
    return get_active_alerts(db, limit, year, month)

@router.post("/check")
def check_alerts_endpoint(year: Optional[int] = None, month: Optional[int] = None, db: Session = Depends(get_db)):
    from services.alert_service import check_and_generate_alerts, get_active_alerts
    check_and_generate_alerts(db, year, month)
    return get_active_alerts(db, limit=20, year=year, month=month)

