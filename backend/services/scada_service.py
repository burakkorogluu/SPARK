import random
from sqlalchemy.orm import Session
import models

global_breaker_state = {
    't101-q1': True,
    't102-q1': True,
    'f1': True, 'f2': True, 'f3': True, 'f4': True, 'f5': True, 'f6': True, 'f7': False
}

def generate_telemetry_snapshot(db: Session):
    t1_active = global_breaker_state.get('t101-q1', True)
    t2_active = global_breaker_state.get('t102-q1', True)
    
    t1_kw = random.uniform(8000, 15000) if t1_active else 0.0
    t1_kvar = t1_kw * random.uniform(0.1, 0.3) if t1_active else 0.0
    
    t2_kw = random.uniform(3000, 9000) if t2_active else 0.0
    t2_kvar = t2_kw * random.uniform(0.1, 0.3) if t2_active else 0.0

    return {
        'telemetry': {
            'UMR-TRA': {
                'kw': t1_kw,
                'kvar': t1_kvar,
                'kv': 22.8 if t1_active else 0.0,
                'a': (t1_kw * 1000) / (1.732 * 22800) if t1_active else 0.0
            },
            'KARTAL-TRA': {
                'kw': t2_kw,
                'kvar': t2_kvar,
                'kv': 22.8 if t2_active else 0.0,
                'a': (t2_kw * 1000) / (1.732 * 22800) if t2_active else 0.0
            }
        },
        'breakers': global_breaker_state,
        'alarms': []
    }

def toggle_breaker(db: Session, breaker_id: str, target_state: bool, trafo_id: str, reason: str):
    global_breaker_state[breaker_id] = target_state
    
    log = models.ManeuverLog(
        action_type='breaker_toggle',
        asset_type='breaker',
        asset_id=breaker_id,
        asset_name=f'Kesici {breaker_id.upper()}',
        source_trafo_id=trafo_id,
        target_trafo_id=trafo_id,
        source_trafo_name=trafo_id,
        target_trafo_name=trafo_id,
        reason=reason,
        impact_level='Yüksek',
        status='applied'
    )
    db.add(log)
    db.commit()
    
    return {'success': True, 'message': f"Kesici {breaker_id.upper()} başarıyla {'kapatıldı' if target_state else 'açıldı'}."}

def ack_alarm(alarm_id: str):
    return {'success': True}
