import sys
import logging
from sqlalchemy.orm import Session
from database import SessionLocal
from services.maneuver_service import analyze_and_suggest_maneuvers

logging.basicConfig(level=logging.DEBUG)

def main():
    db = SessionLocal()
    try:
        suggestions = analyze_and_suggest_maneuvers(db)
        print("Success!", suggestions)
    except Exception as e:
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    main()
