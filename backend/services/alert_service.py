# pyrefly: ignore [missing-import]
from typing import Optional
from sqlalchemy.orm import Session
import models
from services.analysis_service import get_monthly_summary
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

    for item in summaries:
        trafo_id = item["trafo"]["id"]
        trafo_name = item["trafo"]["adi"]
        ozet = item["ozet"]
        kap_oran = ozet.get("kapasitifOran", 0)
        end_oran = ozet.get("enduktifOran", 0)

        # Kapasitif ceza sınırı aşımı (%15)
        if kap_oran >= 15.0:
            msg = f"{trafo_name} ({trafo_id}) trafosunda kapasitif oran %{kap_oran:.2f} ile %15 EPDK ceza sınırını AŞTI!"
            alert = models.SystemAlert(
                transformer_id=trafo_id,
                alert_type="capacitive_penalty",
                severity="critical",
                message=msg
            )
            db.add(alert)
            generated.append(alert)
            logger.warning(msg)

        # Endüktif ceza sınırı aşımı (%20)
        elif end_oran >= 20.0:
            msg = f"{trafo_name} ({trafo_id}) trafosunda endüktif oran %{end_oran:.2f} ile %20 EPDK ceza sınırını AŞTI!"
            alert = models.SystemAlert(
                transformer_id=trafo_id,
                alert_type="inductive_penalty",
                severity="critical",
                message=msg
            )
            db.add(alert)
            generated.append(alert)
            logger.warning(msg)

        # Kapasitif uyarı eşiği (%12)
        elif kap_oran >= 12.0:
            msg = f"{trafo_name} ({trafo_id}) trafosunda kapasitif oran %{kap_oran:.2f} ile dikkat eşiğine (%12) ulaştı."
            alert = models.SystemAlert(
                transformer_id=trafo_id,
                alert_type="warning",
                severity="warning",
                message=msg
            )
            db.add(alert)
            generated.append(alert)

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
