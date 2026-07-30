# pyrefly: ignore [missing-import]
from typing import Optional
from sqlalchemy.orm import Session
import models
from services.analysis_service import get_monthly_summary, SINIRLAR
from datetime import datetime
import logging

logger = logging.getLogger("spark.alerts")

def check_and_generate_alerts(db: Session, year: Optional[int] = None, month: Optional[int] = None):
    """
    Trafoların ay sonu durumunu analiz edip ceza sınırı veya uyarı eşiği aşımında 
    otomatik sistem alarmları üretir.
    """
    now = datetime.now()
    req_year = year if year is not None else now.year
    req_month = month if month is not None else now.month

    summaries = get_monthly_summary(db, req_year, req_month)
    generated = []

    start_of_month = datetime(req_year, req_month, 1)
    if req_month == 12:
        end_of_month = datetime(req_year + 1, 1, 1)
    else:
        end_of_month = datetime(req_year, req_month + 1, 1)

    for item in summaries:
        trafo_id = item["trafo"]["id"]
        trafo_name = item["trafo"]["adi"]
        ozet = item["ozet"]
        kap_oran = ozet.get("kapasitifOran", 0)
        end_oran = ozet.get("enduktifOran", 0)

        def _add_or_update_alert(alert_type, severity, msg):
            existing = db.query(models.SystemAlert).filter(
                models.SystemAlert.transformer_id == trafo_id,
                models.SystemAlert.alert_type == alert_type,
                models.SystemAlert.timestamp >= start_of_month,
                models.SystemAlert.timestamp < end_of_month
            ).first()
            
            if existing:
                existing.timestamp = datetime.now()
                existing.message = msg
            else:
                alert = models.SystemAlert(
                    transformer_id=trafo_id,
                    alert_type=alert_type,
                    severity=severity,
                    message=msg
                )
                db.add(alert)
                generated.append(alert)

        # Kapasitif ceza sınırı aşımı (%15)
        if kap_oran >= SINIRLAR["kapasitif"]:
            msg = f"{trafo_name} ({trafo_id}) trafosunda kapasitif oran %{kap_oran:.2f} ile %{SINIRLAR['kapasitif']:.0f} EPDK ceza sınırını AŞTI!"
            _add_or_update_alert("capacitive_penalty", "critical", msg)
            logger.warning(msg)
        elif kap_oran >= SINIRLAR["kapasitifUyari"]:
            msg = f"{trafo_name} ({trafo_id}) trafosunda kapasitif oran %{kap_oran:.2f} ile dikkat eşiğine (%{SINIRLAR['kapasitifUyari']:.0f}) ulaştı."
            _add_or_update_alert("capacitive_warning", "warning", msg)

        # Endüktif ceza sınırı aşımı (%20)
        if end_oran >= SINIRLAR["enduktif"]:
            msg = f"{trafo_name} ({trafo_id}) trafosunda endüktif oran %{end_oran:.2f} ile %{SINIRLAR['enduktif']:.0f} EPDK ceza sınırını AŞTI!"
            _add_or_update_alert("inductive_penalty", "critical", msg)
            logger.warning(msg)
        elif end_oran >= SINIRLAR["enduktifUyari"]:
            msg = f"{trafo_name} ({trafo_id}) trafosunda endüktif oran %{end_oran:.2f} ile dikkat eşiğine (%{SINIRLAR['enduktifUyari']:.0f}) ulaştı."
            _add_or_update_alert("inductive_warning", "warning", msg)

    db.commit()
    return generated


def get_active_alerts(db: Session, limit: int = 20):
    """Veritabanındaki son sistem alarmlarını döndürür."""
    alerts = db.query(models.SystemAlert).order_by(models.SystemAlert.timestamp.desc()).limit(limit).all()
    return [
        {
            "id": a.id,
            "timestamp": a.timestamp.strftime("%Y-%m-%d %H:%M:%S"),
            "transformer_id": a.transformer_id,
            "alert_type": a.alert_type,
            "severity": a.severity,
            "message": a.message,
            "is_read": a.is_read
        }
        for a in alerts
    ]
