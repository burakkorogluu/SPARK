import logging
from db.database import SessionLocal
from services.forecast_service import run_weekly_batch_forecast

logging.basicConfig(level=logging.INFO)

def main():
    print("Starting background forecast caching...")
    run_weekly_batch_forecast()
    print("Done!")

if __name__ == "__main__":
    main()
