from fastapi import APIRouter, HTTPException
import schemas

router = APIRouter(prefix='/powerflow')
@router.get("/network")
def get_powerflow_network():
    from services.grid_topology import topology_service
    state = topology_service.get_network_state()
    if "error" in state:
        raise HTTPException(status_code=500, detail=state["error"])
    return state

@router.post("/simulate", response_model=schemas.PowerFlowResultResponse)
def simulate_powerflow_action(req: schemas.PowerFlowActionRequest):
    from services.grid_topology import topology_service
    try:
        res = topology_service.simulate_action(req.element_type, req.element_id, req.action)
        return res
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")

