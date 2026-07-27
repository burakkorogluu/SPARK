# pyrefly: ignore [missing-import]
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey
# pyrefly: ignore [missing-import]
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
    feeders = relationship("Feeder", foreign_keys="[Feeder.current_transformer_id]", back_populates="current_transformer")
    reactors = relationship("Reactor", foreign_keys="[Reactor.current_transformer_id]", back_populates="current_transformer")

class Measurement(Base):
    __tablename__ = "measurements"

    id = Column(Integer, primary_key=True, index=True)
    transformer_id = Column(String, ForeignKey("transformers.id"))
    timestamp = Column(DateTime, index=True)
    active_kwh = Column(Integer)
    inductive_kvarh = Column(Integer)
    capacitive_kvarh = Column(Integer)

    transformer = relationship("Transformer", back_populates="measurements")

class WeatherData(Base):
    __tablename__ = "weather_data"

    timestamp = Column(DateTime, primary_key=True, index=True)
    temperature = Column(Float)

class Feeder(Base):
    __tablename__ = "feeders"

    id = Column(String, primary_key=True, index=True)
    name = Column(String)
    current_transformer_id = Column(String, ForeignKey("transformers.id"))
    alternative_transformer_id = Column(String, ForeignKey("transformers.id"))
    simulated_load_kw = Column(Float, default=500.0)

    current_transformer = relationship("Transformer", foreign_keys=[current_transformer_id], back_populates="feeders")
    alternative_transformer = relationship("Transformer", foreign_keys=[alternative_transformer_id])

class Reactor(Base):
    __tablename__ = "reactors"

    id = Column(String, primary_key=True, index=True)
    name = Column(String)
    current_transformer_id = Column(String, ForeignKey("transformers.id"))
    alternative_transformer_id = Column(String, ForeignKey("transformers.id"))
    capacity_kvar = Column(Float, default=250.0)
    status = Column(String, default="active")

    current_transformer = relationship("Transformer", foreign_keys=[current_transformer_id], back_populates="reactors")
    alternative_transformer = relationship("Transformer", foreign_keys=[alternative_transformer_id])


