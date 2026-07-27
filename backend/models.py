from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from database import Base
import datetime

class Transformer(Base):
    __tablename__ = "transformers"

    id = Column(String, primary_key=True, index=True)
    name = Column(String)
    region = Column(String)
    power_mva = Column(Integer)
    status = Column(String, default="active")

    measurements = relationship("Measurement", back_populates="transformer")

class Measurement(Base):
    __tablename__ = "measurements"

    id = Column(Integer, primary_key=True, index=True)
    transformer_id = Column(String, ForeignKey("transformers.id"))
    timestamp = Column(DateTime, index=True)
    active_kwh = Column(Integer)
    inductive_kvarh = Column(Integer)
    capacitive_kvarh = Column(Integer)

    transformer = relationship("Transformer", back_populates="measurements")
