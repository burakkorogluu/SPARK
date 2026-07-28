# pyrefly: ignore [missing-import]
from sqlalchemy.orm import Session
# pyrefly: ignore [missing-import]
from sqlalchemy import extract
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
    Optimized: filtering is done at DB level via SQLAlchemy extract(), and
    aggregation is done in a single pass per transformer.
    """
    sim_now = datetime.now()

    # DB-level year/month filter — avoids loading all measurements into Python
    query = db.query(models.Measurement).filter(
        models.Measurement.timestamp <= sim_now,
        extract("year",  models.Measurement.timestamp) == year,
        extract("month", models.Measurement.timestamp) == month,
    )
    if transformer_id:
        query = query.filter(models.Measurement.transformer_id == transformer_id)

    measurements = query.all()

    # Single-pass aggregation per transformer
    t_groups: Dict[str, Dict] = {}
    for m in measurements:
        tid = m.transformer_id
        if tid not in t_groups:
            t_groups[tid] = {
                "aktif": 0,
                "enduktif": 0,
                "kapasitif": 0,
                "gun_seti": set()   # distinct day tracking
            }
        g = t_groups[tid]
        g["aktif"]    += m.active_kwh
        g["enduktif"] += m.inductive_kvarh
        g["kapasitif"] += m.capacitive_kvarh
        g["gun_seti"].add(m.timestamp.date())

    results = []
    for tid, data in t_groups.items():
        aktif    = data["aktif"]
        enduktif = data["enduktif"]
        kapasitif = data["kapasitif"]
        gun_sayisi = len(data["gun_seti"])

        seviye, oran_kapasitif = hesapla_risk_durumu(aktif, kapasitif, enduktif)

        trafo_info = db.query(models.Transformer).filter(models.Transformer.id == tid).first()
        if not trafo_info:
            continue

        results.append({
            "trafo": {
                "id":      trafo_info.id,
                "adi":     trafo_info.name,
                "bolge":   trafo_info.region,
                "kapasite": trafo_info.power_mva
            },
            "ozet": {
                "toplamAktif":    aktif,
                "toplamEnduktif": enduktif,
                "toplamKapasitif": kapasitif,
                "kapasitifOran":  oran_kapasitif,
                "enduktifOran":   (enduktif / max(1, aktif)) * 100,
                "kapasitifRisk":  {"seviye": seviye},
                "gunSayisi":      gun_sayisi
            }
        })

    return results
