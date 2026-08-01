def test_websocket_telemetry_connect(client):
    # Test websocket endpoint connection without blocking
    with client.websocket_connect("/ws") as websocket:
        assert websocket is not None
