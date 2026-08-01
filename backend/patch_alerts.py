import re

with open("main.py", "r") as f:
    code = f.read()

new_code = re.sub(
    r'def get_alerts_endpoint\(limit: int = 20, year: Optional\[int\] = None, month: Optional\[int\] = None, db: Session = Depends\(get_db\)\):\s*from services.alert_service import get_active_alerts\s*return get_active_alerts\(db, limit, year, month\)',
    'def get_alerts_endpoint(limit: int = 20, year: Optional[int] = None, month: Optional[int] = None, db: Session = Depends(get_db)):\n    print(f"API called: year={year}, month={month}")\n    from services.alert_service import get_active_alerts\n    return get_active_alerts(db, limit, year, month)',
    code
)

with open("main.py", "w") as f:
    f.write(new_code)
