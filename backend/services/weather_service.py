# pyrefly: ignore [missing-source-for-stubs]
import requests
import datetime
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import Session
import models

LAT = 41.0082
LON = 28.9784

def get_weather_data(start_date: str, end_date: str, db: Session = None):
    """
    Fetches hourly weather data for the given date range (YYYY-MM-DD).
    If db session is provided, queries database first and caches missing items.
    """
    weather_map = {}
    
    try:
        start_dt = datetime.datetime.strptime(start_date, "%Y-%m-%d")
        end_dt = datetime.datetime.strptime(end_date, "%Y-%m-%d") + datetime.timedelta(days=1)
    except Exception:
        return weather_map

    if db is not None:
        try:
            cached_records = db.query(models.WeatherData).filter(
                models.WeatherData.timestamp >= start_dt,
                models.WeatherData.timestamp <= end_dt
            ).all()
            
            for rec in cached_records:
                key = rec.timestamp.strftime("%Y-%m-%d %H:00")
                weather_map[key] = {"temp": rec.temperature}
        except Exception as e:
            print(f"Weather DB Query Error: {e}")

    expected_hours = int((end_dt - start_dt).total_seconds() / 3600) + 1
    
    # If DB already has most data, avoid API call
    if len(weather_map) >= expected_hours - 24:
        return weather_map

    url = f"https://archive-api.open-meteo.com/v1/archive?latitude={LAT}&longitude={LON}&start_date={start_date}&end_date={end_date}&hourly=temperature_2m,relative_humidity_2m,cloud_cover,direct_radiation&timezone=Europe%2FIstanbul"
    
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        if "hourly" in data and "time" in data["hourly"]:
            times = data["hourly"]["time"]
            temps = data["hourly"]["temperature_2m"]
            
            for i, t in enumerate(times):
                dt_str = t.replace("T", " ")
                temp_val = temps[i] if temps[i] is not None else 20.0
                weather_map[dt_str] = {"temp": temp_val}

            if db is not None:
                existing_ts = set(r[0] for r in db.query(models.WeatherData.timestamp).filter(
                    models.WeatherData.timestamp >= start_dt,
                    models.WeatherData.timestamp <= end_dt
                ).all())
                
                to_add = []
                for i, t in enumerate(times):
                    dt_obj = datetime.datetime.strptime(t.replace("T", " "), "%Y-%m-%d %H:00")
                    if dt_obj not in existing_ts:
                        temp_val = temps[i] if temps[i] is not None else 20.0
                        to_add.append(models.WeatherData(timestamp=dt_obj, temperature=temp_val))
                        existing_ts.add(dt_obj)
                        
                if to_add:
                    try:
                        db.add_all(to_add)
                        db.commit()
                        print(f"Cached {len(to_add)} weather records into database.")
                    except Exception as commit_err:
                        db.rollback()
                        print(f"Weather DB Commit Error: {commit_err}")

        return weather_map
    except Exception as e:
        print(f"Weather API Error: {e}")
        return weather_map

def get_temperature_for_timestamp(weather_map, dt: datetime.datetime):
    key = dt.strftime("%Y-%m-%d %H:00")
    if key in weather_map:
        return weather_map[key]["temp"]
    return 20.0

