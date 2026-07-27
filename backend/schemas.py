from pydantic import BaseModel
from datetime import datetime
from typing import List, Optional

class MeasurementBase(BaseModel):
    timestamp: datetime
    active_kwh: int
    inductive_kvarh: int
    capacitive_kvarh: int

class Measurement(MeasurementBase):
    id: int
    transformer_id: str

    class Config:
        from_attributes = True

class TransformerBase(BaseModel):
    id: str
    name: str
    region: str
    power_mva: int
    status: str

class Transformer(TransformerBase):
    class Config:
        from_attributes = True

class ProcessedMeasurement(Measurement):
    kapasitifOran: float
    enduktifOran: float
    kumulatifKapasitifOran: float
    kumulatifEnduktifOran: float
    riskDurumu: str
    
    class Config:
        from_attributes = True

class Feeder(BaseModel):
    id: str
    name: str
    current_transformer_id: str
    alternative_transformer_id: Optional[str] = None
    simulated_load_kw: float

    class Config:
        from_attributes = True

class Reactor(BaseModel):
    id: str
    name: str
    current_transformer_id: str
    alternative_transformer_id: Optional[str] = None
    capacity_kvar: float
    status: str

    class Config:
        from_attributes = True

