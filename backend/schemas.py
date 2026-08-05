from pydantic import BaseModel, Field, ConfigDict
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

    model_config = ConfigDict(from_attributes=True)

class TransformerBase(BaseModel):
    id: str
    name: str
    region: str
    power_mva: int
    status: str
    pos_x: Optional[float] = None
    pos_y: Optional[float] = None

class Transformer(TransformerBase):
    model_config = ConfigDict(from_attributes=True)

class ProcessedMeasurement(Measurement):
    kapasitifOran: float
    enduktifOran: float
    kumulatifKapasitifOran: float
    kumulatifEnduktifOran: float
    riskDurumu: str
    
    model_config = ConfigDict(from_attributes=True)

class Feeder(BaseModel):
    id: str
    name: str
    current_transformer_id: str
    alternative_transformer_id: Optional[str] = None
    simulated_load_kw: float
    pos_x: Optional[float] = None
    pos_y: Optional[float] = None

    model_config = ConfigDict(from_attributes=True)

class Reactor(BaseModel):
    id: str
    name: str
    current_transformer_id: str
    alternative_transformer_id: Optional[str] = None
    capacity_kvar: float
    status: str
    pos_x: Optional[float] = None
    pos_y: Optional[float] = None

    model_config = ConfigDict(from_attributes=True)

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

    model_config = ConfigDict(from_attributes=True)

class ManeuverHistoryResponse(BaseModel):
    total: int
    limit: int
    offset: int
    logs: List[ManeuverLogResponse]

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
    id: str = Field(max_length=50, pattern=r"^[A-Za-z0-9_-]+$")
    name: str = Field(max_length=100, pattern=r"^[^<>]+$")
    current_transformer_id: str
    alternative_transformer_id: Optional[str] = None
    simulated_load_kw: float = 500.0
    pos_x: Optional[float] = None
    pos_y: Optional[float] = None

class ReactorCreate(BaseModel):
    id: str = Field(max_length=50, pattern=r"^[A-Za-z0-9_-]+$")
    name: str = Field(max_length=100, pattern=r"^[^<>]+$")
    current_transformer_id: str
    alternative_transformer_id: Optional[str] = None
    capacity_kvar: float = 250.0
    status: str = "active"
    pos_x: Optional[float] = None
    pos_y: Optional[float] = None

class TransformerCreate(BaseModel):
    id: str = Field(max_length=50, pattern=r"^[A-Za-z0-9_-]+$")
    name: str = Field(max_length=100, pattern=r"^[^<>]+$")
    region: str = "İstanbul-Anadolu"
    power_mva: int = 50
    status: str = "active"
    pos_x: Optional[float] = None
    pos_y: Optional[float] = None

class AssetPositionUpdate(BaseModel):
    id: str
    type: str
    pos_x: float
    pos_y: float
    current_transformer_id: Optional[str] = None
    alternative_transformer_id: Optional[str] = None

class TopologyBulkUpdateRequest(BaseModel):
    new_transformers: List[TransformerCreate] = []
    new_feeders: List[FeederCreate] = []
    new_reactors: List[ReactorCreate] = []
    updated_assets: List[AssetPositionUpdate] = []

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

# ── PowerFlow & SimBench Schemas ──
class PowerFlowActionRequest(BaseModel):
    element_type: str = Field(..., description="Element type to toggle (e.g., 'switch', 'shunt', 'line')")
    element_id: int = Field(..., description="Pandapower index of the element")
    action: str = Field(..., description="'open' or 'close' (or 'in_service' vs 'out_of_service')")
    reason: Optional[str] = None

class PowerFlowResultResponse(BaseModel):
    status: str
    message: str
    element_type: Optional[str] = None
    element_id: Optional[int] = None
    new_state: Optional[str] = None
    summary: dict = Field(..., description="Summary of grid state after power flow")
