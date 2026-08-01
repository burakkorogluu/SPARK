def test_get_transformers(client):
    response = client.get("/api/transformers")
    assert response.status_code == 200
    assert isinstance(response.json(), list)

def test_get_forecast_invalid_method(client):
    response = client.get("/api/forecast?transformer_id=UMR-TRA&year=2025&month=7&method=invalid_method")
    assert response.status_code == 422  # FastAPI validation error

def test_get_alerts(client):
    response = client.get("/api/alerts")
    assert response.status_code == 200
    assert isinstance(response.json(), list)

def test_get_maneuver_suggestions(client):
    response = client.get("/api/maneuver/suggest")
    assert response.status_code == 200
    assert isinstance(response.json(), list)

def test_get_maneuver_history(client):
    response = client.get("/api/maneuver/history")
    assert response.status_code == 200
    data = response.json()
    assert "logs" in data
    assert "total" in data
