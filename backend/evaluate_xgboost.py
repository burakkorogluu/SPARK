import os
import sys
import datetime
import pandas as pd
import numpy as np
import xgboost as xgb
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score

from database import SessionLocal
import models
from services.forecast_service import prepare_dataframe
from services.weather_service import get_weather_data
import holidays

def mean_absolute_percentage_error(y_true, y_pred):
    y_true, y_pred = np.array(y_true), np.array(y_pred)
    mask = y_true != 0
    return np.mean(np.abs((y_true[mask] - y_pred[mask]) / y_true[mask])) * 100

def main():
    print("Veritabanından 2025 yılı ölçümleri alınıyor...")
    db = SessionLocal()
    
    # Get all 2025 measurements for UMR-TRB
    measurements = db.query(models.Measurement).filter(
        models.Measurement.transformer_id == "UMR-TRB",
        models.Measurement.timestamp >= datetime.datetime(2025, 1, 1),
        models.Measurement.timestamp < datetime.datetime(2026, 1, 1)
    ).order_by(models.Measurement.timestamp.asc()).all()
    
    if not measurements:
        print("2025 verisi bulunamadı!")
        return
        
    print(f"Toplam {len(measurements)} saatlik veri bulundu.")
    
    start_str = "2025-01-01"
    end_str = "2025-12-31"
    print("Hava durumu verileri hazırlanıyor (Eksikse Open-Meteo'dan çekilir)...")
    weather_map = get_weather_data(start_str, end_str, db)
    
    tr_holidays = holidays.TR(years=[2025])
    
    print("Veri seti özellikleri (features) hazırlanıyor...")
    df = prepare_dataframe(measurements, weather_map, tr_holidays)
    
    # Create lag and rolling features to match forecast_service.py
    for c in ['aktif', 'kapasitif', 'enduktif']:
        df[f'{c}_lag_1'] = df[f'y_{c}'].shift(1)
        df[f'{c}_lag_24'] = df[f'y_{c}'].shift(24)
        df[f'{c}_lag_168'] = df[f'y_{c}'].shift(168)
        df[f'{c}_roll_mean_6'] = df[f'y_{c}'].shift(1).rolling(6).mean()
        df[f'{c}_roll_mean_24'] = df[f'y_{c}'].shift(1).rolling(24).mean()
        
    df.dropna(inplace=True)
    
    # Train-Test Split (Chronological: %80 Train, %20 Test)
    split_idx = int(len(df) * 0.8)
    train_df = df.iloc[:split_idx]
    test_df = df.iloc[split_idx:]
    
    base_features = ['is_weekend', 'is_holiday', 'hour', 'day_of_week', 'temp', 'humidity', 'wind_speed', 'cloud_cover', 'thi']
    features_aktif = base_features + ['aktif_lag_1', 'aktif_lag_24', 'aktif_lag_168', 'aktif_roll_mean_6', 'aktif_roll_mean_24']
    
    X_train = train_df[features_aktif]
    y_train = train_df['y_aktif']
    X_test = test_df[features_aktif]
    y_test = test_df['y_aktif']
    
    print(f"Eğitim Seti: {len(X_train)} kayıt, Test Seti: {len(X_test)} kayıt")
    print("XGBoost Modeli Eğitiliyor (Aktif Güç)...")
    
    model = xgb.XGBRegressor(n_estimators=150, max_depth=5, learning_rate=0.05, subsample=0.85, colsample_bytree=0.85, reg_alpha=0.1, reg_lambda=1.0, random_state=42)
    model.fit(X_train, y_train)
    
    print("Test seti üzerinde tahmin yapılıyor...")
    y_pred = model.predict(X_test)
    
    rmse = np.sqrt(mean_squared_error(y_test, y_pred))
    mae = mean_absolute_error(y_test, y_pred)
    r2 = r2_score(y_test, y_pred)
    mape = mean_absolute_percentage_error(y_test, y_pred)
    
    print("\n" + "="*40)
    print("AKTİF GÜÇ (XGBoost) TEST SONUÇLARI:")
    print(f"R² Skoru       : {r2:.4f} (1'e ne kadar yakınsa o kadar iyi)")
    print(f"RMSE (Hata)    : {rmse:.2f} kWh")
    print(f"MAE (Hata)     : {mae:.2f} kWh")
    print(f"MAPE (Yüzde)   : %{mape:.2f}")
    print("="*40)
    
    # Kapasitif için aynı işlemi yapalım
    features_kap = base_features + ['kapasitif_lag_1', 'kapasitif_lag_24', 'kapasitif_lag_168', 'kapasitif_roll_mean_6', 'kapasitif_roll_mean_24']
    X_train_kap = train_df[features_kap]
    y_train_kap = train_df['y_kapasitif']
    X_test_kap = test_df[features_kap]
    y_test_kap = test_df['y_kapasitif']
    
    model_kap = xgb.XGBRegressor(n_estimators=150, max_depth=5, learning_rate=0.05, subsample=0.85, colsample_bytree=0.85, reg_alpha=0.1, reg_lambda=1.0, random_state=42)
    model_kap.fit(X_train_kap, y_train_kap)
    y_pred_kap = model_kap.predict(X_test_kap)
    
    r2_k = r2_score(y_test_kap, y_pred_kap)
    mape_k = mean_absolute_percentage_error(y_test_kap, y_pred_kap)
    
    print("KAPASİTİF GÜÇ (XGBoost) TEST SONUÇLARI:")
    print(f"R² Skoru       : {r2_k:.4f}")
    print(f"MAPE (Yüzde)   : %{mape_k:.2f}")
    print("="*40)

if __name__ == "__main__":
    main()
