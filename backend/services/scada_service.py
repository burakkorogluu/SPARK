# backend/scada_service.py
"""
SCADA Canlı Telemetri ve Kontrol Servisi
"""
import random
import math
from datetime import datetime
from sqlalchemy.orm import Session
import models

# In-memory SCADA Breaker ve Şebeke Durumu
SCADA_BREAKER_STATES = {
    "t101-q1": True,  # True: Kapalı (Akım geçiyor), False: Açık (Kesilmiş)
    "t102-q1": True,
    "f1": True,
    "f2": True,
    "f3": True,
    "f4": True,
    "f5": True,
    "f6": True,
    "f7": False
}

SCADA_ALARMS = [
    {"id": "k1", "label": "Yangın İhbar K1", "active": False},
    {"id": "k2", "label": "Yangın İhbar K2", "active": False},
    {"id": "k3", "label": "Yangın İhbar K3", "active": False},
    {"id": "nn1", "label": "Yangın İhbar AG1", "active": False},
    {"id": "nn2", "label": "Yangın İhbar AG2", "active": False},
    {"id": "vn1", "label": "Yangın İhbar OG1", "active": True},
    {"id": "vn2", "label": "Yangın İhbar OG2", "active": False},
    {"id": "vn3", "label": "Yangın İhbar OG3", "active": False}
]

def get_scada_state():
    return {
        "breakers": SCADA_BREAKER_STATES,
        "alarms": SCADA_ALARMS
    }

def toggle_breaker(db: Session, breaker_id: str, target_state: bool, trafo_id: str = "UMR-TRA", reason: str = "SCADA Operatör Manevrası"):
    old_state = SCADA_BREAKER_STATES.get(breaker_id, False)
    SCADA_BREAKER_STATES[breaker_id] = target_state
    
    # Manevrayı veritabanına kaydet (ManeuverLog)
    action_text = "Kesici Kapatıldı (Enerji Verildi)" if target_state else "Kesici Açıldı (Enerji Kesildi)"
    
    trafo = db.query(models.Transformer).filter(models.Transformer.id == trafo_id).first()
    trafo_name = trafo.name if trafo else trafo_id
    
    log = models.ManeuverLog(
        timestamp=datetime.now(),
        action_type="scada_breaker_toggle",
        asset_type="breaker",
        asset_id=breaker_id,
        asset_name=f"Kesici Hücresi {breaker_id.upper()}",
        source_trafo_id=trafo_id,
        target_trafo_id=trafo_id,
        source_trafo_name=trafo_name,
        target_trafo_name=trafo_name,
        reason=f"SCADA Ekranı Kontrolü: {action_text}. Gerekçe: {reason}",
        impact_level="Yüksek" if "q1" in breaker_id else "Orta",
        status="applied"
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    
    return {
        "success": True,
        "breaker_id": breaker_id,
        "new_state": target_state,
        "maneuver_id": log.id,
        "message": f"{breaker_id.upper()} {action_text} ve Manevra Loglarına Kaydedildi."
    }

def ack_alarm(alarm_id: str):
    for alarm in SCADA_ALARMS:
        if alarm["id"] == alarm_id:
            alarm["active"] = not alarm["active"]
            return {"success": True, "alarm_id": alarm_id, "active": alarm["active"]}
    return {"success": False, "message": "Alarm bulunamadı"}

def generate_telemetry_snapshot(db: Session):
    """
    Tüm trafolar için o anki SCADA canlı telemetrisini hesaplar.
    """
    trafos = db.query(models.Transformer).all()
    telemetry = {}
    
    for t in trafos:
        # Trafo Q1 kesicisi kapalı mı?
        # Basit eşleştirme: UMR-TRA -> t101-q1, UMR-TRB -> t102-q1
        is_q1_closed = SCADA_BREAKER_STATES.get("t101-q1", True) if "TRA" in t.id else SCADA_BREAKER_STATES.get("t102-q1", True)
        
        if is_q1_closed:
            pmva = getattr(t, "power_mva", None)
            base_mva = float(pmva if pmva is not None else 80)
            # %45-%65 arası rastgele yüklenme + küçük sinüs dalgalanması
            load_factor = 0.5 + (0.1 * math.sin(datetime.now().second / 5.0)) + (random.uniform(-0.02, 0.02))
            
            kw = base_mva * 1000 * load_factor
            kvar = kw * (0.18 + random.uniform(-0.01, 0.01))
            kv = 22.8 + random.uniform(-0.1, 0.1)
            a = kw / (math.sqrt(3) * kv)
        else:
            kw = 0.0
            kvar = 0.0
            kv = 22.5 + random.uniform(-0.05, 0.05)
            a = 0.0
            
        telemetry[t.id] = {
            "trafo_id": t.id,
            "trafo_name": t.name,
            "kw": round(kw, 1),
            "kvar": round(kvar, 1),
            "kv": round(kv, 2),
            "a": round(a, 1)
        }
        
    return {
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "telemetry": telemetry,
        "breakers": SCADA_BREAKER_STATES,
        "alarms": SCADA_ALARMS
    }
