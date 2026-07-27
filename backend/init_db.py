import models
from database import engine, SessionLocal
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import Session

# Create tables
models.Base.metadata.create_all(bind=engine)

def seed_transformers():
    db: Session = SessionLocal()
    # Check if we already have transformers
    if db.query(models.Transformer).first():
        print("Transformers already seeded.")
        db.close()
        return

    # Seed initial TEIAS 2025 transformers from frontend
    initial_transformers = [
        models.Transformer(id="UMR-TRA", name="Ümraniye TM – TRA", region="Ümraniye", power_mva=100),
        models.Transformer(id="UMR-TRB", name="Ümraniye TM – TRB", region="Ümraniye", power_mva=100),
        models.Transformer(id="KRT-TRA", name="Kartal TM – TRA", region="Kartal", power_mva=80),
        models.Transformer(id="KRT-TRB", name="Kartal TM – TRB", region="Kartal", power_mva=80),
    ]

    db.add_all(initial_transformers)
    db.commit()
    print("Transformers seeded successfully.")
    db.close()

if __name__ == "__main__":
    seed_transformers()
