# pyrefly: ignore [missing-source-for-stubs]
import requests
import datetime
# pyrefly: ignore [missing-source-for-stubs]
from cachetools import cached, TTLCache

# Cache weather data for 1 hour to avoid spamming the API
cache = TTLCache(maxsize=100, ttl=3600)

LAT = 41.0082
LON = 28.9784

@cached(cache)
def get_weather_data(start_date: str, end_date: str):
    """
    Fetches hourly weather data from Open-Meteo for the given date range.
    start_date and end_date should be YYYY-MM-DD
    """
    url = f"https://archive-api.open-meteo.com/v1/archive?latitude={LAT}&longitude={LON}&start_date={start_date}&end_date={end_date}&hourly=temperature_2m,relative_humidity_2m,cloud_cover,direct_radiation&timezone=Europe%2FIstanbul"
    
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        # Organize data into a dictionary indexed by timestamp string "YYYY-MM-DD HH:MM"
        weather_map = {}
        if "hourly" in data and "time" in data["hourly"]:
            times = data["hourly"]["time"]
            temps = data["hourly"]["temperature_2m"]
            
            for i, t in enumerate(times):
                dt_str = t.replace("T", " ") # "2025-07-25 14:00"
                weather_map[dt_str] = {
                    "temp": temps[i] if temps[i] is not None else 20.0
                }
        return weather_map
    except Exception as e:
        print(f"Weather API Error: {e}")
        return {}

def get_temperature_for_timestamp(weather_map, dt: datetime.datetime):
    # Format dt to match weather map key
    key = dt.strftime("%Y-%m-%d %H:00")
    if key in weather_map:
        return weather_map[key]["temp"]
    return 20.0 # fallback default
