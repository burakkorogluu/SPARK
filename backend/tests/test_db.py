from database import SessionLocal
from models import ForecastMeasurement, Measurement
import datetime
import calendar
db = SessionLocal()
sim_now = datetime.datetime.now()
year, month = 2026, 8
last_day = calendar.monthrange(year, month)[1]
end_of_month = datetime.datetime(year, month, last_day, 23, 59, 59)

for t in ["UMR-TRA", "UMR-TRB", "KRT-TRA", "KRT-TRB", "SIS-TRA", "KAD-TRA", "BSK-TRA"]:
    last_m = db.query(Measurement).filter(Measurement.transformer_id == t, Measurement.timestamp <= sim_now).order_by(Measurement.timestamp.desc()).first()
    if not last_m:
        print(f"{t}: NO MEASUREMENTS")
        continue
    db_forecasts = db.query(ForecastMeasurement).filter(
        ForecastMeasurement.transformer_id == t,
        ForecastMeasurement.model_type == "ensemble",
        ForecastMeasurement.timestamp > last_m.timestamp,
        ForecastMeasurement.timestamp <= end_of_month
    ).order_by(ForecastMeasurement.timestamp.asc()).all()
    delta = end_of_month - last_m.timestamp
    steps = int(delta.total_seconds() / 3600)
    print(f"{t}: db count={len(db_forecasts)}, required={steps*0.9}")
