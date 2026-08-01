# pyrefly: ignore [missing-import]
from sqlalchemy.orm import Session
# pyrefly: ignore [missing-import]
from sqlalchemy import extract
import models
from datetime import datetime
from typing import List, Dict, Optional, Tuple
import logging

logger = logging.getLogger("spark.analysis")

# ─── EPDK Yasal Sınır Değerleri ───────────────────────────────────────────
SINIRLAR = {
    "kapasitif":       15.0,   # %15 — EPDK yasal sınırı
    "enduktif":        20.0,   # %20 — EPDK yasal sınırı
    "kapasitifUyari":  12.0,   # Uyarı eşiği
    "enduktifUyari":   16.0,   # Uyarı eşiği
    "kapasitifDikkat": 10.0,   # Dikkat eşiği
    "enduktifDikkat":  12.0,   # Dikkat eşiği
}

# Risk seviye sıralaması — karşılaştırma için
_RISK_SIRA = {"guvenli": 0, "dikkat": 1, "riskli": 2, "tehlikeli": 3}


def _seviye_kapasitif(oran: float) -> str:
    """Kapasitif orana göre risk seviyesini döndürür."""
    if oran >= SINIRLAR["kapasitif"]:
        return "tehlikeli"
    elif oran >= SINIRLAR["kapasitifUyari"]:
        return "riskli"
    elif oran >= SINIRLAR["kapasitifDikkat"]:
        return "dikkat"
    return "guvenli"


def _seviye_enduktif(oran: float) -> str:
    """Endüktif orana göre risk seviyesini döndürür."""
    if oran >= SINIRLAR["enduktif"]:
        return "tehlikeli"
    elif oran >= SINIRLAR["enduktifUyari"]:
        return "riskli"
    elif oran >= SINIRLAR["enduktifDikkat"]:
        return "dikkat"
    return "guvenli"


def hesapla_risk_durumu(
    aktif: float, kapasitif: float, enduktif: float
) -> Tuple[str, float, float, str, str]:
    """
    Her iki reaktif güç bileşenini (kapasitif + endüktif) değerlendirerek
    genel risk seviyesini döndürür.

    Dönüş: (genel_seviye, kap_oran, end_oran, kap_seviye, end_seviye)
    - genel_seviye: "en kötü durum kazanır" prensibi (tehlikeli > riskli > dikkat > guvenli)
    - kap_oran / end_oran: hesaplanan yüzde oranları
    - kap_seviye / end_seviye: her bileşenin ayrı risk seviyesi
    """
    oran_kapasitif = (kapasitif / aktif * 100) if aktif > 0 else (999.0 if kapasitif > 0 else 0.0)
    oran_enduktif  = (enduktif  / aktif * 100) if aktif > 0 else (999.0 if enduktif > 0 else 0.0)

    kap_seviye = _seviye_kapasitif(oran_kapasitif)
    end_seviye = _seviye_enduktif(oran_enduktif)

    # "En kötü durum kazanır" — sistemin asıl tehdidi doğru yakalaması için
    genel_seviye = (
        kap_seviye if _RISK_SIRA[kap_seviye] >= _RISK_SIRA[end_seviye]
        else end_seviye
    )

    return genel_seviye, round(oran_kapasitif, 2), round(oran_enduktif, 2), kap_seviye, end_seviye


def process_measurements(measurements: List[models.Measurement]) -> List[Dict]:
    """
    Ölçümleri sıralı biçimde işler; kümülatif oranları ve risk seviyelerini hesaplar.
    Her iki bileşen (kapasitif + endüktif) ayrı ayrı raporlanır.
    """
    processed = []
    cumulative_active     = {}
    cumulative_inductive  = {}
    cumulative_capacitive = {}

    for m in measurements:
        tid = m.transformer_id
        if tid not in cumulative_active:
            cumulative_active[tid]     = 0
            cumulative_inductive[tid]  = 0
            cumulative_capacitive[tid] = 0

        cumulative_active[tid]     += m.active_kwh
        cumulative_inductive[tid]  += m.inductive_kvarh
        cumulative_capacitive[tid] += m.capacitive_kvarh

        c_aktif = cumulative_active[tid]
        c_ind   = cumulative_inductive[tid]
        c_cap   = cumulative_capacitive[tid]

        # Saatlik oranlar
        oran_kapasitif = (m.capacitive_kvarh / m.active_kwh * 100) if m.active_kwh > 0 else (999.0 if m.capacitive_kvarh > 0 else 0.0)
        oran_enduktif  = (m.inductive_kvarh  / m.active_kwh * 100) if m.active_kwh > 0 else (999.0 if m.inductive_kvarh > 0 else 0.0)

        # Kümülatif oranlar
        kum_kapasitif = (c_cap / c_aktif * 100) if c_aktif > 0 else (999.0 if c_cap > 0 else 0.0)
        kum_enduktif  = (c_ind / c_aktif * 100) if c_aktif > 0 else (999.0 if c_ind > 0 else 0.0)

        # Genel risk — kümülatif üzerinden (EPDK ceza hesabı aylık kümülatif üzerinden)
        genel_seviye, _, _, kap_seviye, end_seviye = hesapla_risk_durumu(c_aktif, c_cap, c_ind)

        processed.append({
            "id":                      m.id,
            "timestamp":               m.timestamp,
            "transformer_id":          m.transformer_id,
            "active_kwh":              m.active_kwh,
            "inductive_kvarh":         m.inductive_kvarh,
            "capacitive_kvarh":        m.capacitive_kvarh,
            "kapasitifOran":           round(oran_kapasitif, 2),
            "enduktifOran":            round(oran_enduktif, 2),
            "kumulatifKapasitifOran":  round(kum_kapasitif, 2),
            "kumulatifEnduktifOran":   round(kum_enduktif, 2),
            "riskDurumu":              genel_seviye,
            "kapasitifRiskSeviye":     kap_seviye,
            "enduktifRiskSeviye":      end_seviye,
        })

    return processed


def get_monthly_summary(
    db: Session,
    year: int,
    month: int,
    transformer_id: Optional[str] = None
) -> List[Dict]:
    """
    Aylık özet; hem kapasitif hem endüktif risk bilgisini döndürür.
    DB-level yıl/ay filtreleme ve tek geçişli aggregation.
    """
    sim_now = datetime.now()

    query = db.query(models.Measurement).filter(
        models.Measurement.timestamp <= sim_now,
        extract("year",  models.Measurement.timestamp) == year,
        extract("month", models.Measurement.timestamp) == month,
    )
    if transformer_id:
        query = query.filter(models.Measurement.transformer_id == transformer_id)

    measurements = query.all()
    logger.debug(f"get_monthly_summary: {year}-{month:02d} → {len(measurements)} ölçüm")

    # Tek geçiş aggregation
    t_groups: Dict[str, Dict] = {}
    for m in measurements:
        tid = m.transformer_id
        if tid not in t_groups:
            t_groups[tid] = {
                "aktif":    0,
                "enduktif": 0,
                "kapasitif": 0,
                "gun_seti": set(),
            }
        g = t_groups[tid]
        g["aktif"]     += m.active_kwh
        g["enduktif"]  += m.inductive_kvarh
        g["kapasitif"] += m.capacitive_kvarh
        g["gun_seti"].add(m.timestamp.date())

    results = []
    for tid, data in t_groups.items():
        aktif    = data["aktif"]
        enduktif = data["enduktif"]
        kapasitif = data["kapasitif"]
        gun_sayisi = len(data["gun_seti"])

        # Her iki bileşen de değerlendiriliyor
        genel_seviye, oran_kapasitif, oran_enduktif, kap_seviye, end_seviye = hesapla_risk_durumu(
            aktif, kapasitif, enduktif
        )

        trafo_info = db.query(models.Transformer).filter(models.Transformer.id == tid).first()
        if not trafo_info:
            logger.warning(f"get_monthly_summary: trafo bulunamadı: {tid}")
            continue

        results.append({
            "trafo": {
                "id":       trafo_info.id,
                "adi":      trafo_info.name,
                "bolge":    trafo_info.region,
                "kapasite": trafo_info.power_mva,
            },
            "ozet": {
                "toplamAktif":      aktif,
                "toplamEnduktif":   enduktif,
                "toplamKapasitif":  kapasitif,
                "kapasitifOran":    oran_kapasitif,
                "enduktifOran":     oran_enduktif,
                "gunSayisi":        gun_sayisi,
                # ── Risk ──
                "genelRisk":        {"seviye": genel_seviye},
                # Geriye dönük uyumluluk: kapasitifRisk hâlâ mevcut
                "kapasitifRisk":    {"seviye": kap_seviye},
                "enduktifRisk":     {"seviye": end_seviye},
            },
        })

    return results
