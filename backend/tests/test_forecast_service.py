import unittest
from unittest.mock import MagicMock, patch
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services.forecast_service import (
    forecast_xgboost,
    forecast_random_forest,
    forecast_regression,
    generate_predictions_from_model
)

class TestForecastServiceNullHandling(unittest.TestCase):
    @patch("services.forecast_service._get_or_train_models")
    def test_forecast_xgboost_handles_none_future_dates(self, mock_get_models):
        mock_get_models.return_value = (None, None, None, 0, None, None, None, None, None, None, None)
        mock_db = MagicMock()
        preds, conf = forecast_xgboost(mock_db, "TR-01", steps=168)
        self.assertEqual(preds, [])
        self.assertEqual(conf, 0)

    @patch("services.forecast_service._get_or_train_models")
    def test_forecast_xgboost_handles_partial_none_models(self, mock_get_models):
        # Return valid active model, but None for kap and end models
        mock_get_models.return_value = (MagicMock(), MagicMock(), None, 80, MagicMock(), MagicMock(), MagicMock(), MagicMock(), {}, {}, [MagicMock()])
        mock_db = MagicMock()
        preds, conf = forecast_xgboost(mock_db, "TR-01", steps=168)
        self.assertEqual(preds, [])
        self.assertEqual(conf, 0)

    @patch("services.forecast_service._get_or_train_models")
    def test_forecast_random_forest_handles_none_future_dates(self, mock_get_models):
        mock_get_models.return_value = (None, None, None, 0, None, None, None, None, None, None, None)
        mock_db = MagicMock()
        preds, conf = forecast_random_forest(mock_db, "TR-01", steps=168)
        self.assertEqual(preds, [])
        self.assertEqual(conf, 0)

    @patch("services.forecast_service._get_or_train_models")
    def test_forecast_regression_handles_none_future_dates(self, mock_get_models):
        mock_get_models.return_value = (None, None, None, 0, None, None, None, None, None, None, None)
        mock_db = MagicMock()
        preds, conf = forecast_regression(mock_db, "TR-01", steps=168)
        self.assertEqual(preds, [])
        self.assertEqual(conf, 0)

    def test_generate_predictions_from_model_handles_none_future_dates(self):
        res = generate_predictions_from_model(
            model_aktif=MagicMock(),
            model_kap=MagicMock(),
            model_end=MagicMock(),
            df=MagicMock(),
            steps=24,
            transformer_id="TR-01",
            future_dates=None
        )
        self.assertEqual(res, [])

if __name__ == '__main__':
    unittest.main()
