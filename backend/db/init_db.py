from db import models
from db.database import engine, SessionLocal
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import Session

# Create tables
models.Base.metadata.create_all(bind=engine)

def seed_transformers():
    db: Session = SessionLocal()
    # Seed initial TEIAS 2025 transformers from frontend
    if not db.query(models.Transformer).first():
        initial_transformers = [
            models.Transformer(id="UMR-TRA", name="Ümraniye TM – TRA", region="Ümraniye", power_mva=100),
            models.Transformer(id="UMR-TRB", name="Ümraniye TM – TRB", region="Ümraniye", power_mva=100),
            models.Transformer(id="KRT-TRA", name="Kartal TM – TRA", region="Kartal", power_mva=80),
            models.Transformer(id="KRT-TRB", name="Kartal TM – TRB", region="Kartal", power_mva=80),
        ]

        db.add_all(initial_transformers)
        db.commit()
        print("Transformers seeded successfully.")
    else:
        print("Transformers already seeded.")


    # Seed Feeders & Reactors if not present
    if not db.query(models.Feeder).first():
        feeders = [
            models.Feeder(id="FDR-UMR-1", name="Sanayi Fideri 1", current_transformer_id="UMR-TRA", alternative_transformer_id="UMR-TRB", simulated_load_kw=1200.0),
            models.Feeder(id="FDR-UMR-2", name="Konut Fideri 2", current_transformer_id="UMR-TRA", alternative_transformer_id="UMR-TRB", simulated_load_kw=850.0),
            models.Feeder(id="FDR-UMR-3", name="Ticari Fider 3", current_transformer_id="UMR-TRB", alternative_transformer_id="UMR-TRA", simulated_load_kw=400.0),
            models.Feeder(id="FDR-KRT-1", name="Liman Fideri 1", current_transformer_id="KRT-TRA", alternative_transformer_id="KRT-TRB", simulated_load_kw=950.0),
            models.Feeder(id="FDR-KRT-2", name="Şehir Fideri 2", current_transformer_id="KRT-TRB", alternative_transformer_id="KRT-TRA", simulated_load_kw=300.0),
        ]
        db.add_all(feeders)

    if not db.query(models.Reactor).first():
        reactors = [
            models.Reactor(id="RCT-UMR-1", name="Ümraniye Reaktör R1", current_transformer_id="UMR-TRA", alternative_transformer_id="UMR-TRB", capacity_kvar=500.0, status="active"),
            models.Reactor(id="RCT-KRT-1", name="Kartal Reaktör R1", current_transformer_id="KRT-TRB", alternative_transformer_id="KRT-TRA", capacity_kvar=350.0, status="active"),
        ]
        db.add_all(reactors)

    db.commit()
    print("Feeders and Reactors seeded successfully.")
    db.close()

if __name__ == "__main__":
    seed_transformers()

