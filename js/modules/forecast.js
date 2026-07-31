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
        
        // Mevcut verileri zaten yüklü olan bellekten (VeriModulu) al (Gereksiz API isteklerini önler)
        let mevcutVeriler = [];
        if (typeof VeriModulu !== 'undefined') {
            mevcutVeriler = VeriModulu.getAylikVeriler(trafoId, yil, ay).map(v => ({...v, isTahmin: false}));
        } else {
            const startDate = `${yil}-${String(ay).padStart(2, '0')}-01`;
            const lastDay = new Date(yil, ay, 0).getDate();
            const endDate = `${yil}-${String(ay).padStart(2, '0')}-${lastDay}`;
            const mevcutVerilerBackend = await ApiClient.fetchMeasurements(startDate, endDate, trafoId);
            mevcutVeriler = mapData(mevcutVerilerBackend, false);
        }

        // Map to frontend format
        function mapData(arr, isTahmin) {
            return arr.map(v => ({
                trafoId: v.transformer_id || v.trafoId,
                tarih: v.timestamp ? v.timestamp.replace('T', ' ') : v.tarih,
                aktifEnerji: v.active_kwh !== undefined ? v.active_kwh : v.aktifEnerji,
                enduktifEnerji: v.inductive_kvarh !== undefined ? v.inductive_kvarh : v.enduktifEnerji,
                kapasitifEnerji: v.capacitive_kvarh !== undefined ? v.capacitive_kvarh : v.kapasitifEnerji,
                kap_reason: v.kap_reason || null,
                end_reason: v.end_reason || null,
                isTahmin
            }));
        }
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
