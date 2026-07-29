from sqlalchemy.orm import Session
import models
from datetime import datetime, timedelta
import logging
from services.forecast_service import get_cached_forecast
from services.analysis_service import get_monthly_summary

logger = logging.getLogger("spark.maneuver")


def _get_trafo_stats(db: Session):
    """Calculate load and reactive state for each transformer."""
    transformers = db.query(models.Transformer).all()
    trafo_stats = {}

    for trafo in transformers:
        # Get last 7 days of measurements for more stable analysis
        seven_days_ago = datetime.now() - timedelta(days=7)
        recent_measurements = db.query(models.Measurement).filter(
            models.Measurement.transformer_id == trafo.id,
            models.Measurement.timestamp >= seven_days_ago
        ).order_by(models.Measurement.timestamp.desc()).all()

        active_sum = sum(m.active_kwh for m in recent_measurements) if recent_measurements else 0
        ind_sum = sum(m.inductive_kvarh for m in recent_measurements) if recent_measurements else 0
        cap_sum = sum(m.capacitive_kvarh for m in recent_measurements) if recent_measurements else 0

        total_feeder_load = sum(f.simulated_load_kw for f in trafo.feeders)
        power_kw = trafo.power_mva * 1000  # Convert MVA to approximate kW
        load_ratio = (total_feeder_load / power_kw * 100) if power_kw > 0 else 0

        ind_ratio = (ind_sum / active_sum * 100) if active_sum > 0 else 0
        cap_ratio = (cap_sum / active_sum * 100) if active_sum > 0 else 0

        # Peak vs off-peak analysis (last 24 hours)
        last_24h = db.query(models.Measurement).filter(
            models.Measurement.transformer_id == trafo.id,
            models.Measurement.timestamp >= datetime.now() - timedelta(hours=24)
        ).all()

        peak_active = sum(m.active_kwh for m in last_24h if 7 <= m.timestamp.hour < 18) or 1
        peak_cap = sum(m.capacitive_kvarh for m in last_24h if 7 <= m.timestamp.hour < 18)
        offpeak_active = sum(m.active_kwh for m in last_24h if not (7 <= m.timestamp.hour < 18)) or 1
        offpeak_cap = sum(m.capacitive_kvarh for m in last_24h if not (7 <= m.timestamp.hour < 18))

        peak_cap_ratio = (peak_cap / peak_active * 100) if peak_active > 0 else 0
        offpeak_cap_ratio = (offpeak_cap / offpeak_active * 100) if offpeak_active > 0 else 0

        trafo_stats[trafo.id] = {
            "model": trafo,
            "power_kw": power_kw,
            "total_feeder_load": total_feeder_load,
            "load_ratio": load_ratio,
            "ind_ratio": ind_ratio,
            "cap_ratio": cap_ratio,
            "peak_cap_ratio": peak_cap_ratio,
            "offpeak_cap_ratio": offpeak_cap_ratio,
            "feeders": trafo.feeders,
            "reactors": trafo.reactors,
            "measurement_count": len(recent_measurements)
        }

    return transformers, trafo_stats


def _calculate_risk_level(load_ratio):
    """Determine risk level based on load ratio."""
    if load_ratio > 85:
        return "tehlikeli"
    elif load_ratio > 70:
        return "riskli"
    elif load_ratio > 50:
        return "dikkat"
    elif load_ratio > 30:
        return "normal"
    return "guvenli"


def _calculate_suggestion_score(stats, alt_stats, load_diff, is_reactive=False):
    """
    Calculate a 0-100 score for a maneuver suggestion.
    Higher score = more urgent/beneficial.
    """
    score = 0

    # Factor 1: Current source load ratio (0-30 points)
    if stats["load_ratio"] > 85:
        score += 30
    elif stats["load_ratio"] > 70:
        score += 22
    elif stats["load_ratio"] > 50:
        score += 12
    else:
        score += 5

    # Factor 2: Load difference between source and target (0-25 points)
    if load_diff > 30:
        score += 25
    elif load_diff > 20:
        score += 18
    elif load_diff > 10:
        score += 12
    else:
        score += 5

    # Factor 3: Reactive ratio improvement potential (0-25 points)
    if is_reactive:
        if stats["cap_ratio"] > 15:
            score += 25
        elif stats["cap_ratio"] > 12:
            score += 18
        elif stats["ind_ratio"] > 20:
            score += 20
        elif stats["ind_ratio"] > 15:
            score += 12
        else:
            score += 5
    else:
        # For feeder transfers, consider reactive impact indirectly
        if stats["cap_ratio"] > 12 or stats["ind_ratio"] > 16:
            score += 15
        else:
            score += 5

    # Factor 4: Target capacity headroom (0-20 points)
    if alt_stats:
        target_headroom = 100 - alt_stats["load_ratio"]
        if target_headroom > 60:
            score += 20
        elif target_headroom > 40:
            score += 14
        elif target_headroom > 20:
            score += 8
        else:
            score += 2

    return min(100, max(0, score))


def _get_projected_monthly_ratios(db: Session, trafo_id: str):
    """
    Calculate the projected end-of-month capacitive and inductive ratios
    by combining historical monthly totals with ensemble forecasts.
    """
    now = datetime.now()
    year, month = now.year, now.month
    
    # 1. Get current month's historical totals
    summaries = get_monthly_summary(db, year, month, transformer_id=trafo_id)
    if not summaries:
        return 0, 0
    
    ozet = summaries[0]["ozet"]
    hist_aktif = ozet["toplamAktif"]
    hist_kap = ozet["toplamKapasitif"]
    hist_end = ozet["toplamEnduktif"]
    
    # 2. Get ensemble forecasts from now to end of month
    forecast_data = get_cached_forecast(db, trafo_id, year, month, "ensemble")
    preds = forecast_data.get("predictions", [])
    
    pred_aktif = sum(p["active_kwh"] for p in preds)
    pred_kap = sum(p["capacitive_kvarh"] for p in preds)
    pred_end = sum(p["inductive_kvarh"] for p in preds)
    
    total_aktif = hist_aktif + pred_aktif
    total_kap = hist_kap + pred_kap
    total_end = hist_end + pred_end
    
    proj_kap_ratio = (total_kap / max(1, total_aktif)) * 100
    proj_end_ratio = (total_end / max(1, total_aktif)) * 100
    
    return proj_kap_ratio, proj_end_ratio


def analyze_and_suggest_maneuvers(db: Session):
    """Analyze transformer states and generate scored maneuver suggestions."""
    suggestions = []
    transformers, trafo_stats = _get_trafo_stats(db)

    suggestion_id = 1

    # 1. Check for Load Balancing Opportunities (Feeder Transfer)
    for t_id, stats in trafo_stats.items():
        trafo = stats["model"]

        if stats["load_ratio"] > 50:
            for feeder in stats["feeders"]:
                alt_id = feeder.alternative_transformer_id
                if alt_id and alt_id in trafo_stats:
                    alt_stats = trafo_stats[alt_id]
                    load_diff = stats["load_ratio"] - alt_stats["load_ratio"]

                    if load_diff > 15:
                        new_source_load = stats["total_feeder_load"] - feeder.simulated_load_kw
                        new_target_load = alt_stats["total_feeder_load"] + feeder.simulated_load_kw

                        new_source_ratio = (new_source_load / stats["power_kw"] * 100) if stats["power_kw"] > 0 else 0
                        new_target_ratio = (new_target_load / alt_stats["power_kw"] * 100) if alt_stats["power_kw"] > 0 else 0

                        score = _calculate_suggestion_score(stats, alt_stats, load_diff, is_reactive=False)

                        impact = "Yüksek" if stats["load_ratio"] > 75 else ("Orta" if stats["load_ratio"] > 60 else "Düşük")

                        suggestions.append({
                            "id": f"MAN-{suggestion_id:03d}",
                            "title": f"Fider Yük Aktarımı: {feeder.name}",
                            "action_type": "feeder_transfer",
                            "impact": impact,
                            "score": score,
                            "source_trafo_id": trafo.id,
                            "source_trafo_name": trafo.name,
                            "target_trafo_id": alt_id,
                            "target_trafo_name": alt_stats["model"].name,
                            "target_asset": feeder.name,
                            "description": (
                                f"'{feeder.name}' (yük: {feeder.simulated_load_kw:.0f} kW), "
                                f"%{stats['load_ratio']:.1f} yüklü {trafo.name} trafosundan, "
                                f"%{alt_stats['load_ratio']:.1f} yüklü {alt_stats['model'].name} trafosuna aktarılabilir. "
                                f"Aktarım sonrası kaynak trafo yükü %{new_source_ratio:.1f}'e, "
                                f"hedef trafo yükü %{new_target_ratio:.1f}'e ulaşacaktır."
                            ),
                            "feeder_id": feeder.id,
                            "simulation_preview": {
                                "source_load_before": round(stats["load_ratio"], 1),
                                "source_load_after": round(new_source_ratio, 1),
                                "target_load_before": round(alt_stats["load_ratio"], 1),
                                "target_load_after": round(new_target_ratio, 1),
                            }
                        })
                        suggestion_id += 1

        # 2. Check Reactive Compensation / Reactor Maneuvers
        if stats["ind_ratio"] > 15:
            for reactor in stats["reactors"]:
                if reactor.status == "inactive":
                    score = _calculate_suggestion_score(stats, stats, stats["ind_ratio"], is_reactive=True)
                    suggestions.append({
                        "id": f"MAN-{suggestion_id:03d}",
                        "title": f"Reaktör Devreye Alma: {reactor.name}",
                        "action_type": "reactor_switch",
                        "impact": "Yüksek",
                        "score": score,
                        "source_trafo_id": trafo.id,
                        "source_trafo_name": trafo.name,
                        "target_trafo_id": trafo.id,
                        "target_trafo_name": trafo.name,
                        "target_asset": reactor.name,
                        "description": (
                            f"{trafo.name} üzerinde endüktif oran %{stats['ind_ratio']:.1f} seviyesinde. "
                            f"Pasif durumdaki '{reactor.name}' reaktörünün ({reactor.capacity_kvar:.0f} kVAr) "
                            f"devreye alınması önerilmektedir."
                        ),
                        "reactor_id": reactor.id,
                        "simulation_preview": {
                            "source_load_before": round(stats["load_ratio"], 1),
                            "source_load_after": round(stats["load_ratio"], 1),
                            "target_load_before": round(stats["load_ratio"], 1),
                            "target_load_after": round(stats["load_ratio"], 1),
                        }
                    })
                    suggestion_id += 1

                elif reactor.alternative_transformer_id and reactor.alternative_transformer_id in trafo_stats:
                    alt_stats = trafo_stats[reactor.alternative_transformer_id]
                    if alt_stats["ind_ratio"] > stats["ind_ratio"] + 10:
                        score = _calculate_suggestion_score(stats, alt_stats, alt_stats["ind_ratio"] - stats["ind_ratio"], is_reactive=True)
                        suggestions.append({
                            "id": f"MAN-{suggestion_id:03d}",
                            "title": f"Reaktör Bağlantı Değişimi: {reactor.name}",
                            "action_type": "reactor_switch",
                            "impact": "Orta",
                            "score": score,
                            "source_trafo_id": trafo.id,
                            "source_trafo_name": trafo.name,
                            "target_trafo_id": alt_stats["model"].id,
                            "target_trafo_name": alt_stats["model"].name,
                            "target_asset": reactor.name,
                            "description": (
                                f"Endüktif kompanzasyon ihtiyacı daha yüksek olan {alt_stats['model'].name} "
                                f"(%{alt_stats['ind_ratio']:.1f}) için '{reactor.name}' reaktörünün "
                                f"bu trafoya aktarılması önerilmektedir."
                            ),
                            "reactor_id": reactor.id,
                            "simulation_preview": {
                                "source_load_before": round(stats["load_ratio"], 1),
                                "source_load_after": round(stats["load_ratio"], 1),
                                "target_load_before": round(alt_stats["load_ratio"], 1),
                                "target_load_after": round(alt_stats["load_ratio"], 1),
                            }
                        })
                        suggestion_id += 1

        # 3. Night-time capacitive risk warnings
        if stats["offpeak_cap_ratio"] > 12:
            score = min(95, int(stats["offpeak_cap_ratio"] * 4))
            for reactor in stats["reactors"]:
                if reactor.status == "inactive":
                    suggestions.append({
                        "id": f"MAN-{suggestion_id:03d}",
                        "title": f"Gece Kapasitif Risk — Reaktör Önerisi: {reactor.name}",
                        "action_type": "reactor_switch",
                        "impact": "Yüksek" if stats["offpeak_cap_ratio"] > 15 else "Orta",
                        "score": score,
                        "source_trafo_id": trafo.id,
                        "source_trafo_name": trafo.name,
                        "target_trafo_id": trafo.id,
                        "target_trafo_name": trafo.name,
                        "target_asset": reactor.name,
                        "description": (
                            f"{trafo.name} gece saatlerinde (00:00-07:00) kapasitif oranı "
                            f"%{stats['offpeak_cap_ratio']:.1f} seviyesine yükselmektedir. "
                            f"'{reactor.name}' ({reactor.capacity_kvar:.0f} kVAr) gece saatlerinde "
                            f"devreye alınması önerilir."
                        ),
                        "reactor_id": reactor.id,
                        "simulation_preview": {
                            "source_load_before": round(stats["load_ratio"], 1),
                            "source_load_after": round(stats["load_ratio"], 1),
                            "target_load_before": round(stats["load_ratio"], 1),
                            "target_load_after": round(stats["load_ratio"], 1),
                        }
                    })
                    suggestion_id += 1

        # 4. Predictive Maneuvers (Tahmine Dayalı Öneriler)
        proj_kap_ratio, proj_end_ratio = _get_projected_monthly_ratios(db, trafo.id)
        
        # Predictive scoring base: scale based on how much it exceeds the threshold (15 for cap, 20 for ind)
        if proj_kap_ratio > 14.5:
            # Score: 60 base + up to 40 points based on severity
            pred_score = min(100, 60 + int((proj_kap_ratio - 14.5) * 10))
            for reactor in stats["reactors"]:
                if reactor.status == "inactive":
                    suggestions.append({
                        "id": f"MAN-PRED-{suggestion_id:03d}",
                        "title": f"Proaktif Uyarı (Kapasitif): {reactor.name}",
                        "action_type": "predictive_reactor_switch",
                        "impact": "Yüksek" if proj_kap_ratio > 15.0 else "Orta",
                        "score": pred_score,
                        "source_trafo_id": trafo.id,
                        "source_trafo_name": trafo.name,
                        "target_trafo_id": trafo.id,
                        "target_trafo_name": trafo.name,
                        "target_asset": reactor.name,
                        "is_predictive": True,
                        "description": (
                            f"Tahmin algoritmalarına (Ensemble) göre {trafo.name} trafosunda ay sonu kapasitif oranının "
                            f"%{proj_kap_ratio:.1f} seviyesine ulaşması öngörülüyor. "
                            f"Önlem olarak '{reactor.name}' reaktörünün devreye alınması tavsiye edilir."
                        ),
                        "reactor_id": reactor.id,
                        "simulation_preview": {
                            "source_load_before": round(stats["load_ratio"], 1),
                            "source_load_after": round(stats["load_ratio"], 1),
                            "target_load_before": round(stats["load_ratio"], 1),
                            "target_load_after": round(stats["load_ratio"], 1),
                        }
                    })
                    suggestion_id += 1
                    break # Suggest one reactor is enough for predictive
                    
        if proj_end_ratio > 19.5:
            pred_score = min(100, 60 + int((proj_end_ratio - 19.5) * 10))
            for reactor in stats["reactors"]:
                if reactor.alternative_transformer_id and reactor.alternative_transformer_id in trafo_stats:
                    suggestions.append({
                        "id": f"MAN-PRED-{suggestion_id:03d}",
                        "title": f"Proaktif Uyarı (Endüktif): {reactor.name}",
                        "action_type": "predictive_reactor_switch",
                        "impact": "Yüksek" if proj_end_ratio > 20.0 else "Orta",
                        "score": pred_score,
                        "source_trafo_id": trafo.id,
                        "source_trafo_name": trafo.name,
                        "target_trafo_id": reactor.alternative_transformer_id,
                        "target_trafo_name": trafo_stats[reactor.alternative_transformer_id]["model"].name,
                        "target_asset": reactor.name,
                        "is_predictive": True,
                        "description": (
                            f"Tahmin algoritmalarına (Ensemble) göre {trafo.name} trafosunda ay sonu endüktif oranının "
                            f"%{proj_end_ratio:.1f} seviyesine ulaşması öngörülüyor. "
                            f"Önlem olarak '{reactor.name}' reaktörünün alternatif trafoya aktarılması / incelenmesi tavsiye edilir."
                        ),
                        "reactor_id": reactor.id,
                        "simulation_preview": {
                            "source_load_before": round(stats["load_ratio"], 1),
                            "source_load_after": round(stats["load_ratio"], 1),
                            "target_load_before": round(trafo_stats[reactor.alternative_transformer_id]["load_ratio"], 1),
                            "target_load_after": round(trafo_stats[reactor.alternative_transformer_id]["load_ratio"], 1),
                        }
                    })
                    suggestion_id += 1
                    break

    # Fallback: if no suggestions, generate a preventive one
    if not suggestions:
        first_trafo = transformers[0] if transformers else None
        second_trafo = transformers[1] if len(transformers) > 1 else first_trafo
        if first_trafo and first_trafo.feeders:
            f = first_trafo.feeders[0]
            suggestions.append({
                "id": "MAN-001",
                "title": f"Önleyici Yük Dengeleme: {f.name}",
                "action_type": "feeder_transfer",
                "impact": "Düşük",
                "score": 15,
                "source_trafo_id": first_trafo.id,
                "source_trafo_name": first_trafo.name,
                "target_trafo_id": f.alternative_transformer_id or second_trafo.id,
                "target_trafo_name": f.alternative_transformer.name if f.alternative_transformer else second_trafo.name,
                "target_asset": f.name,
                "description": (
                    f"Peak saatler öncesinde şebeke dengesini korumak için "
                    f"'{f.name}' fiderinin alternatif trafoya aktarılması önerilir."
                ),
                "feeder_id": f.id,
                "simulation_preview": {
                    "source_load_before": round(trafo_stats.get(first_trafo.id, {}).get("load_ratio", 0), 1),
                    "source_load_after": 0,
                    "target_load_before": 0,
                    "target_load_after": 0,
                }
            })

    # Sort by score descending
    suggestions.sort(key=lambda s: s.get("score", 0), reverse=True)

    return suggestions


def simulate_maneuver(db: Session, asset_type: str, asset_id: str, target_trafo_id: str):
    """
    Simulate a maneuver without applying it.
    Returns before/after load ratios and risk levels for both source and target transformers.
    Raises ValueError on edge case topology errors.
    """
    _, trafo_stats = _get_trafo_stats(db)

    if asset_type == "feeder":
        asset = db.query(models.Feeder).filter(models.Feeder.id == asset_id).first()
        if not asset:
            return None
        source_id = asset.current_transformer_id
        asset_load = asset.simulated_load_kw
        asset_name = asset.name
    elif asset_type == "reactor":
        asset = db.query(models.Reactor).filter(models.Reactor.id == asset_id).first()
        if not asset:
            return None
        source_id = asset.current_transformer_id
        asset_load = 0  # Reactors don't transfer load in kW directly
        asset_name = asset.name
    else:
        return None

    # Edge Case 1: Same Transformer Transfer (No-Op)
    if source_id == target_trafo_id:
        raise ValueError(f"'{asset_name}' zaten '{target_trafo_id}' trafosuna bağlı.")

    # Edge Case 2: Topology / Physical Line Check
    if asset.alternative_transformer_id and target_trafo_id != asset.alternative_transformer_id:
        raise ValueError(f"'{asset_name}' fiziksel hat topolojisi gereği sadece '{asset.alternative_transformer_id}' trafosuna aktarılabilir.")

    if source_id not in trafo_stats or target_trafo_id not in trafo_stats:
        return None

    source_stats = trafo_stats[source_id]
    target_stats = trafo_stats[target_trafo_id]

    # Calculate before/after for feeder transfer
    source_load_before = source_stats["total_feeder_load"]
    target_load_before = target_stats["total_feeder_load"]

    if asset_type == "feeder":
        source_load_after = source_load_before - asset_load
        target_load_after = target_load_before + asset_load
    else:
        source_load_after = source_load_before
        target_load_after = target_load_before

    source_ratio_before = source_stats["load_ratio"]
    source_ratio_after = (source_load_after / source_stats["power_kw"] * 100) if source_stats["power_kw"] > 0 else 0
    target_ratio_before = target_stats["load_ratio"]
    target_ratio_after = (target_load_after / target_stats["power_kw"] * 100) if target_stats["power_kw"] > 0 else 0

    is_overload = target_ratio_after > 100
    overload_warning = None
    if is_overload:
        overload_warning = f"KRİTİK UYARI: Bu manevra hedef trafo ({target_stats['model'].name}) yükünü %{target_ratio_after:.1f}'e çıkararak aşırı yüklenmeye (Overload) sebep olacaktır!"

    # Determine reactive improvement message
    reactive_msg = None
    if asset_type == "reactor":
        reactive_msg = (
            f"'{asset_name}' reaktörü ({asset.capacity_kvar:.0f} kVAr) "
            f"{source_stats['model'].name} → {target_stats['model'].name} aktarımı ile "
            f"hedef trafodaki endüktif kompanzasyon güçlendirilecektir."
        )
    elif source_stats["cap_ratio"] > 10:
        reactive_msg = (
            f"Kaynak trafodan {asset_load:.0f} kW yük çıkarılması, aktif enerji azalmasına bağlı olarak "
            f"kapasitif oranı artırabilir. Mevcut oran: %{source_stats['cap_ratio']:.1f}"
        )

    return {
        "asset_type": asset_type,
        "asset_id": asset_id,
        "asset_name": asset_name,
        "source_trafo_id": source_id,
        "source_trafo_name": source_stats["model"].name,
        "target_trafo_id": target_trafo_id,
        "target_trafo_name": target_stats["model"].name,
        "source_load_before": round(source_load_before, 1),
        "source_load_after": round(source_load_after, 1),
        "target_load_before": round(target_load_before, 1),
        "target_load_after": round(target_load_after, 1),
        "source_load_ratio_before": round(source_ratio_before, 1),
        "source_load_ratio_after": round(source_ratio_after, 1),
        "target_load_ratio_before": round(target_ratio_before, 1),
        "target_load_ratio_after": round(target_ratio_after, 1),
        "source_risk_before": _calculate_risk_level(source_ratio_before),
        "source_risk_after": _calculate_risk_level(source_ratio_after),
        "target_risk_before": _calculate_risk_level(target_ratio_before),
        "target_risk_after": _calculate_risk_level(target_ratio_after),
        "is_overload": is_overload,
        "overload_warning": overload_warning,
        "reactive_improvement": reactive_msg
    }


def apply_maneuver(db: Session, asset_type: str, asset_id: str, target_trafo_id: str, reason: str = None, override_overload: bool = False):
    """
    Apply a maneuver and log it in ManeuverLog.
    Enforces edge-case protections (no-op, topology, overload confirmation).
    """
    _, trafo_stats = _get_trafo_stats(db)

    if asset_type == "feeder":
        asset = db.query(models.Feeder).filter(models.Feeder.id == asset_id).first()
        if not asset:
            return None
        old_trafo_id = asset.current_transformer_id
        
        # Edge Case 1: Same Trafo
        if old_trafo_id == target_trafo_id:
            raise ValueError(f"Fider zaten '{target_trafo_id}' trafosuna bağlı.")
            
        # Edge Case 2: Topology check
        if asset.alternative_transformer_id and target_trafo_id != asset.alternative_transformer_id:
            raise ValueError(f"Fider sadece alternatif trafosuna ({asset.alternative_transformer_id}) aktarılabilir.")

        new_trafo = db.query(models.Transformer).filter(models.Transformer.id == target_trafo_id).first()
        if not new_trafo:
            return None

        # Edge Case 3: Overload check
        target_stats = trafo_stats.get(target_trafo_id)
        if target_stats and target_stats["power_kw"] > 0:
            target_load_after = target_stats["total_feeder_load"] + asset.simulated_load_kw
            target_ratio_after = (target_load_after / target_stats["power_kw"]) * 100
            if target_ratio_after > 100 and not override_overload:
                raise ValueError(f"Aşırı Yük Uyarısı: Bu manevra hedef trafoda ({target_trafo_id}) %{target_ratio_after:.1f} aşırı yük oluşturur. İlerlemeniz için 'Aşırı Yük Riskini Kabul Ediyorum' seçeneğini işaretlemelisiniz.")

        old_trafo = db.query(models.Transformer).filter(models.Transformer.id == old_trafo_id).first()
        asset.alternative_transformer_id = old_trafo_id
        asset.current_transformer_id = target_trafo_id

        impact = "Kritik (Aşırı Yüklü)" if target_stats and (target_stats["total_feeder_load"] + asset.simulated_load_kw) / target_stats["power_kw"] > 1 else "Orta"

        log = models.ManeuverLog(
            action_type="feeder_transfer",
            asset_type="feeder",
            asset_id=asset_id,
            asset_name=asset.name,
            source_trafo_id=old_trafo_id,
            target_trafo_id=target_trafo_id,
            source_trafo_name=old_trafo.name if old_trafo else old_trafo_id,
            target_trafo_name=new_trafo.name,
            reason=reason,
            impact_level=impact,
            status="applied"
        )
        db.add(log)
        db.commit()
        db.refresh(log)
        return log

    elif asset_type == "reactor":
        asset = db.query(models.Reactor).filter(models.Reactor.id == asset_id).first()
        if not asset:
            return None
        old_trafo_id = asset.current_transformer_id
        
        if old_trafo_id == target_trafo_id:
            raise ValueError(f"Reaktör zaten '{target_trafo_id}' trafosuna bağlı.")
            
        if asset.alternative_transformer_id and target_trafo_id != asset.alternative_transformer_id:
            raise ValueError(f"Reaktör sadece alternatif trafosuna ({asset.alternative_transformer_id}) aktarılabilir.")

        old_trafo = db.query(models.Transformer).filter(models.Transformer.id == old_trafo_id).first()
        new_trafo = db.query(models.Transformer).filter(models.Transformer.id == target_trafo_id).first()
        if not new_trafo:
            return None

        asset.alternative_transformer_id = old_trafo_id
        asset.current_transformer_id = target_trafo_id

        log = models.ManeuverLog(
            action_type="reactor_switch",
            asset_type="reactor",
            asset_id=asset_id,
            asset_name=asset.name,
            source_trafo_id=old_trafo_id,
            target_trafo_id=target_trafo_id,
            source_trafo_name=old_trafo.name if old_trafo else old_trafo_id,
            target_trafo_name=new_trafo.name,
            reason=reason,
            impact_level="Orta",
            status="applied"
        )
        db.add(log)
        db.commit()
        db.refresh(log)
        return log

    return None


def rollback_maneuver(db: Session, log_id: int):
    """
    Roll back a previously applied maneuver using its log entry.
    Restores original transformer assignments.
    """
    log = db.query(models.ManeuverLog).filter(
        models.ManeuverLog.id == log_id,
        models.ManeuverLog.status == "applied"
    ).first()

    if not log:
        return None

    # Restore the original state (swap source and target)
    if log.asset_type == "feeder":
        asset = db.query(models.Feeder).filter(models.Feeder.id == log.asset_id).first()
        if asset:
            asset.current_transformer_id = log.source_trafo_id
            asset.alternative_transformer_id = log.target_trafo_id
    elif log.asset_type == "reactor":
        asset = db.query(models.Reactor).filter(models.Reactor.id == log.asset_id).first()
        if asset:
            asset.current_transformer_id = log.source_trafo_id
            asset.alternative_transformer_id = log.target_trafo_id

    log.status = "rolled_back"
    log.rolled_back_at = datetime.now()
    db.commit()
    db.refresh(log)
    return log


def get_maneuver_history(db: Session, limit: int = 50, offset: int = 0):
    """Get maneuver history with pagination."""
    total = db.query(models.ManeuverLog).count()
    logs = db.query(models.ManeuverLog).order_by(
        models.ManeuverLog.timestamp.desc()
    ).offset(offset).limit(limit).all()

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "logs": logs
    }


def create_feeder(db: Session, feeder_data):
    """Create a new feeder."""
    existing = db.query(models.Feeder).filter(models.Feeder.id == feeder_data.id).first()
    if existing:
        return None

    # Verify transformer exists
    trafo = db.query(models.Transformer).filter(
        models.Transformer.id == feeder_data.current_transformer_id
    ).first()
    if not trafo:
        return None

    feeder = models.Feeder(
        id=feeder_data.id,
        name=feeder_data.name,
        current_transformer_id=feeder_data.current_transformer_id,
        alternative_transformer_id=feeder_data.alternative_transformer_id,
        simulated_load_kw=feeder_data.simulated_load_kw
    )
    db.add(feeder)
    db.commit()
    db.refresh(feeder)
    return feeder


def create_reactor(db: Session, reactor_data):
    """Create a new reactor."""
    existing = db.query(models.Reactor).filter(models.Reactor.id == reactor_data.id).first()
    if existing:
        return None

    # Verify transformer exists
    trafo = db.query(models.Transformer).filter(
        models.Transformer.id == reactor_data.current_transformer_id
    ).first()
    if not trafo:
        return None

    reactor = models.Reactor(
        id=reactor_data.id,
        name=reactor_data.name,
        current_transformer_id=reactor_data.current_transformer_id,
        alternative_transformer_id=reactor_data.alternative_transformer_id,
        capacity_kvar=reactor_data.capacity_kvar,
        status=reactor_data.status
    )
    db.add(reactor)
    db.commit()
    db.refresh(reactor)
    return reactor
