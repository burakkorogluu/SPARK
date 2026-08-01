import models
from sqlalchemy import create_engine, extract
from sqlalchemy.orm import sessionmaker

engine = create_engine('sqlite:////Users/alimertcaylak/Desktop/SPARK/backend/osos_sim.db')
SessionLocal = sessionmaker(bind=engine)
db = SessionLocal()

query = db.query(models.SystemAlert)
query = query.filter(extract('month', models.SystemAlert.timestamp) == 8)
results = query.all()
for r in results:
    print(r.id, r.timestamp, r.alert_type)
