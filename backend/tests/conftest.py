import pytest
import sys
import os

# Add backend dir to python path for pytest
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi.testclient import TestClient
import models
from main import app
from database import Base, engine, SessionLocal

@pytest.fixture(scope="session")
def db_session():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@pytest.fixture(scope="session")
def client(db_session):
    # Using TestClient as a context manager triggers the lifespan events,
    # but here we just ensure db_session ran so Base.metadata.create_all is called.
    with TestClient(app) as c:
        yield c
