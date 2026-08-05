# Bu dosya geriye dönük uyumluluğu korumak için bir Facade (Önyüz) olarak bırakılmıştır.
# Tüm tahmin mantığı services/forecast/ paketine taşınmıştır.

from services.forecast.cache_manager import (
    FORECAST_CACHE, 
    TRAINED_MODELS_CACHE, 
    clear_caches
)

from services.forecast.data_prep import (
    prepare_dataframe, 
    calculate_confidence,
    FEATURE_NAMES_TR
)

from services.forecast.models.base import (
    _get_or_train_models, 
    generate_predictions_from_model
)

from services.forecast.models.xgboost_model import forecast_xgboost
from services.forecast.models.random_forest_model import forecast_random_forest
from services.forecast.models.regression_model import forecast_regression
from services.forecast.models.lightgbm_model import forecast_lightgbm
from services.forecast.models.holt_winters_model import forecast_holt_winters
from services.forecast.models.simple_models import (
    forecast_ortalama, 
    forecast_persistence, 
    forecast_gecen_ay
)
from services.forecast.models.ensemble import _build_ensemble

from services.forecast.engine import (
    get_cached_forecast, 
    run_weekly_batch_forecast, 
    apply_topology_scaling_to_forecast
)
