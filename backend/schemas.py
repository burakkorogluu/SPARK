from pydantic import BaseModel
from datetime import datetime
from typing import List, Optional

class MeasurementBase(BaseModel):
    timestamp: datetime
    active_kwh: int
    inductive_kvarh: int
    capacitive_kvarh: int

class MeasurementCreate(MeasurementBase):
    transformer_id: str

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

# ── Manevra Log Schemas ──
class ManeuverLogResponse(BaseModel):
    id: int
    timestamp: datetime
    action_type: str
    asset_type: str
    asset_id: str
    asset_name: str
    source_trafo_id: str
    target_trafo_id: str
    source_trafo_name: str
    target_trafo_name: str
    reason: Optional[str] = None
    impact_level: str
    status: str
    rolled_back_at: Optional[datetime] = None

    class Config:
        from_attributes = True

# ── Simülasyon Schemas ──
class ManeuverSimulationResponse(BaseModel):
    asset_type: str
    asset_id: str
    asset_name: str
    source_trafo_id: str
    source_trafo_name: str
    target_trafo_id: str
    target_trafo_name: str
    source_load_before: float
    source_load_after: float
    target_load_before: float
    target_load_after: float
    source_load_ratio_before: float
    source_load_ratio_after: float
    target_load_ratio_before: float
    target_load_ratio_after: float
    source_risk_before: str
    source_risk_after: str
    target_risk_before: str
    target_risk_after: str
    reactive_improvement: Optional[str] = None

# ── Fider/Reaktör CRUD Schemas ──
class FeederCreate(BaseModel):
    id: str
    name: str
    current_transformer_id: str
    alternative_transformer_id: Optional[str] = None
    simulated_load_kw: float = 500.0

class ReactorCreate(BaseModel):
    id: str
    name: str
    current_transformer_id: str
    alternative_transformer_id: Optional[str] = None
    capacity_kvar: float = 250.0
    status: str = "active"

# ── Manevra Uygulama İsteği ──
class ManeuverApplyRequest(BaseModel):
    asset_type: str
    asset_id: str
    target_trafo_id: str
    reason: Optional[str] = None
    override_overload: bool = False

# ── SCADA Kontrol Schemas ──
class ScadaBreakerToggleRequest(BaseModel):
    breaker_id: str
    target_state: bool
    trafo_id: Optional[str] = "UMR-TRA"
    reason: Optional[str] = "SCADA Operatör Manevrası"

class ScadaAlarmAckRequest(BaseModel):
    alarm_id: str
