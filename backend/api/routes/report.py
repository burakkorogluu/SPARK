from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import extract, func
from api.deps import get_db
from db import models
from datetime import datetime, date
import calendar
import logging

logger = logging.getLogger("spark.report")

router = APIRouter(prefix="/report")


@router.get("/summary")
def get_report_summary(
    transformer_id: str = Query(..., description="Trafo ID"),
    year: int = Query(..., description="Yıl"),
    month: int = Query(..., description="Ay (1-12)"),
    db: Session = Depends(get_db),
):
    """
    Seçilen trafo ve ay için kapsamlı rapor verisi döndürür:
    - Trafo bilgisi
    - Aylık özet (aktif/kapasitif/endüktif oranlar, risk)
    - Günlük veriler
    - Manevra geçmişi (o ay)
    - Alarm geçmişi (o ay)
    """
    # ─── Trafo bilgisi ───
    trafo = db.query(models.Transformer).filter(models.Transformer.id == transformer_id).first()
    if not trafo:
        raise HTTPException(status_code=404, detail=f"Trafo bulunamadı: {transformer_id}")

    sim_now = datetime.now()

    # ─── Aylık özet ───
    from services.analysis_service import get_monthly_summary, hesapla_risk_durumu
    ozet_list = get_monthly_summary(db, year, month, transformer_id)
    ozet = ozet_list[0]["ozet"] if ozet_list else None

    # ─── Günlük veriler ───
    _, last_day = calendar.monthrange(year, month)
    period_start = datetime(year, month, 1)
    period_end = min(datetime(year, month, last_day, 23, 59, 59), sim_now)

    daily_rows = (
        db.query(
            func.date(models.Measurement.timestamp).label("tarih"),
            func.sum(models.Measurement.active_kwh).label("aktif"),
            func.sum(models.Measurement.capacitive_kvarh).label("kapasitif"),
            func.sum(models.Measurement.inductive_kvarh).label("enduktif"),
        )
        .filter(
            models.Measurement.transformer_id == transformer_id,
            models.Measurement.timestamp >= period_start,
            models.Measurement.timestamp <= period_end,
        )
        .group_by(func.date(models.Measurement.timestamp))
        .order_by(func.date(models.Measurement.timestamp).asc())
        .all()
    )

    gunluk_veriler = []
    for row in daily_rows:
        aktif = row.aktif or 0
        kap = row.kapasitif or 0
        end = row.enduktif or 0
        kap_oran = round((kap / aktif * 100) if aktif > 0 else 0.0, 2)
        end_oran = round((end / aktif * 100) if aktif > 0 else 0.0, 2)
        seviye, _, _, kap_sev, end_sev = hesapla_risk_durumu(aktif, kap, end)
        gunluk_veriler.append({
            "tarih": str(row.tarih),
            "aktif": aktif,
            "kapasitif": kap,
            "enduktif": end,
            "kapasitifOran": kap_oran,
            "enduktifOran": end_oran,
            "riskSeviye": seviye,
        })

    # ─── Manevra geçmişi (o ay) ───
    manevra_rows = (
        db.query(models.ManeuverLog)
        .filter(
            extract("year", models.ManeuverLog.timestamp) == year,
            extract("month", models.ManeuverLog.timestamp) == month,
        )
        .order_by(models.ManeuverLog.timestamp.desc())
        .all()
    )

    manevra_gecmisi = [
        {
            "id": m.id,
            "timestamp": m.timestamp.isoformat() if m.timestamp else None,
            "assetType": m.asset_type,
            "assetId": m.asset_id,
            "assetName": m.asset_name,
            "sourceTrafoId": m.source_trafo_id,
            "sourceTrafoName": m.source_trafo_name,
            "targetTrafoId": m.target_trafo_id,
            "targetTrafoName": m.target_trafo_name,
            "reason": m.reason,
            "impactLevel": m.impact_level,
            "status": m.status,
        }
        for m in manevra_rows
    ]

    # ─── Alarm geçmişi (o ay, seçilen trafo) ───
    alarm_rows = (
        db.query(models.SystemAlert)
        .filter(
            models.SystemAlert.transformer_id == transformer_id,
            extract("year", models.SystemAlert.timestamp) == year,
            extract("month", models.SystemAlert.timestamp) == month,
        )
        .order_by(models.SystemAlert.timestamp.desc())
        .all()
    )

    alarm_gecmisi = [
        {
            "id": a.id,
            "timestamp": a.timestamp.isoformat() if a.timestamp else None,
            "alertType": a.alert_type,
            "severity": a.severity,
            "message": a.message,
        }
        for a in alarm_rows
    ]

    return {
        "trafo": {
            "id": trafo.id,
            "adi": trafo.name,
            "bolge": trafo.region,
            "kapasite": trafo.power_mva,
        },
        "donem": {"yil": year, "ay": month},
        "ozet": ozet,
        "gunlukVeriler": gunluk_veriler,
        "manevraGecmisi": manevra_gecmisi,
        "alarmGecmisi": alarm_gecmisi,
    }
