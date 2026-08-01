import re

with open("services/alert_service.py", "r") as f:
    code = f.read()

new_code = re.sub(
    r'def get_active_alerts\(db: Session, limit: int = 20, year: Optional\[int\] = None, month: Optional\[int\] = None\):\s*"""[^"]*"""\s*from sqlalchemy import extract\s*query = db\.query\(models\.SystemAlert\)\s*if year:\s*query = query\.filter\(extract\(\'year\', models\.SystemAlert\.timestamp\) == year\)\s*if month:\s*query = query\.filter\(extract\(\'month\', models\.SystemAlert\.timestamp\) == month\)',
    'def get_active_alerts(db: Session, limit: int = 20, year: Optional[int] = None, month: Optional[int] = None):\n    """Veritabanındaki son sistem alarmlarını, seçilen aya göre filtreleyerek döndürür."""\n    from sqlalchemy import extract\n    from datetime import datetime\n    query = db.query(models.SystemAlert)\n    \n    if not year:\n        year = datetime.now().year\n    if not month:\n        month = datetime.now().month\n        \n    if year:\n        query = query.filter(extract(\'year\', models.SystemAlert.timestamp) == year)\n    if month:\n        query = query.filter(extract(\'month\', models.SystemAlert.timestamp) == month)',
    code
)

with open("services/alert_service.py", "w") as f:
    f.write(new_code)
