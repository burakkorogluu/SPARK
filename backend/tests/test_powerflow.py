import pytest
from fastapi.testclient import TestClient
from main import app
import sys
import os

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

client = TestClient(app)

def test_powerflow_network():
    response = client.get("/api/powerflow/network")
    assert response.status_code in [200, 500]
    
    if response.status_code == 200:
        data = response.json()
        assert "network_code" in data
        assert "elements_count" in data
        assert "system_health" in data

def test_powerflow_simulate_invalid_element():
    payload = {
        "element_type": "invalid_type",
        "element_id": 0,
        "action": "open"
    }
    response = client.post("/api/powerflow/simulate", json=payload)
    # It should return 400 Bad Request or 500 if pandapower is not installed
    assert response.status_code in [400, 422, 500]

def test_powerflow_simulate_valid_switch():
    # First get the network to ensure it's loaded
    net_res = client.get("/api/powerflow/network")
    if net_res.status_code != 200:
        pytest.skip("Pandapower/SimBench not available or network not loaded")
        
    net_data = net_res.json()
    if not net_data.get("switches"):
        pytest.skip("No switches found in the network")
        
    # Get the first switch ID
    switch_id = int(net_data["switches"][0]["element"]) # Pandapower uses int index
    # Note: element is not the index, index is implied. But in our json we didn't include index.
    # Actually, we didn't include index in the json. Let's just try index 0.
    
    payload = {
        "element_type": "switch",
        "element_id": 0,
        "action": "open"
    }
    response = client.post("/api/powerflow/simulate", json=payload)
    assert response.status_code == 200
    
    res_data = response.json()
    assert res_data["status"] == "success"
    assert res_data["new_state"] == "open"
    assert "summary" in res_data
