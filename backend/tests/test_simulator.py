from datetime import datetime
from simulator import generate_measurement_values, get_historical_baseline
from db import models

def test_generate_measurement_values(db_session):
    trafo = models.Transformer(id="TEST-TRAFO", name="Test Trafo", power_mva=10, status="active")
    db_session.add(trafo)
    db_session.commit()

    now = datetime.now()
    active, inductive, capacitive = generate_measurement_values(db_session, trafo, now)

    assert isinstance(active, int)
    assert isinstance(inductive, int)
    assert isinstance(capacitive, int)
    assert active >= 0
    assert inductive >= 0
    assert capacitive >= 0

def test_get_historical_baseline_empty(db_session):
    now = datetime.now()
    res = get_historical_baseline(db_session, "NONEXISTENT", now)
    assert res is None
