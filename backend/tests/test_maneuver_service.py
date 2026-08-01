import pytest
from services.maneuver_service import (
    _calculate_risk_level,
    _calculate_suggestion_score,
    simulate_maneuver,
    apply_maneuver,
    rollback_maneuver,
    get_maneuver_history
)
import models

def test_calculate_risk_level():
    assert _calculate_risk_level(90) == "tehlikeli"
    assert _calculate_risk_level(75) == "riskli"
    assert _calculate_risk_level(60) == "dikkat"
    assert _calculate_risk_level(40) == "normal"
    assert _calculate_risk_level(20) == "guvenli"

def test_calculate_suggestion_score():
    stats = {"load_ratio": 90, "cap_ratio": 16, "ind_ratio": 5}
    alt_stats = {"load_ratio": 30}
    score = _calculate_suggestion_score(stats, alt_stats, load_diff=60, is_reactive=False)
    assert 0 <= score <= 100
    assert score > 50

def test_maneuver_flow(db_session):
    # Setup test data
    t1 = models.Transformer(id="TRAFO-1", name="Trafo 1", power_mva=10, status="active")
    t2 = models.Transformer(id="TRAFO-2", name="Trafo 2", power_mva=10, status="active")
    f1 = models.Feeder(
        id="F-1", name="Feeder 1",
        current_transformer_id="TRAFO-1",
        alternative_transformer_id="TRAFO-2",
        simulated_load_kw=500.0
    )
    r1 = models.Reactor(
        id="R-1", name="Reactor 1",
        current_transformer_id="TRAFO-1",
        alternative_transformer_id="TRAFO-2",
        capacity_kvar=250.0, status="inactive"
    )
    db_session.add_all([t1, t2, f1, r1])
    db_session.commit()

    # 1. Simulate feeder maneuver
    sim_res = simulate_maneuver(db_session, "feeder", "F-1", "TRAFO-2")
    assert sim_res is not None
    assert sim_res["asset_id"] == "F-1"
    assert sim_res["target_trafo_id"] == "TRAFO-2"

    # 2. Test Invalid Topology (Transfering to non-alternative transformer)
    t3 = models.Transformer(id="TRAFO-3", name="Trafo 3", power_mva=10)
    db_session.add(t3)
    db_session.commit()
    
    with pytest.raises(ValueError, match="fiziksel hat topolojisi"):
        simulate_maneuver(db_session, "feeder", "F-1", "TRAFO-3")

    # 3. Apply feeder maneuver
    log = apply_maneuver(db_session, "feeder", "F-1", "TRAFO-2", reason="Test transfer")
    assert log is not None
    assert log.status == "applied"
    assert log.source_trafo_id == "TRAFO-1"
    assert log.target_trafo_id == "TRAFO-2"

    # Verify feeder assignment swapped
    updated_f1 = db_session.query(models.Feeder).filter(models.Feeder.id == "F-1").first()
    assert updated_f1.current_transformer_id == "TRAFO-2"
    assert updated_f1.alternative_transformer_id == "TRAFO-1"

    # 4. Get Maneuver History
    history = get_maneuver_history(db_session)
    assert history["total"] >= 1
    assert len(history["logs"]) >= 1

    # 5. Rollback maneuver
    rolled_back = rollback_maneuver(db_session, log.id)
    assert rolled_back is not None
    assert rolled_back.status == "rolled_back"
    
    # Verify feeder restored to original
    restored_f1 = db_session.query(models.Feeder).filter(models.Feeder.id == "F-1").first()
    assert restored_f1.current_transformer_id == "TRAFO-1"
    assert restored_f1.alternative_transformer_id == "TRAFO-2"
