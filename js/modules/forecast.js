/**
 * Tahmin Modülü (Backend API Wrapper)
 * Ağır hesaplamaları Python sunucusuna devreder.
 */
const TahminModulu = (() => {
    'use strict';

    /**
     * @param {string} trafoId 
     * @param {number} yil 
     * @param {number} ay 
     * @param {string} yontem - ensemble, randomForest, holtWinters
     */
    async function aySonuTahminiYap(trafoId, yil, ay, yontem = 'ensemble') {
        const responseData = await ApiClient.fetchForecast(trafoId, yil, ay, yontem);
        
        let tahminVerilerBackend;
        let guvenlikSkoru = 85;
        
        // Yeni backend yapısı dictionary dönüyor
        if (responseData && responseData.predictions) {
            tahminVerilerBackend = responseData.predictions;
            guvenlikSkoru = responseData.confidence_score;
        } else {
            // Eski array yapısı (fallback)
            tahminVerilerBackend = responseData;
        }
        
        // Mevcut verileri Backend'den al
        const startDate = `${yil}-${String(ay).padStart(2, '0')}-01`;
        const lastDay = new Date(yil, ay, 0).getDate();
        const endDate = `${yil}-${String(ay).padStart(2, '0')}-${lastDay}`;
        
        const mevcutVerilerBackend = await ApiClient.fetchMeasurements(startDate, endDate, trafoId);
        
        // Map to frontend format
        const mapData = (arr, isTahmin) => arr.map(v => ({
            trafoId: v.transformer_id,
            tarih: v.timestamp.replace('T', ' '),
            aktifEnerji: v.active_kwh,
            enduktifEnerji: v.inductive_kvarh,
            kapasitifEnerji: v.capacitive_kvarh,
            isTahmin
        }));

        const mevcutVeriler = mapData(mevcutVerilerBackend, false);
        const tahminVeriler = mapData(tahminVerilerBackend || [], true);

        return {
            mevcutVeriler,
            tahminVeriler,
            tumVeriler: [...mevcutVeriler, ...tahminVeriler],
            modelBilgi: { 
                adi: yontem, 
                aciklama: 'Python Backend üzerinden hesaplandı.',
                skor: guvenlikSkoru
            }
        };
    }

    function aydakiGunSayisi(yil, ay) {
        return new Date(yil, ay, 0).getDate();
    }

    return {
        aySonuTahminiYap,
        aydakiGunSayisi
    };
})();
