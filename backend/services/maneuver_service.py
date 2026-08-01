from typing import Optional
from sqlalchemy.orm import Session
import models
from datetime import datetime, timedelta
import logging
from services.forecast_service import get_cached_forecast, clear_caches, run_weekly_batch_forecast
from services.analysis_service import get_monthly_summary

logger = logging.getLogger("spark.maneuver")


def _get_trafo_stats(db: Session):
    """Calculate load and reactive state for each transformer."""
    transformers = db.query(models.Transformer).all()
    trafo_stats = {}

    for trafo in transformers:
        # Get measurements from the beginning of the current month for billing alignment
        now = datetime.now()
        start_of_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        recent_measurements = db.query(models.Measurement).filter(
            models.Measurement.transformer_id == trafo.id,
            models.Measurement.timestamp >= start_of_month
        ).order_by(models.Measurement.timestamp.desc()).all()

        active_sum = sum(m.active_kwh for m in recent_measurements) if recent_measurements else 0
        ind_sum = sum(m.inductive_kvarh for m in recent_measurements) if recent_measurements else 0
        cap_sum = sum(m.capacitive_kvarh for m in recent_measurements) if recent_measurements else 0

        total_feeder_load = sum(f.simulated_load_kw for f in trafo.feeders)
        power_kw = trafo.power_mva * 1000  # Convert MVA to approximate kW
        
        hours_so_far = len(recent_measurements) or 1
        avg_active = active_sum / hours_so_far
        load_ratio = (avg_active / power_kw * 100) if power_kw > 0 else 0

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
            "active_sum": active_sum,
            "cap_sum": cap_sum,
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
    
    proj_kap_ratio = (total_kap / total_aktif * 100) if total_aktif > 0 else 0.0
    proj_end_ratio = (total_end / total_aktif * 100) if total_aktif > 0 else 0.0
    
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
                        # Calculate physical kW load of the feeder based on its weight
                        feeder_kw = (feeder.simulated_load_kw / stats["total_feeder_load"] * stats["avg_active"]) if stats["total_feeder_load"] > 0 else 0
                        
                        # New ratios based on physical kW transfer
                        new_source_ratio = ((stats["avg_active"] - feeder_kw) / stats["power_kw"] * 100) if stats["power_kw"] > 0 else 0
                        new_target_ratio = ((alt_stats["avg_active"] + feeder_kw) / alt_stats["power_kw"] * 100) if alt_stats["power_kw"] > 0 else 0

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
                        "action_type": "reactor_transfer",
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
                            "action_type": "reactor_transfer",
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
                        "action_type": "reactor_transfer",
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
                        "action_type": "predictive_reactor_transfer",
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
                        "action_type": "predictive_reactor_transfer",
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
        second_trafo = transformers[1] if len(transformers) > 1 and transformers[1] is not None else first_trafo
        if first_trafo and first_trafo.feeders:
            f = first_trafo.feeders[0]
            
            target_id = f.alternative_transformer_id or (second_trafo.id if second_trafo else None)
            target_name = f.alternative_transformer.name if f.alternative_transformer else (second_trafo.name if second_trafo else "Bilinmeyen Trafo")

            suggestions.append({
                "id": "MAN-001",
                "title": f"Önleyici Yük Dengeleme: {f.name}",
                "action_type": "feeder_transfer",
                "impact": "Düşük",
                "score": 15,
                "source_trafo_id": first_trafo.id,
                "source_trafo_name": first_trafo.name,
                "target_trafo_id": target_id,
                "target_trafo_name": target_name,
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

    # Edge Case 1: Same Transformer Transfer (No-Op unless activating inactive reactor)
    if source_id == target_trafo_id:
        if not (asset_type == "reactor" and getattr(asset, 'status', 'active') == "inactive"):
            raise ValueError(f"'{asset_name}' zaten '{target_trafo_id}' trafosuna bağlı ve aktif durumda.")

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
    target_ratio_before = target_stats["load_ratio"]
    
    if asset_type == "feeder":
        feeder_kw = (asset_load / source_load_before * source_stats["active_sum"]) if source_load_before > 0 else 0
        source_ratio_after = ((source_stats["active_sum"] - feeder_kw) / source_stats["power_kw"] * 100) if source_stats["power_kw"] > 0 else 0
        target_ratio_after = ((target_stats["active_sum"] + feeder_kw) / target_stats["power_kw"] * 100) if target_stats["power_kw"] > 0 else 0
    else:
        source_ratio_after = source_ratio_before
        target_ratio_after = target_ratio_before

    import calendar
    now = datetime.now()
    _, last_day = calendar.monthrange(now.year, now.month)
    end_of_month = now.replace(day=last_day, hour=23, minute=59, second=59, microsecond=999999)
    future_hours_delta = end_of_month - now
    future_hours = max(0, int(future_hours_delta.total_seconds() / 3600))
    
    def get_eom_projection(trafo_id, stats):
        forecast = get_cached_forecast(db, trafo_id, now.year, now.month, "xgboost")
        if forecast and forecast.get("predictions"):
            f_active = sum(p["active_kwh"] for p in forecast["predictions"])
            f_cap = sum(p["capacitive_kvarh"] for p in forecast["predictions"])
            return f_active, f_cap
        else:
            hours_so_far = stats.get("measurement_count", 1) or 1
            hourly_active = stats["active_sum"] / hours_so_far
            hourly_cap = stats["cap_sum"] / hours_so_far
            return hourly_active * future_hours, hourly_cap * future_hours

    src_future_active, src_future_cap = get_eom_projection(source_id, source_stats)
    tgt_future_active, tgt_future_cap = get_eom_projection(target_trafo_id, target_stats)
    
    src_eom_active_before = source_stats["active_sum"] + src_future_active
    src_eom_cap_before = source_stats["cap_sum"] + src_future_cap
    source_cap_ratio_before = (src_eom_cap_before / src_eom_active_before * 100) if src_eom_active_before > 0 else 0

    tgt_eom_active_before = target_stats["active_sum"] + tgt_future_active
    tgt_eom_cap_before = target_stats["cap_sum"] + tgt_future_cap
    target_cap_ratio_before = (tgt_eom_cap_before / tgt_eom_active_before * 100) if tgt_eom_active_before > 0 else 0

    source_cap_ratio_after = source_cap_ratio_before
    target_cap_ratio_after = target_cap_ratio_before

    if asset_type == "feeder":
        # Calculate the absolute physical EOM load of this feeder
        # based on its weight relative to the source transformer's total weight
        feeder_ratio = (asset_load / source_load_before) if source_load_before > 0 else 0
        feeder_physical_eom_active = src_eom_active_before * feeder_ratio
        feeder_physical_eom_cap = src_eom_cap_before * feeder_ratio
        
        src_eom_active_after = max(1, src_eom_active_before - feeder_physical_eom_active)
        src_eom_cap_after = max(0, src_eom_cap_before - feeder_physical_eom_cap)
        source_cap_ratio_after = (src_eom_cap_after / src_eom_active_after) * 100 if src_eom_active_after > 0 else 0
        
        tgt_eom_active_after = tgt_eom_active_before + feeder_physical_eom_active
        tgt_eom_cap_after = tgt_eom_cap_before + feeder_physical_eom_cap
        target_cap_ratio_after = (tgt_eom_cap_after / tgt_eom_active_after) * 100 if tgt_eom_active_after > 0 else 0

    elif asset_type == "reactor":
        cap_diff = asset.capacity_kvar * future_hours
        
        src_eom_cap_after = src_eom_cap_before + cap_diff
        source_cap_ratio_after = (src_eom_cap_after / src_eom_active_before) * 100 if src_eom_active_before > 0 else 0
        
        tgt_eom_cap_after = max(0, tgt_eom_cap_before - cap_diff)
        target_cap_ratio_after = (tgt_eom_cap_after / tgt_eom_active_before) * 100 if tgt_eom_active_before > 0 else 0

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
            f"kapasitif oranı artırabilir. Ay sonu tahmini (müdahalesiz): %{source_cap_ratio_before:.1f}"
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
        "source_cap_ratio_before": round(source_cap_ratio_before, 1),
        "source_cap_ratio_after": round(source_cap_ratio_after, 1),
        "target_cap_ratio_before": round(target_cap_ratio_before, 1),
        "target_cap_ratio_after": round(target_cap_ratio_after, 1),
        "source_risk_before": _calculate_risk_level(source_ratio_before),
        "source_risk_after": _calculate_risk_level(source_ratio_after),
        "target_risk_before": _calculate_risk_level(target_ratio_before),
        "target_risk_after": _calculate_risk_level(target_ratio_after),
        "is_overload": is_overload,
        "overload_warning": overload_warning,
        "reactive_improvement": reactive_msg
    }


def apply_maneuver(db: Session, asset_type: str, asset_id: str, target_trafo_id: str, reason: Optional[str] = None, override_overload: bool = False):
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
        asset.alternative_transformer_id = old_trafo_id  # type: ignore
        asset.current_transformer_id = target_trafo_id  # type: ignore

        impact = "Kritik (Aşırı Yüklü)" if target_stats and target_stats.get("power_kw", 0) > 0 and (target_stats["total_feeder_load"] + asset.simulated_load_kw) / target_stats["power_kw"] > 1 else "Orta"

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
        
        # Trigger forecast updates
        clear_caches()
        import threading
        threading.Thread(target=run_weekly_batch_forecast, args=([old_trafo_id, target_trafo_id],)).start()
        
        return log

    elif asset_type == "reactor":
        asset = db.query(models.Reactor).filter(models.Reactor.id == asset_id).first()
        if not asset:
            return None
        old_trafo_id = asset.current_transformer_id
        
        if old_trafo_id == target_trafo_id:
            if str(asset.status) == "inactive":
                asset.status = "active"  # type: ignore
            else:
                raise ValueError(f"Reaktör zaten '{target_trafo_id}' trafosuna bağlı ve aktif durumda.")
            
        if asset.alternative_transformer_id and target_trafo_id != asset.alternative_transformer_id and old_trafo_id != target_trafo_id:
            raise ValueError(f"Reaktör sadece alternatif trafosuna ({asset.alternative_transformer_id}) aktarılabilir.")

        old_trafo = db.query(models.Transformer).filter(models.Transformer.id == old_trafo_id).first()
        new_trafo = db.query(models.Transformer).filter(models.Transformer.id == target_trafo_id).first()
        if not new_trafo:
            return None

        if old_trafo_id != target_trafo_id:
            asset.alternative_transformer_id = old_trafo_id  # type: ignore
            asset.current_transformer_id = target_trafo_id  # type: ignore

        log = models.ManeuverLog(
            action_type="reactor_transfer",
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
        
        # Trigger forecast updates
        clear_caches()
        import threading
        threading.Thread(target=run_weekly_batch_forecast, args=([old_trafo_id, target_trafo_id],)).start()
        
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

    log.status = "rolled_back"  # type: ignore
    log.rolled_back_at = datetime.now()  # type: ignore
    db.commit()
    db.refresh(log)
    
    # Trigger forecast updates
    clear_caches()
    import threading
    threading.Thread(target=run_weekly_batch_forecast, args=([log.source_trafo_id, log.target_trafo_id],)).start()
    
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
        simulated_load_kw=feeder_data.simulated_load_kw,
        pos_x=getattr(feeder_data, 'pos_x', None),
        pos_y=getattr(feeder_data, 'pos_y', None)
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
        status=reactor_data.status,
        pos_x=getattr(reactor_data, 'pos_x', None),
        pos_y=getattr(reactor_data, 'pos_y', None)
    )
    db.add(reactor)
    db.commit()
    db.refresh(reactor)
    return reactor


def create_transformer(db: Session, trafo_data):
    """Create a new transformer."""
    existing = db.query(models.Transformer).filter(models.Transformer.id == trafo_data.id).first()
    if existing:
        return None

    trafo = models.Transformer(
        id=trafo_data.id,
        name=trafo_data.name,
        region=trafo_data.region,
        power_mva=trafo_data.power_mva,
        status=trafo_data.status,
        pos_x=getattr(trafo_data, 'pos_x', None),
        pos_y=getattr(trafo_data, 'pos_y', None)
    )
    db.add(trafo)
    db.commit()
    db.refresh(trafo)
    return trafo


def bulk_update_topology(db: Session, bulk_data):
    """Bulk update topology: create new assets and update positions/connections."""
    created_trafos = []
    created_feeders = []
    created_reactors = []

    for t_data in bulk_data.new_transformers:
        t = create_transformer(db, t_data)
        if t:
            created_trafos.append(t.id)

    for f_data in bulk_data.new_feeders:
        f = create_feeder(db, f_data)
        if f:
            created_feeders.append(f.id)

    for r_data in bulk_data.new_reactors:
        r = create_reactor(db, r_data)
        if r:
            created_reactors.append(r.id)

    for item in bulk_data.updated_assets:
        if item.type == 'trafo':
            asset = db.query(models.Transformer).filter(models.Transformer.id == item.id).first()
            if asset:
                asset.pos_x = item.pos_x
                asset.pos_y = item.pos_y
        elif item.type == 'feeder':
            asset = db.query(models.Feeder).filter(models.Feeder.id == item.id).first()
            if asset:
                asset.pos_x = item.pos_x
                asset.pos_y = item.pos_y
                if item.current_transformer_id:
                    asset.current_transformer_id = item.current_transformer_id
                if item.alternative_transformer_id:
                    asset.alternative_transformer_id = item.alternative_transformer_id
        elif item.type == 'reactor':
            asset = db.query(models.Reactor).filter(models.Reactor.id == item.id).first()
            if asset:
                asset.pos_x = item.pos_x
                asset.pos_y = item.pos_y
                if item.current_transformer_id:
                    asset.current_transformer_id = item.current_transformer_id
                if item.alternative_transformer_id:
                    asset.alternative_transformer_id = item.alternative_transformer_id

    db.commit()
    return {
        "created_transformers": created_trafos,
        "created_feeders": created_feeders,
        "created_reactors": created_reactors,
        "updated_positions_count": len(bulk_data.updated_assets)
    }


def delete_feeder(db: Session, feeder_id: str):
    """Delete a feeder."""
    feeder = db.query(models.Feeder).filter(models.Feeder.id == feeder_id).first()
    if not feeder:
        return False
    db.delete(feeder)
    db.commit()
    return True


def delete_reactor(db: Session, reactor_id: str):
    """Delete a reactor."""
    reactor = db.query(models.Reactor).filter(models.Reactor.id == reactor_id).first()
    if not reactor:
        return False
    db.delete(reactor)
    db.commit()
    return True
