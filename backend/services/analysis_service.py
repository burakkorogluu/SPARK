# pyrefly: ignore [missing-import]
from sqlalchemy.orm import Session
import models
from datetime import datetime
from typing import List, Dict, Optional

SINIRLAR = {
    "kapasitif": 15.0, # Yasal Sınır %15
    "enduktif": 20.0,
    "kapasitifUyari": 12.0,
    "enduktifUyari": 16.0
}

def hesapla_risk_durumu(aktif: int, kapasitif: int, enduktif: int):
    oran_kapasitif = (kapasitif / max(1, aktif)) * 100
    oran_enduktif = (enduktif / max(1, aktif)) * 100
    
    if oran_kapasitif >= SINIRLAR["kapasitif"]:
        return "tehlikeli", oran_kapasitif
    elif oran_kapasitif >= SINIRLAR["kapasitifUyari"]:
        return "riskli", oran_kapasitif
    elif oran_kapasitif >= (SINIRLAR["kapasitifUyari"] - 2):
        return "dikkat", oran_kapasitif
    return "guvenli", oran_kapasitif

def process_measurements(measurements: List[models.Measurement]) -> List[Dict]:
    processed = []
    # measurements are assumed to be sorted by timestamp asc
    cumulative_active = {}
    cumulative_inductive = {}
    cumulative_capacitive = {}
    
    for m in measurements:
        tid = m.transformer_id
        if tid not in cumulative_active:
            cumulative_active[tid] = 0
            cumulative_inductive[tid] = 0
            cumulative_capacitive[tid] = 0
            
        cumulative_active[tid] += m.active_kwh
        cumulative_inductive[tid] += m.inductive_kvarh
        cumulative_capacitive[tid] += m.capacitive_kvarh
        
        c_aktif = cumulative_active[tid]
        c_ind = cumulative_inductive[tid]
        c_cap = cumulative_capacitive[tid]
        
        # Hourly ratios
        oran_kapasitif = (m.capacitive_kvarh / max(1, m.active_kwh)) * 100
        oran_enduktif = (m.inductive_kvarh / max(1, m.active_kwh)) * 100
        
        # Cumulative ratios
        kum_kapasitif = (c_cap / max(1, c_aktif)) * 100
        kum_enduktif = (c_ind / max(1, c_aktif)) * 100
        
        # Risk levels based on cumulative (or hourly? Usually cumulative determines the penalty)
        risk_level, _ = hesapla_risk_durumu(c_aktif, c_cap, c_ind)
        
        processed.append({
            "id": m.id,
            "timestamp": m.timestamp,
            "transformer_id": m.transformer_id,
            "active_kwh": m.active_kwh,
            "inductive_kvarh": m.inductive_kvarh,
            "capacitive_kvarh": m.capacitive_kvarh,
            "kapasitifOran": round(oran_kapasitif, 2),
            "enduktifOran": round(oran_enduktif, 2),
            "kumulatifKapasitifOran": round(kum_kapasitif, 2),
            "kumulatifEnduktifOran": round(kum_enduktif, 2),
            "riskDurumu": risk_level
        })
        
    return processed

def get_monthly_summary(db: Session, year: int, month: int, transformer_id: Optional[str] = None) -> List[Dict]:
    """
    Returns monthly summary for all transformers or a specific one.
    """
    SIM_NOW = datetime.now()
    query = db.query(models.Measurement).filter(models.Measurement.timestamp <= SIM_NOW)
    if transformer_id:
        query = query.filter(models.Measurement.transformer_id == transformer_id)
        
    measurements = query.all()
    
    # Filter by month and year in Python (or use extract in SQLAlchemy, but this is simple enough for small scale)
    filtered = [m for m in measurements if m.timestamp.year == year and m.timestamp.month == month]
    
    # Group by transformer
    t_groups = {}
    for m in filtered:
        tid = m.transformer_id
        if tid not in t_groups:
            t_groups[tid] = {"aktif": 0, "enduktif": 0, "kapasitif": 0, "gunSayisi": 0}
        t_groups[tid]["aktif"] += m.active_kwh
        t_groups[tid]["enduktif"] += m.inductive_kvarh
        t_groups[tid]["kapasitif"] += m.capacitive_kvarh
        # simple distinct day count approximation (this is hourly data)
        # We will divide by 24 roughly below or just count days properly
        
    results = []
    
    # Calculate proper distinct days per trafo
    for tid in t_groups.keys():
        trafo_measurements = [m for m in filtered if m.transformer_id == tid]
        unique_days = len(set([m.timestamp.date() for m in trafo_measurements]))
        t_groups[tid]["gunSayisi"] = unique_days
    
    for tid, data in t_groups.items():
        aktif = data["aktif"]
        enduktif = data["enduktif"]
        kapasitif = data["kapasitif"]
        
        seviye, oran_kapasitif = hesapla_risk_durumu(aktif, kapasitif, enduktif)
        
        trafo_info = db.query(models.Transformer).filter(models.Transformer.id == tid).first()
        
        results.append({
            "trafo": {
                "id": trafo_info.id,
                "adi": trafo_info.name,
                "bolge": trafo_info.region,
                "kapasite": trafo_info.power_mva
            },
            "ozet": {
                "toplamAktif": aktif,
                "toplamEnduktif": enduktif,
                "toplamKapasitif": kapasitif,
                "kapasitifOran": oran_kapasitif,
                "enduktifOran": (enduktif / max(1, aktif)) * 100,
                "kapasitifRisk": {
                    "seviye": seviye
                },
                "gunSayisi": data["gunSayisi"]
            }
        })
        
    return results
