from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
import schemas
from api.deps import get_db
from core.ws_handler import ws_manager
from services import scada_service

router = APIRouter(prefix='/scada')
@router.get("/state")
def get_scada_state_endpoint(db: Session = Depends(get_db)):
    return scada_service.generate_telemetry_snapshot(db)

@router.post("/breaker")
async def scada_toggle_breaker_endpoint(req: schemas.ScadaBreakerToggleRequest, db: Session = Depends(get_db)):
    res = scada_service.toggle_breaker(db, req.breaker_id, req.target_state, req.trafo_id or "UMR-TRA", req.reason or "SCADA Operatör Manevrası")
    snap = scada_service.generate_telemetry_snapshot(db)
    await ws_manager.broadcast({"type": "scada_telemetry", "data": snap})
    return res

@router.post("/alarm/ack")
async def scada_ack_alarm_endpoint(req: schemas.ScadaAlarmAckRequest, db: Session = Depends(get_db)):
    res = scada_service.ack_alarm(req.alarm_id)
    snap = scada_service.generate_telemetry_snapshot(db)
    await ws_manager.broadcast({"type": "scada_telemetry", "data": snap})
    return res

@router.get("/pandapower/trafos")
def get_pandapower_trafos():
    from services.grid_topology import topology_service
    return topology_service.get_trafos()

