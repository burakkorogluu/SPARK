from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from core.ws_handler import ws_manager

router = APIRouter()
@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            await ws_manager.broadcast({"type": "ping", "data": data})
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)


