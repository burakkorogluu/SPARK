import requests
import datetime
from sqlalchemy.orm import Session
import models
import logging

logger = logging.getLogger("spark.weather")

LAT = 41.0082
LON = 28.9784

# Open-Meteo'nun archive endpoint'i henüz reanalize edilmemiş, bugüne çok yakın
# (veya gelecekteki) tarihler için 400 Bad Request döndürüyor. Bu yüzden API'ye
# gönderdiğimiz end_date'i güvenli bir geçmiş tarihle sınırlıyoruz.
ARCHIVE_SAFE_DELAY_DAYS = 2


def _clamp_to_archive_safe_date(date_str: str) -> str:
    """Verilen tarihi Open-Meteo archive API'sinin veri sağlayabileceği en güncel
    (güvenli) tarihe kırpar. Parse edilemeyen tarihleri olduğu gibi döndürür."""
    try:
        d = datetime.datetime.strptime(date_str, "%Y-%m-%d")
    except Exception:
        return date_str
    safe_cutoff = datetime.datetime.now() - datetime.timedelta(days=ARCHIVE_SAFE_DELAY_DAYS)
    return min(d, safe_cutoff).strftime("%Y-%m-%d")

def get_weather_data(start_date: str, end_date: str, db: Session = None):
    """
    Fetches hourly weather data for the given date range (YYYY-MM-DD).
    If db session is provided, queries database first and caches missing items.
    Also backfills missing new parameters for existing rows.
    """
    weather_map = {}
    
    try:
        start_dt = datetime.datetime.strptime(start_date, "%Y-%m-%d")
        end_dt = datetime.datetime.strptime(end_date, "%Y-%m-%d") + datetime.timedelta(days=1)
    except Exception:
        return weather_map

    needs_api = False
    expected_hours = int((end_dt - start_dt).total_seconds() / 3600) + 1

    if db is not None:
        try:
            cached_records = db.query(models.WeatherData).filter(
                models.WeatherData.timestamp >= start_dt,
                models.WeatherData.timestamp <= end_dt
            ).all()
            
            for rec in cached_records:
                key = rec.timestamp.strftime("%Y-%m-%d %H:00")
                weather_map[key] = {
                    "temp": rec.temperature,
                    "humidity": rec.humidity,
                    "wind_speed": rec.wind_speed,
                    "wind_direction": rec.wind_direction,
                    "precipitation": rec.precipitation,
                    "cloud_cover": rec.cloud_cover
                }
                
                # Check if any parameter is missing
                if any(getattr(rec, attr, None) is None for attr in ("wind_speed", "cloud_cover", "humidity", "precipitation", "wind_direction")):
                    needs_api = True
        except Exception as e:
            logger.error(f"Weather DB Query Error: {e}")
            needs_api = True

    # -24h toleransı: Son 24 saatlik veriler Open-Meteo arşivinde henüz yayınlanmamış olabileceğinden 
    # küçük eksikler için sürekli API isteği atılmasını engeller.
    if len(weather_map) < expected_hours - 24:
        needs_api = True

    if not needs_api:
        return weather_map

    api_start_date = start_date
    api_end_date = _clamp_to_archive_safe_date(end_date)

    # İstenen aralığın tamamı henüz arşivde mevcut değilse (tamamen bugüne çok
    # yakın/gelecek tarihli), API'ye hiç istek atmadan mevcut (cache'lenmiş) veriyle dön.
    if api_start_date > api_end_date:
        return weather_map

    url = f"https://archive-api.open-meteo.com/v1/archive?latitude={LAT}&longitude={LON}&start_date={api_start_date}&end_date={api_end_date}&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation,cloud_cover&timezone=Europe%2FIstanbul"
    
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        if "hourly" in data and "time" in data["hourly"]:
            times = data["hourly"]["time"]
            temps = data["hourly"]["temperature_2m"]
            hums = data["hourly"]["relative_humidity_2m"]
            winds = data["hourly"]["wind_speed_10m"]
            wind_dirs = data["hourly"]["wind_direction_10m"]
            precs = data["hourly"]["precipitation"]
            clouds = data["hourly"]["cloud_cover"]
            
            if db is not None:
                existing_records = {r.timestamp: r for r in db.query(models.WeatherData).filter(
                    models.WeatherData.timestamp >= start_dt,
                    models.WeatherData.timestamp <= end_dt
                ).all()}
                
                to_add = []
                for i, t in enumerate(times):
                    dt_str = t.replace("T", " ")
                    dt_obj = datetime.datetime.strptime(dt_str, "%Y-%m-%d %H:00")
                    
                    t_val = temps[i] if temps[i] is not None else 20.0
                    h_val = hums[i] if hums[i] is not None else 50.0
                    ws_val = winds[i] if winds[i] is not None else 0.0
                    wd_val = wind_dirs[i] if wind_dirs[i] is not None else 0.0
                    p_val = precs[i] if precs[i] is not None else 0.0
                    c_val = clouds[i] if clouds[i] is not None else 0.0
                    
                    weather_map[dt_str] = {
                        "temp": t_val, "humidity": h_val, "wind_speed": ws_val,
                        "wind_direction": wd_val, "precipitation": p_val, "cloud_cover": c_val
                    }

                    if dt_obj in existing_records:
                        rec = existing_records[dt_obj]
                        if any(getattr(rec, attr, None) is None for attr in ("wind_speed", "cloud_cover", "humidity", "precipitation", "wind_direction")):
                            rec.humidity = h_val
                            rec.wind_speed = ws_val
                            rec.wind_direction = wd_val
                            rec.precipitation = p_val
                            rec.cloud_cover = c_val
                    else:
                        to_add.append(models.WeatherData(
                            timestamp=dt_obj, temperature=t_val, humidity=h_val,
                            wind_speed=ws_val, wind_direction=wd_val, precipitation=p_val, cloud_cover=c_val
                        ))
                        
                if to_add or existing_records:
                    try:
                        db.add_all(to_add)
                        db.commit()
                        logger.info("Cached/Updated weather records in database.")
                    except Exception as commit_err:
                        db.rollback()
                        logger.error(f"Weather DB Commit Error: {commit_err}")
            else:
                for i, t in enumerate(times):
                    dt_str = t.replace("T", " ")
                    weather_map[dt_str] = {
                        "temp": temps[i] if temps[i] is not None else 20.0,
                        "humidity": hums[i] if hums[i] is not None else 50.0,
                        "wind_speed": winds[i] if winds[i] is not None else 0.0,
                        "wind_direction": wind_dirs[i] if wind_dirs[i] is not None else 0.0,
                        "precipitation": precs[i] if precs[i] is not None else 0.0,
                        "cloud_cover": clouds[i] if clouds[i] is not None else 0.0
                    }

        return weather_map
    except Exception as e:
        logger.error(f"Weather API Error: {e}")
        return weather_map

def get_weather_features_for_timestamp(weather_map, dt: datetime.datetime):
    key = dt.strftime("%Y-%m-%d %H:00")
    if key in weather_map:
        return weather_map[key]
    return {
        "temp": 20.0, "humidity": 50.0, "wind_speed": 0.0,
        "wind_direction": 0.0, "precipitation": 0.0, "cloud_cover": 0.0
    }

def get_temperature_for_timestamp(weather_map, dt: datetime.datetime):
    return get_weather_features_for_timestamp(weather_map, dt)["temp"]
