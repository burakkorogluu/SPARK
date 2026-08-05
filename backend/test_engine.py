from database import SessionLocal
from services.forecast.engine import get_cached_forecast
import time
import logging
logging.basicConfig(level=logging.DEBUG)

db = SessionLocal()
start = time.time()
print("Starting get_cached_forecast...")
res = get_cached_forecast(db, "UMR-TRB", 2026, 8, "ensemble")
print(f"Time taken: {time.time() - start} seconds")
print(f"Predictions returned: {len(res.get('predictions', []))}")
