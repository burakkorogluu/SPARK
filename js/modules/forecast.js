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
            kap_reason: v.kap_reason || null,
            end_reason: v.end_reason || null,
            isTahmin
        }));

        const mevcutVeriler = mapData(mevcutVerilerBackend, false);
        const tahminVeriler = mapData(tahminVerilerBackend || [], true);

        let detayliAciklama = "Python Backend üzerinden hesaplandı.";
        switch(yontem) {
            case 'ensemble':
                detayliAciklama = "Birden fazla makine öğrenmesi (XGBoost, Random Forest vb.) modelinin harmanlanmasıyla; geçmiş tüketimler, Open-Meteo hava durumu (sıcaklık, nem) ve takvim özellikleri (hafta sonu/tatil) kullanılarak hesaplanmıştır.";
                break;
            case 'xgboost':
                detayliAciklama = "XGBoost Yapay Zeka algoritması ile; 1.5 yıllık geçmiş yük verileri, hava durumu değişkenleri ve takvim/tatil özellikleri çaprazlanarak, hata payı en aza indirgenerek hesaplanmıştır.";
                break;
            case 'randomForest':
                detayliAciklama = "Random Forest (Rastgele Orman) Makine Öğrenmesi modeli ile; geçmiş trendler, saatlik gecikmeler ve meteorolojik veriler kullanılarak yüzlerce karar ağacı üzerinden ortak kararla hesaplanmıştır.";
                break;
            case 'holtWinters':
                detayliAciklama = "Holt-Winters İstatistiksel Zaman Serisi algoritması ile; hava durumu veya dış faktörler KULLANILMADAN, verinin sadece kendi geçmiş trendi ve 24 saatlik döngüsü dikkate alınarak hesaplanmıştır.";
                break;
            case 'regression':
                detayliAciklama = "Çoklu Doğrusal Regresyon modeli ile; geçmiş enerji tüketimleri ve çevresel değişkenler (sıcaklık) arasındaki lineer (doğrusal) ilişki denklemi kurularak hesaplanmıştır.";
                break;
            case 'ortalama':
                detayliAciklama = "İstatistiksel yöntemle, önceki günlerin/haftaların aynı saatlerindeki tüketim değerlerinin aritmetik ortalaması alınarak (dış faktörler harici) hesaplanmıştır.";
                break;
            case 'persistence':
                detayliAciklama = "Basit referans yöntemiyle, bir önceki haftaki enerji tüketim davranışının bugün ve gelecekte de birebir aynı şekilde tekrarlanacağı varsayılarak kopyalanmıştır.";
                break;
            case 'gecenAy':
                detayliAciklama = "Geçtiğimiz ayın aynı günlerindeki tüketim dalgalanmaları referans (emsal) alınarak oluşturulmuştur.";
                break;
        }

        return {
            mevcutVeriler,
            tahminVeriler,
            tumVeriler: [...mevcutVeriler, ...tahminVeriler],
            modelBilgi: { 
                adi: yontem, 
                aciklama: detayliAciklama,
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
