from fastapi import APIRouter

from .routes.osos import router as osos_router
from .routes.transformers import router as transformers_router
from .routes.analysis import router as analysis_router
from .routes.forecast import router as forecast_router
from .routes.maneuver import router as maneuver_router
from .routes.alerts import router as alerts_router
from .routes.models_eval import router as models_eval_router
from .routes.scada import router as scada_router
from .routes.powerflow import router as powerflow_router
from .routes.websockets import router as websockets_router
from .routes.report import router as report_router

api_router = APIRouter()

api_router.include_router(osos_router, prefix="/api")
api_router.include_router(transformers_router, prefix="/api")
api_router.include_router(analysis_router, prefix="/api")
api_router.include_router(forecast_router, prefix="/api")
api_router.include_router(maneuver_router, prefix="/api")
api_router.include_router(alerts_router, prefix="/api")
api_router.include_router(models_eval_router, prefix="/api")
api_router.include_router(scada_router, prefix="/api")
api_router.include_router(powerflow_router, prefix="/api")
api_router.include_router(report_router, prefix="/api")

# Websockets go to root (or we can just keep them as is, but it's /ws so no /api prefix)
api_router.include_router(websockets_router)
