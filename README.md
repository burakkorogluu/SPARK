# 🌐 SPARK | Akıllı Şebeke Reaktif Güç Takip, Saatlik Tahmin ve Karar Destek Sistemi

**SPARK**, Türkiye Elektrik İletim A.Ş. (**TEİAŞ**) trafo merkezlerinin saatlik yük verilerini kullanarak aktif, endüktif ve kapasitif enerji tüketimlerini gerçek zamanlı izleyen; EPDK reaktif ceza sınırlarına karşı gelişmiş yapay zeka (XGBoost), makine öğrenmesi ve meteorolojik verilerle **saatlik ay sonu ceza projeksiyonu** sunan modern bir **SCADA ve Karar Destek Sistemidir**.

---

## 🎯 Projenin Amacı ve Çözdüğü Problem

Türkiye'de **EPDK (Enerji Piyasası Düzenleme Kurumu)** mevzuatına göre aylık kümülatif reaktif enerji tüketim oranlarının sınırları (%20 Endüktif, %15 Kapasitif) aşması durumunda kurumlara cezai işlem uygulanır. Geleneksel sistemlerin aksine SPARK, sadece anlık durumu göstermekle kalmaz, ay sonuna kadar olan kümülatif oranı tahmin ederek önceden uyarı verir. Ayrıca uygulanacak reaktif müdahalelerin (örn. Şönt Reaktör) kesin faydasını simüle eder.

---

## ⚡ Veri Seti ve Altyapı

Sistem, gerçek TEİAŞ yük kayıtları, OSOS tabanlı saatlik okumalar ve **Open-Meteo API** üzerinden anlık/geçmiş hava durumu (Sıcaklık, Nem, Rüzgar, Bulutluluk vb.) metrikleriyle çalışır.
Veriler SQLite veritabanı (`osos_sim.db`) üzerinde tutulmakta olup, SQLAlchemy ORM ile yönetilmektedir. Algoritmalar, 1.5 yıllık (yaklaşık 13.000+ saatlik) tarihsel veriyi işleyerek eğitilir.

**Tanımlı Örnek Trafolar:**
* 🏙️ **Ümraniye TM – TRA (`UMR-TRA`)**: `100 MVA` 
* 🏙️ **Ümraniye TM – TRB (`UMR-TRB`)**: `100 MVA` (Kapasitif riski yüksek)
* ⚓ **Kartal TM – TRA (`KRT-TRA`)**: `80 MVA`
* ⚓ **Kartal TM – TRB (`KRT-TRB`)**: `80 MVA`

---

## 🚀 Batch Prediction (Yığın Tahmin) ve Hız Optimizasyonu

Son güncellemeyle birlikte SPARK, sektör standardı olan **Batch Prediction Serving** mimarisine geçmiştir:
* **Asenkron Arka Plan Görevi (Cron):** `APScheduler` ile her Pazar gece 02:00'da tüm makine öğrenmesi modelleri 1.5 yıllık verilerle eğitilir. Modeller, önümüzdeki 30 günün saatlik tahminlerini üretip `ForecastMeasurement` veritabanı tablosuna kaydeder.
* **Akıllı Temizlik:** Simülatörden veya OSOS'tan "Gerçek" ölçüm verisi geldiğinde, veritabanındaki o saate ait eski tahmin otomatik olarak silinir.
* **Sıfır Bekleme (Sub-second API):** Kullanıcı arayüzden tahmin istediğinde modelleri anlık çalıştırmak yerine (15sn+), doğrudan veritabanından önceden hesaplanmış veriler çekilir. Yanıt süresi 0.01 saniyenin altındadır!

---

## 🖥️ Sistem Ekranları ve Modüller

### 1. 📊 Genel Görünüm (Dashboard)
Trafoların kümülatif durumlarının, güvenlik rozetlerinin (Yeşil/Sarı/Kırmızı) ve Chart.js destekli anlık özet grafiklerinin bulunduğu ana ekran.

### 2. 🔌 Trafo Detay Analizi & Saatlik Veri
Seçilen trafonun saat saat tüketim geçmişi, kümülatif ilerleyiş grafikleri ve manuel operatör müdahalesine imkan tanıyan veri tablosu.

### 3. 🌐 Şebeke Topolojisi & SCADA
Trafolar arası enerji akışını animasyonlarla gösteren endüstriyel şema. Trafolara tıklandığında Canvas üzerinde çizilen **Anlık Fazör & Güç Üçgeni**.

### 4. 📈 Saatlik Ay Sonu Tahminci & Yapay Zeka (XGBoost + SHAP)
Python Backend'de çalışan 8 farklı tahmin algoritması:
1. **🤖 XGBoost & SHAP (Yapay Zeka):** Sıcaklık, Nem, Rüzgar, Bulutluluk ve THI verilerini analiz eder. SHAP ile "neden sınır ihlali yaşandığına" dair istatistiksel kanıt sunar.
2. **🌳 Random Forest (Makine Öğrenmesi):** Hafta sonu, saat ve gecikme (lag) özniteliklerini kullanan Regresyon Ormanı.
3. **🚀 Topluluk Modeli (Ensemble):** Çeşitli modellerin birleştirilmiş, daha stabil ve genel geçerliliği en yüksek modelidir. (Varsayılan Model)
4. **📈 Holt-Winters Üçlü Üssel Düzeltme:** Mevsimsellik ve trendi ayrıştıran istatistiksel zaman serisi modeli (24 saatlik periyot).
5. **Doğrusal Regresyon (Linear Regression):** Gecikmeli öznitelikler üzerinden lineer eğilim hesabı.
6. **İstatistiksel Ortalama:** Son 7 günün aynı saatlerinin aritmetik ortalaması.
7. **Geçen Hafta (Persistence):** Bir önceki haftanın birebir tekrarı kabulü.
8. **Geçen Ay:** Geçen ayki hareketliliğin devam edeceği varsayımı.

*Not: Sistem tüm tahminlerde, veri üzerindeki modele özgü sapmaları hesaplayarak (MAPE üzerinden) **Gerçek Güven Skoru** üretir.*

---

## 🛠️ Mimari ve Klasör Yapısı

SPARK, **Python FastAPI** sunucusu ve **Vanilla JS** ön yüzünden (Frontend) oluşan modern ve ölçeklenebilir bir yapıdadır.

```text
SPARK/
├── index.html                  # Ana uygulama iskeleti ve arayüz
├── backend/
│   ├── main.py                 # FastAPI sunucu kökü & APScheduler Görev Yöneticisi
│   ├── database.py             # SQLite veritabanı bağlantı ayarları
│   ├── models.py               # SQLAlchemy ORM modelleri (Measurement, ForecastMeasurement vb.)
│   ├── schemas.py              # Pydantic veri doğrulama şemaları
│   ├── init_db.py              # Veritabanı ilklendirme scripti
│   ├── simulator.py            # OSOS Simülatörü ve Gerçek Veri Entegrasyonu
│   ├── osos_sim.db             # Uygulama veritabanı
│   └── services/
│       ├── weather_service.py  # Open-Meteo Entegrasyonu ve Backfill Mekanizması
│       ├── analysis_service.py # Veri analizi ve aylık oran hesaplamaları
│       └── forecast_service.py # ML tahmin motoru ve Batch Prediction Mantığı
├── css/
│   └── style.css               # Tasarım sistemi
└── js/
    ├── core/
    │   ├── app.js              # Uygulama denetleyicisi ve UI senkronizasyonu
    │   ├── api_client.js       # Backend ile iletişim kuran Fetch katmanı
    │   └── data.js             # İstemci tarafı veri yönetimi ve ön bellek
    ├── modules/
    │   ├── calculations.js     # İstemci taraflı oran hesaplamaları
    │   ├── forecast.js         # API tahmin istekleri 
    │   └── scenarios.js        # Reaktör/Yük simülasyonları
    └── ui/
        ├── charts.js           # Chart.js ve Plugin yapılandırmaları
        └── topology.js         # SCADA, SVG ve Canvas çizimleri
```

---

## 🚀 Kurulum ve Çalıştırma

Sistem hem Backend hem de Frontend'in eşzamanlı çalışmasını gerektirir.

### 1. Backend (Sunucu) Başlatma
Terminalinizde proje dizinine gidin ve aşağıdaki komutları çalıştırın:
```bash
# Python sanal ortamını (venv) aktifleştirin
source backend/venv/bin/activate 

# Bağımlılıkları Kurun
pip install -r backend/requirements.txt

# FastAPI sunucusunu başlatın
cd backend
uvicorn main:app --reload --port 8000
```
*(Sunucu `http://127.0.0.1:8000` adresinde ayağa kalkacaktır.)*

### 2. Frontend (İstemci) Başlatma
Sunucu ayaktayken, ana dizindeki **`index.html`** dosyasını herhangi bir modern web tarayıcısında (Chrome, Firefox, Safari) açmanız yeterlidir. (Veri güvenliği ve CORS kısıtlamaları nedeniyle bir lokal web sunucusu üzerinden açılması tavsiye edilir, örn: `python3 -m http.server 8080`).
