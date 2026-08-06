from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List
import schemas
from db import models
from api.deps import get_db

router = APIRouter()
@router.get("/transformers", response_model=List[schemas.Transformer])
def get_transformers(db: Session = Depends(get_db)):
    return db.query(models.Transformer).all()

