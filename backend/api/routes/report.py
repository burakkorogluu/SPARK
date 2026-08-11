from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import extract, func
from api.deps import get_db
from db import models
from datetime import datetime
import calendar
import logging
import holidays

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
    - Kritik noktalar (limit aşımı günleri, pik günler, ceza başlangıcı)
    - Manevra geçmişi (o ay)
    - Alarm geçmişi (o ay)
    """
    trafo = db.query(models.Transformer).filter(models.Transformer.id == transformer_id).first()
    if not trafo:
        raise HTTPException(status_code=404, detail=f"Trafo bulunamadı: {transformer_id}")

    sim_now = datetime.now()

    from services.analysis_service import get_monthly_summary, hesapla_risk_durumu
    ozet_list = get_monthly_summary(db, year, month, transformer_id)
    ozet = ozet_list[0]["ozet"] if ozet_list else None

    REAKTIF_BIRIM_FIYAT = 1.35  # Örnek güncel EPDK tarife birim fiyatı (TL/kVArh)

    if ozet:
        c_aktif = ozet.get("toplamAktif", 0)
        c_cap = ozet.get("toplamKapasitif", 0)
        c_ind = ozet.get("toplamEnduktif", 0)
        kap_oran = (c_cap / c_aktif * 100) if c_aktif > 0 else 0
        end_oran = (c_ind / c_aktif * 100) if c_aktif > 0 else 0
        
        kap_ceza_tl = c_cap * REAKTIF_BIRIM_FIYAT if kap_oran >= 15.0 else 0
        end_ceza_tl = c_ind * REAKTIF_BIRIM_FIYAT if end_oran >= 20.0 else 0
        
        ozet["ucretlendirme"] = {
            "birimFiyat": REAKTIF_BIRIM_FIYAT,
            "kapasitifCezaTL": round(kap_ceza_tl, 2),
            "enduktifCezaTL": round(end_ceza_tl, 2),
            "toplamCezaTL": round(max(kap_ceza_tl, end_ceza_tl), 2)
        }

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

    # ─── Kritik noktalar ───
    kritik_noktalar = _hesapla_kritik_noktalar(daily_rows)

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

    # ─── Ay Sonu Tahmini (Cari ay ise) ───
    ay_sonu_tahmini = None
    if year == sim_now.year and month == sim_now.month:
        from services.maneuver_service import get_projected_monthly_totals
        proj_aktif, proj_kap, proj_end = get_projected_monthly_totals(db, transformer_id)
        
        proj_kap_ratio = (proj_kap / proj_aktif * 100) if proj_aktif > 0 else 0.0
        proj_end_ratio = (proj_end / proj_aktif * 100) if proj_aktif > 0 else 0.0
        
        proj_kap_ceza_tl = proj_kap * REAKTIF_BIRIM_FIYAT if proj_kap_ratio >= 15.0 else 0
        proj_end_ceza_tl = proj_end * REAKTIF_BIRIM_FIYAT if proj_end_ratio >= 20.0 else 0
        
        ay_sonu_tahmini = {
            "kapasitifOran": round(proj_kap_ratio, 2),
            "enduktifOran": round(proj_end_ratio, 2),
            "kapasitifCeza": proj_kap_ratio >= 15.0,
            "enduktifCeza": proj_end_ratio >= 20.0,
            "cezaVar": proj_kap_ratio >= 15.0 or proj_end_ratio >= 20.0,
            "tahminiCezaTL": round(max(proj_kap_ceza_tl, proj_end_ceza_tl), 2)
        }

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
        "kritikNoktalar": kritik_noktalar,
        "manevraGecmisi": manevra_gecmisi,
        "alarmGecmisi": alarm_gecmisi,
        "aySonuTahmini": ay_sonu_tahmini,
    }


@router.get("/multi-summary")
def get_multi_report_summary(
    transformer_ids: str = Query(..., description="Virgülle ayrılmış trafo ID listesi"),
    year: int = Query(..., description="Yıl"),
    month: int = Query(..., description="Ay (1-12)"),
    db: Session = Depends(get_db),
):
    """
    Birden fazla trafo için özet rapor döndürür.
    Her trafo için: trafo bilgisi, aylık özet, kritik noktalar.
    """
    from services.analysis_service import get_monthly_summary

    id_list = [tid.strip() for tid in transformer_ids.split(",") if tid.strip()]
    if not id_list:
        raise HTTPException(status_code=400, detail="En az bir trafo ID'si gereklidir.")

    _, last_day = calendar.monthrange(year, month)
    sim_now = datetime.now()
    period_start = datetime(year, month, 1)
    period_end = min(datetime(year, month, last_day, 23, 59, 59), sim_now)

    results = []
    for tid in id_list:
        trafo = db.query(models.Transformer).filter(models.Transformer.id == tid).first()
        if not trafo:
            logger.warning(f"multi-summary: trafo bulunamadı: {tid}")
            continue

        ozet_list = get_monthly_summary(db, year, month, tid)
        ozet = ozet_list[0]["ozet"] if ozet_list else None

        daily_rows = (
            db.query(
                func.date(models.Measurement.timestamp).label("tarih"),
                func.sum(models.Measurement.active_kwh).label("aktif"),
                func.sum(models.Measurement.capacitive_kvarh).label("kapasitif"),
                func.sum(models.Measurement.inductive_kvarh).label("enduktif"),
            )
            .filter(
                models.Measurement.transformer_id == tid,
                models.Measurement.timestamp >= period_start,
                models.Measurement.timestamp <= period_end,
            )
            .group_by(func.date(models.Measurement.timestamp))
            .order_by(func.date(models.Measurement.timestamp).asc())
            .all()
        )

        kritik_noktalar = _hesapla_kritik_noktalar(daily_rows)

        results.append({
            "trafo": {
                "id": trafo.id,
                "adi": trafo.name,
                "bolge": trafo.region,
                "kapasite": trafo.power_mva,
            },
            "ozet": ozet,
            "kritikNoktalar": kritik_noktalar,
        })

    return {"trafolar": results, "donem": {"yil": year, "ay": month}}


def _hesapla_kritik_noktalar(daily_rows) -> dict:
    """
    Günlük satırlardan kritik noktaları hesaplar.
    """
    LIMIT_KAP = 15.0
    LIMIT_END = 20.0

    limit_asim_gunleri = []
    pik_kap = {"tarih": None, "oran": 0.0}
    pik_end = {"tarih": None, "oran": 0.0}
    ilk_ceza_riski = None
    
    # Tüm yıllar için (verilerde geçen) Türkiye tatillerini alalım
    years_set = set()
    for row in daily_rows:
        if row.tarih:
            # func.date() SQLite'da string ('YYYY-MM-DD') döner
            years_set.add(int(str(row.tarih)[:4]))
    years = list(years_set)
    tr_holidays = holidays.country_holidays("TR", years=years) if years else {}
    
    tatil_gunleri = []

    # Tatil olmayan günlerin ortalamalarını hesaplayalım (kıyaslama için)
    nh_aktif_toplam = 0
    nh_kap_toplam = 0
    nh_end_toplam = 0
    nh_count = 0
    for row in daily_rows:
        tarih_str = str(row.tarih)
        if tarih_str not in tr_holidays:
            nh_count += 1
            nh_aktif_toplam += row.aktif or 0
            nh_kap_toplam += row.kapasitif or 0
            nh_end_toplam += row.enduktif or 0
            
    avg_aktif = nh_aktif_toplam / nh_count if nh_count > 0 else 0
    avg_kap_oran = round((nh_kap_toplam / nh_aktif_toplam * 100) if nh_aktif_toplam > 0 else 0.0, 2)
    avg_end_oran = round((nh_end_toplam / nh_aktif_toplam * 100) if nh_aktif_toplam > 0 else 0.0, 2)

    for row in daily_rows:
        aktif = row.aktif or 0
        kap = row.kapasitif or 0
        end = row.enduktif or 0
        tarih_str = str(row.tarih)

        kap_oran = round((kap / aktif * 100) if aktif > 0 else 0.0, 2)
        end_oran = round((end / aktif * 100) if aktif > 0 else 0.0, 2)

        if kap_oran > pik_kap["oran"]:
            pik_kap = {"tarih": tarih_str, "oran": kap_oran}
        if end_oran > pik_end["oran"]:
            pik_end = {"tarih": tarih_str, "oran": end_oran}

        kap_asim = kap_oran >= LIMIT_KAP
        end_asim = end_oran >= LIMIT_END
        if kap_asim or end_asim:
            limit_asim_gunleri.append({
                "tarih": tarih_str,
                "kapasitifOran": kap_oran,
                "enduktifOran": end_oran,
                "kapAsim": kap_asim,
                "endAsim": end_asim,
            })
            if ilk_ceza_riski is None:
                ilk_ceza_riski = tarih_str
                
        # Tatil kontrolü - holidays kütüphanesi 'YYYY-MM-DD' formatındaki stringleri de destekler
        if tarih_str in tr_holidays:
            aktif_degisim = round(((aktif - avg_aktif) / avg_aktif * 100) if avg_aktif > 0 else 0.0, 1)
            kap_degisim = round(kap_oran - avg_kap_oran, 1)
            end_degisim = round(end_oran - avg_end_oran, 1)
            
            tatil_gunleri.append({
                "tarih": tarih_str,
                "isim": tr_holidays.get(tarih_str),
                "aktif": aktif,
                "kapasitifOran": kap_oran,
                "enduktifOran": end_oran,
                "riskli": kap_asim or end_asim,
                "degisim": {
                    "aktif": aktif_degisim,
                    "kapasitif": kap_degisim,
                    "enduktif": end_degisim
                }
            })

    return {
        "limitAsimGunleri": limit_asim_gunleri,
        "limitAsimGunSayisi": len(limit_asim_gunleri),
        "pikKapasitif": pik_kap if pik_kap["tarih"] else None,
        "pikEnduktif": pik_end if pik_end["tarih"] else None,
        "ilkCezaRiskiTarihi": ilk_ceza_riski,
        "tatilGunleri": tatil_gunleri,
    }
