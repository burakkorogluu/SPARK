import unittest
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services.analysis_service import hesapla_risk_durumu
from database import SessionLocal, Base, engine

class TestSparkBackend(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        Base.metadata.create_all(bind=engine)
    def test_hesapla_risk_durumu_guvenli(self):
        genel, kap_o, end_o, kap_s, end_s = hesapla_risk_durumu(1000, 50, 100)
        self.assertEqual(genel, "guvenli")
        self.assertEqual(kap_o, 5.0)
        self.assertEqual(end_o, 10.0)

    def test_hesapla_risk_durumu_kapasitif_tehlikeli(self):
        genel, kap_o, end_o, kap_s, end_s = hesapla_risk_durumu(1000, 160, 100)
        self.assertEqual(genel, "tehlikeli")
        self.assertEqual(kap_s, "tehlikeli")

    def test_hesapla_risk_durumu_enduktif_tehlikeli(self):
        genel, kap_o, end_o, kap_s, end_s = hesapla_risk_durumu(1000, 50, 220)
        self.assertEqual(genel, "tehlikeli")
        self.assertEqual(end_s, "tehlikeli")

    def test_db_connection_and_models(self):
        db = SessionLocal()
        try:
            from services.alert_service import get_active_alerts
            alerts = get_active_alerts(db, limit=5)
            self.assertIsInstance(alerts, list)
        finally:
            db.close()

if __name__ == '__main__':
    unittest.main()
