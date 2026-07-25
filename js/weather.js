// ============================================
// weather.js - Hava Durumu Modülü
// Reaktif Güç Takip ve Analiz Sistemi
// ============================================

const WeatherModulu = (() => {
    'use strict';

    let _weatherData = new Map(); // tarih_saat -> { temp, hum, cloud, rad }
    let _dailyWeatherData = new Map(); // tarih -> { temp, hum, cloud, rad }
    let _isLoaded = false;
    let _isLoading = false;

    // İstanbul Koordinatları (Ümraniye / Kartal için yeterli)
    const LAT = 41.0082;
    const LON = 28.9784;

    /**
     * Open-Meteo API'den son 92 gün geçmiş ve 14 gün gelecek saatlik hava durumu verisini çeker.
     * Ücretsizdir ve API Key gerektirmez.
     */
    async function init() {
        if (_isLoaded || _isLoading) return;
        _isLoading = true;
        
        try {
            // past_days=92 ve forecast_days=14 saatlik sıcaklık verilerini çeker
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&hourly=temperature_2m,relative_humidity_2m,cloud_cover,direct_radiation&past_days=92&forecast_days=14&timezone=Europe%2FIstanbul`;
            
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            
            if (data && data.hourly && data.hourly.time && data.hourly.temperature_2m) {
                const times = data.hourly.time;
                const temps = data.hourly.temperature_2m;
                const hums = data.hourly.relative_humidity_2m;
                const clouds = data.hourly.cloud_cover;
                const rads = data.hourly.direct_radiation;
                
                const dailySums = new Map();
                const dailyCounts = new Map();

                for (let i = 0; i < times.length; i++) {
                    const timeStr = times[i].replace('T', ' '); // "2025-07-25 14:00"
                    const dateStr = times[i].split('T')[0];     // "2025-07-25"
                    
                    const temp = temps[i];
                    const hum = hums ? hums[i] : 50;
                    const cloud = clouds ? clouds[i] : 0;
                    const rad = rads ? rads[i] : 0;
                    
                    if (temp != null) {
                        _weatherData.set(timeStr, { temp, hum, cloud, rad });
                        
                        if (!dailySums.has(dateStr)) {
                            dailySums.set(dateStr, { temp: 0, hum: 0, cloud: 0, rad: 0 });
                            dailyCounts.set(dateStr, 0);
                        }
                        
                        const sums = dailySums.get(dateStr);
                        sums.temp += temp;
                        sums.hum += hum;
                        sums.cloud += cloud;
                        sums.rad += rad;
                        dailyCounts.set(dateStr, dailyCounts.get(dateStr) + 1);
                    }
                }

                // Günlük ortalamaları hesapla
                for (const [date, sums] of dailySums.entries()) {
                    const count = dailyCounts.get(date);
                    _dailyWeatherData.set(date, {
                        temp: sums.temp / count,
                        hum: sums.hum / count,
                        cloud: sums.cloud / count,
                        rad: sums.rad / count
                    });
                }

                console.log(`🌤️ WeatherModulu: ${times.length} saatlik hava durumu verisi başarıyla yüklendi.`);
                _isLoaded = true;
            }
        } catch (error) {
            console.error("🌤️ WeatherModulu: Hava durumu verisi çekilirken hata oluştu: ", error);
        } finally {
            _isLoading = false;
        }
    }

    /**
     * Belirtilen tarih/saat veya gün için sıcaklığı döndürür.
     * @param {string} dateStr "YYYY-MM-DD" veya "YYYY-MM-DD HH:mm"
     * @param {boolean} isHourly Verinin saatlik mi günlük mü olduğu
     * @returns {number|null} Sıcaklık değeri (bulunamazsa null)
     */
    function getTemperature(dateStr, isHourly = true) {
        const w = getWeather(dateStr, isHourly);
        return w ? w.temp : null;
    }

    /**
     * Belirtilen tarih/saat veya gün için tüm hava durumu objesini döndürür.
     */
    function getWeather(dateStr, isHourly = true) {
        if (isHourly) {
            const formatted = dateStr.length === 10 ? `${dateStr} 00:00` : dateStr;
            return _weatherData.has(formatted) ? _weatherData.get(formatted) : null;
        } else {
            const formatted = dateStr.split(' ')[0];
            return _dailyWeatherData.has(formatted) ? _dailyWeatherData.get(formatted) : null;
        }
    }

    function isLoaded() {
        return _isLoaded;
    }

    return {
        init,
        getTemperature,
        getWeather,
        isLoaded
    };
})();
