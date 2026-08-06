import os
import time
import logging

logger = logging.getLogger("spark.forecast")

FORECAST_CACHE = {}
CACHE_TTL = int(os.getenv("FORECAST_CACHE_TTL", "3600"))

TRAINED_MODELS_CACHE = {}
MODEL_CACHE_TTL = int(os.getenv("MODEL_CACHE_TTL", "86400"))


MIN_MEASUREMENTS_FOR_ML_FORECAST = 336

def clear_caches(trafo_ids=None):
    if trafo_ids:
        keys_to_delete = []
        for k in FORECAST_CACHE.keys():
            for t_id in trafo_ids:
                if k.startswith(f"{t_id}_"):
                    keys_to_delete.append(k)
        for k in keys_to_delete:
            FORECAST_CACHE.pop(k, None)
    else:
        FORECAST_CACHE.clear()

def _purge_expired_forecast_cache():
    now = time.time()
    expired_keys = [k for k, (t, _) in FORECAST_CACHE.items() if now - t >= CACHE_TTL]
    for k in expired_keys:
        del FORECAST_CACHE[k]
