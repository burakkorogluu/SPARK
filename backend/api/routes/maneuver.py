from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import schemas
from db import models
from api.deps import get_db

router = APIRouter(prefix='/maneuver')
@router.get("/assets")
def get_maneuver_assets(db: Session = Depends(get_db)):
    trafos = db.query(models.Transformer).all()
    feeders = db.query(models.Feeder).all()
    reactors = db.query(models.Reactor).all()
    kuplajlar = db.query(models.Kuplaj).all()
    return {
        "kuplajlar": [
            {
                "id": k.id,
                "t1": k.t1,
                "t2": k.t2
            } for k in kuplajlar
        ],
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

@router.get("/suggest")
def get_maneuver_suggestions(db: Session = Depends(get_db)):
    from services.maneuver_service import analyze_and_suggest_maneuvers
    return analyze_and_suggest_maneuvers(db)

@router.post("/simulate")
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

@router.post("/apply")
def apply_maneuver_endpoint(
    req: schemas.ManeuverApplyRequest,
    db: Session = Depends(get_db)
):
    from services.maneuver_service import apply_maneuver
    try:
        log = apply_maneuver(
            db,
            req.asset_type,
            req.asset_id,
            req.target_trafo_id,
            reason=req.reason or "Manevra Ekranı Operatör Müdahalesi",
            override_overload=req.override_overload
        )
        return {"status": "success", "log_id": log.id}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/history", response_model=schemas.ManeuverHistoryResponse)
def get_maneuver_history_endpoint(
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db)
):
    from services.maneuver_service import get_maneuver_history
    return get_maneuver_history(db, limit=limit, offset=offset)

@router.post("/rollback/{log_id}")
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

@router.post("/transformer")
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

@router.post("/feeder")
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

@router.post("/reactor")
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

@router.post("/topology/bulk-update")
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

@router.delete("/feeder/{feeder_id}")
def delete_feeder_endpoint(feeder_id: str, db: Session = Depends(get_db)):
    from services.maneuver_service import delete_feeder
    success = delete_feeder(db, feeder_id)
    if not success:
        raise HTTPException(status_code=404, detail="Fider bulunamadı.")
    return {"status": "success", "message": "Fider başarıyla silindi."}

@router.delete("/reactor/{reactor_id}")
def delete_reactor_endpoint(reactor_id: str, db: Session = Depends(get_db)):
    from services.maneuver_service import delete_reactor
    success = delete_reactor(db, reactor_id)
    if not success:
        raise HTTPException(status_code=404, detail="Reaktör bulunamadı.")
    return {"status": "success", "message": "Reaktör başarıyla silindi."}

