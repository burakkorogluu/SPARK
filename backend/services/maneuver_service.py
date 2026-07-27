# pyrefly: ignore [missing-import]
from sqlalchemy.orm import Session
import models
from datetime import datetime, timedelta

def analyze_and_suggest_maneuvers(db: Session):
    suggestions = []
    transformers = db.query(models.Transformer).all()
    
    # Calculate load and reactive state for each transformer
    trafo_stats = {}
    for trafo in transformers:
        # Get latest measurements (or last 24 hours average)
        recent_measurements = db.query(models.Measurement).filter(
            models.Measurement.transformer_id == trafo.id
        ).order_by(models.Measurement.timestamp.desc()).limit(24).all()

        active_sum = sum(m.active_kwh for m in recent_measurements) if recent_measurements else 0
        ind_sum = sum(m.inductive_kvarh for m in recent_measurements) if recent_measurements else 0
        cap_sum = sum(m.capacitive_kvarh for m in recent_measurements) if recent_measurements else 0

        total_feeder_load = sum(f.simulated_load_kw for f in trafo.feeders)
        power_kw = trafo.power_mva * 1000  # Convert MVA to approximate kW (assuming cos phi ~ 1)
        load_ratio = (total_feeder_load / power_kw * 100) if power_kw > 0 else 0

        ind_ratio = (ind_sum / active_sum * 100) if active_sum > 0 else 0
        cap_ratio = (cap_sum / active_sum * 100) if active_sum > 0 else 0

        trafo_stats[trafo.id] = {
            "model": trafo,
            "power_kw": power_kw,
            "total_feeder_load": total_feeder_load,
            "load_ratio": load_ratio,
            "ind_ratio": ind_ratio,
            "cap_ratio": cap_ratio,
            "feeders": trafo.feeders,
            "reactors": trafo.reactors
        }

    suggestion_id = 1

    # 1. Check for Load Balancing Opportunities
    for t_id, stats in trafo_stats.items():
        trafo = stats["model"]
        # If load ratio is relatively high (>60%)
        if stats["load_ratio"] > 50:
            for feeder in stats["feeders"]:
                alt_id = feeder.alternative_transformer_id
                if alt_id and alt_id in trafo_stats:
                    alt_stats = trafo_stats[alt_id]
                    # If alternative transformer has lower load ratio
                    if alt_stats["load_ratio"] < stats["load_ratio"] - 15:
                        new_source_load = stats["total_feeder_load"] - feeder.simulated_load_kw
                        new_target_load = alt_stats["total_feeder_load"] + feeder.simulated_load_kw
                        
                        suggestions.append({
                            "id": f"MAN-{suggestion_id:03d}",
                            "title": f"Fider Yük Aktarımı: {feeder.name}",
                            "action_type": "feeder_transfer",
                            "impact": "Yüksek" if stats["load_ratio"] > 75 else "Orta",
                            "source_trafo_id": trafo.id,
                            "source_trafo_name": trafo.name,
                            "target_trafo_id": alt_id,
                            "target_trafo_name": alt_stats["model"].name,
                            "target_asset": feeder.name,
                            "description": f"'{feeder.name}' (yük: {feeder.simulated_load_kw:.0f} kW), %{stats['load_ratio']:.1f} yüklü {trafo.name} trafosundan, %{alt_stats['load_ratio']:.1f} yüklü {alt_stats['model'].name} trafosuna aktarılabilir. Aktarım sonrası kaynak trafo yükü %{(new_source_load/stats['power_kw']*100):.1f}'e düşecektir.",
                            "feeder_id": feeder.id
                        })
                        suggestion_id += 1

        # 2. Check Reactive Compensation / Reactor Maneuvers
        if stats["ind_ratio"] > 15:
            for reactor in stats["reactors"]:
                if reactor.status == "inactive":
                    suggestions.append({
                        "id": f"MAN-{suggestion_id:03d}",
                        "title": f"Reaktör Devreye Alma: {reactor.name}",
                        "action_type": "reactor_switch",
                        "impact": "Yüksek",
                        "source_trafo_id": trafo.id,
                        "source_trafo_name": trafo.name,
                        "target_trafo_id": trafo.id,
                        "target_trafo_name": trafo.name,
                        "target_asset": reactor.name,
                        "description": f"{trafo.name} üzerinde endüktif oran %{stats['ind_ratio']:.1f} seviyesinde. Pasif durumdaki '{reactor.name}' reaktörünün ({reactor.capacity_kvar:.0f} kVAr) devreye alınması önerilmektedir.",
                        "reactor_id": reactor.id
                    })
                    suggestion_id += 1
                elif reactor.alternative_transformer_id and reactor.alternative_transformer_id in trafo_stats:
                    alt_stats = trafo_stats[reactor.alternative_transformer_id]
                    if alt_stats["ind_ratio"] > stats["ind_ratio"] + 10:
                        suggestions.append({
                            "id": f"MAN-{suggestion_id:03d}",
                            "title": f"Reaktör Bağlantı Değişimi: {reactor.name}",
                            "action_type": "reactor_switch",
                            "impact": "Orta",
                            "source_trafo_id": trafo.id,
                            "source_trafo_name": trafo.name,
                            "target_trafo_id": alt_stats["model"].id,
                            "target_trafo_name": alt_stats["model"].name,
                            "target_asset": reactor.name,
                            "description": f"Endüktif kompanzasyon ihtiyacı daha yüksek olan {alt_stats['model'].name} (%{alt_stats['ind_ratio']:.1f}) için '{reactor.name}' reaktörünün bu trafoya aktarılması önerilmektedir.",
                            "reactor_id": reactor.id
                        })
                        suggestion_id += 1

    # Fallback default suggestions if conditions are clear
    if not suggestions:
        # Generate a general optimization recommendation
        first_trafo = transformers[0] if transformers else None
        second_trafo = transformers[1] if len(transformers) > 1 else first_trafo
        if first_trafo and first_trafo.feeders:
            f = first_trafo.feeders[0]
            suggestions.append({
                "id": "MAN-001",
                "title": f"Önleyici Yük Dengeleme: {f.name}",
                "action_type": "feeder_transfer",
                "impact": "Düşük",
                "source_trafo_id": first_trafo.id,
                "source_trafo_name": first_trafo.name,
                "target_trafo_id": f.alternative_transformer_id or second_trafo.id,
                "target_trafo_name": f.alternative_transformer.name if f.alternative_transformer else second_trafo.name,
                "target_asset": f.name,
                "description": f"Peak saatler öncesinde şebeke dengesini korumak için '{f.name}' fiderinin alternatif trafoya aktarılması önerilir.",
                "feeder_id": f.id
            })

    return suggestions

def apply_maneuver(db: Session, asset_type: str, asset_id: str, target_trafo_id: str):
    if asset_type == "feeder":
        feeder = db.query(models.Feeder).filter(models.Feeder.id == asset_id).first()
        if feeder:
            old_trafo_id = feeder.current_transformer_id
            feeder.alternative_transformer_id = old_trafo_id
            feeder.current_transformer_id = target_trafo_id
            db.commit()
            return True
    elif asset_type == "reactor":
        reactor = db.query(models.Reactor).filter(models.Reactor.id == asset_id).first()
        if reactor:
            old_trafo_id = reactor.current_transformer_id
            reactor.alternative_transformer_id = old_trafo_id
            reactor.current_transformer_id = target_trafo_id
            db.commit()
            return True
    return False
