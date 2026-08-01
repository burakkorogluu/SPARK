# pyrefly: ignore [missing-import]
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, UniqueConstraint
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import relationship
from database import Base
import datetime
from typing import Any

class Transformer(Base):
    __tablename__ = "transformers"

    id = Column(String, primary_key=True, index=True)
    name = Column(String)
    region = Column(String)
    power_mva = Column(Integer)
    status = Column(String, default="active")
    pos_x = Column(Float, nullable=True)
    pos_y = Column(Float, nullable=True)

    measurements = relationship("Measurement", back_populates="transformer")
    feeders = relationship("Feeder", foreign_keys="[Feeder.current_transformer_id]", back_populates="current_transformer")
    reactors = relationship("Reactor", foreign_keys="[Reactor.current_transformer_id]", back_populates="current_transformer")

class Measurement(Base):
    __tablename__ = "measurements"
    __table_args__ = (
        UniqueConstraint('transformer_id', 'timestamp', name='_trafo_time_uc'),
    )

    id = Column(Integer, primary_key=True, index=True)
    transformer_id = Column(String, ForeignKey("transformers.id"))
    timestamp = Column(DateTime, index=True)
    active_kwh: Any = Column(Integer)
    inductive_kvarh: Any = Column(Integer)
    capacitive_kvarh: Any = Column(Integer)

    transformer = relationship("Transformer", back_populates="measurements")

class WeatherData(Base):
    __tablename__ = "weather_data"

    timestamp = Column(DateTime, primary_key=True, index=True)
    temperature = Column(Float)
    humidity = Column(Float, nullable=True)
    wind_speed = Column(Float, nullable=True)
    wind_direction = Column(Float, nullable=True)
    precipitation = Column(Float, nullable=True)
    cloud_cover = Column(Float, nullable=True)

class Feeder(Base):
    __tablename__ = "feeders"

    id = Column(String, primary_key=True, index=True)
    name = Column(String)
    current_transformer_id = Column(String, ForeignKey("transformers.id"))
    alternative_transformer_id = Column(String, ForeignKey("transformers.id"))
    simulated_load_kw = Column(Float, default=500.0)
    pos_x = Column(Float, nullable=True)
    pos_y = Column(Float, nullable=True)

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
    pos_x = Column(Float, nullable=True)
    pos_y = Column(Float, nullable=True)

    current_transformer = relationship("Transformer", foreign_keys=[current_transformer_id], back_populates="reactors")
    alternative_transformer = relationship("Transformer", foreign_keys=[alternative_transformer_id])

class ManeuverLog(Base):
    __tablename__ = "maneuver_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, default=datetime.datetime.now, index=True)
    action_type = Column(String)         # "feeder_transfer" | "reactor_transfer"
    asset_type = Column(String)          # "feeder" | "reactor"
    asset_id = Column(String)            # Fider/Reaktör ID
    asset_name = Column(String)          # Fider/Reaktör adı
    source_trafo_id = Column(String, ForeignKey("transformers.id"))
    target_trafo_id = Column(String, ForeignKey("transformers.id"))
    source_trafo_name = Column(String)
    target_trafo_name = Column(String)
    reason = Column(String, nullable=True)              # Manevra gerekçesi
    impact_level = Column(String, default="Orta")       # "Yüksek" | "Orta" | "Düşük"
    status: Any = Column(String, default="applied")           # "applied" | "rolled_back"
    rolled_back_at: Any = Column(DateTime, nullable=True)

    source_transformer = relationship("Transformer", foreign_keys=[source_trafo_id])
    target_transformer = relationship("Transformer", foreign_keys=[target_trafo_id])


class SystemAlert(Base):
    __tablename__ = "system_alerts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, default=datetime.datetime.now, index=True)
    transformer_id = Column(String, ForeignKey("transformers.id"))
    alert_type = Column(String)    # "capacitive_penalty" | "inductive_penalty" | "warning" | "info"
    severity = Column(String)      # "critical" | "warning" | "info"
    message = Column(String)
    is_read = Column(Integer, default=0)

    transformer = relationship("Transformer")


class ForecastMeasurement(Base):
    __tablename__ = "forecast_measurements"
    __table_args__ = (
        UniqueConstraint('transformer_id', 'timestamp', 'model_type', name='_trafo_time_model_uc'),
    )

    id = Column(Integer, primary_key=True, index=True)
    transformer_id = Column(String, ForeignKey("transformers.id"))
    timestamp = Column(DateTime, index=True)
    model_type = Column(String, index=True)
    active_kwh = Column(Float)
    inductive_kvarh = Column(Float)
    capacitive_kvarh = Column(Float)
    confidence_score = Column(Float, nullable=True)
    kap_reason = Column(String, nullable=True)
    end_reason = Column(String, nullable=True)

    transformer = relationship("Transformer")
