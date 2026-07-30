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
├── index.html                  # Ana uygulama iskeleti ve giriş noktası (DOM yapılandırması)
├── backend/
│   ├── main.py                 # FastAPI sunucu kökü, Router tanımları ve APScheduler görev yöneticisi
│   ├── database.py             # SQLAlchemy veritabanı motoru ve oturum (Session) konfigürasyonu
│   ├── models.py               # Veritabanı tablolarının SQLAlchemy ORM model tanımları (Measurement, vb.)
│   ├── schemas.py              # İstek/Yanıt doğrulaması için Pydantic veri şemaları
│   ├── init_db.py              # Veritabanı tablolarını sıfırdan oluşturan ilklendirme scripti
│   ├── simulator.py            # Test amaçlı sentetik OSOS verisi üreten ve DB'ye yazan simülatör
│   ├── import_data.py          # Harici Excel/CSV verilerini SQLite veritabanına aktaran araç
│   ├── evaluate_xgboost.py     # XGBoost modelinin performansını test eden bağımsız değerlendirme betiği
│   ├── ws_handler.py           # Frontend ile gerçek zamanlı veri senkronizasyonu sağlayan WebSocket yöneticisi
│   ├── osos_sim.db             # Uygulamanın ana SQLite veritabanı dosyası
│   ├── services/               # İş Mantığı (Business Logic) Katmanı
│   │   ├── weather_service.py  # Open-Meteo API entegrasyonu ve geçmiş/gelecek hava durumu verilerinin çekilmesi
│   │   ├── analysis_service.py # Gelen verilerin toplanması, aylık kümülatif oranların ve cezaların hesaplanması
│   │   ├── forecast_service.py # XGBoost ve Ensemble ML modelleri ile saatlik tahmin motoru (Batch Prediction)
│   │   ├── maneuver_service.py # Yük aktarımı ve şönt reaktör devreye alma (What-If) senaryolarının simülasyonu
│   │   ├── alert_service.py    # Reaktif ceza sınırlarına yaklaşıldığında uyarı (alert) üreten servis
│   │   ├── scada_service.py    # Trafoların durumunu ve şebeke topolojisi verilerini sağlayan servis
│   │   └── model_eval_service.py# Farklı ML modellerinin (RF, Holt-Winters, XGBoost) hata oranlarını (MAPE) değerlendiren servis
│   └── tests/                  # Pytest Birim ve Entegrasyon Testleri
│       ├── conftest.py         # Test veritabanı ve fixture yapılandırmaları
│       ├── test_api_endpoints.py # FastAPI endpointlerinin entegrasyon testleri
│       ├── test_analysis_service.py # Analiz ve oran hesaplama testleri
│       ├── test_forecast_service.py # Tahmin motoru birim testleri
│       └── test_suite.py       # Toplu test çalıştırıcı ve konfigürasyon
├── css/
│   └── style.css               # Tüm sistemin görsel tasarım sistemi (Dark mode destekli)
└── js/
    ├── core/                   # Temel İstemci Katmanı (Core)
    │   ├── app.js              # Sayfa yönlendirmeleri (Routing), sekme yönetimi ve genel UI durumu
    │   ├── api_client.js       # Backend ile iletişim kuran, fetch çağrılarını sarmalayan HTTP modülü
    │   ├── data.js             # İstemci tarafı veri önbelleği ve trafo sabitlerinin (TRAFOLAR) tutulduğu modül
    │   └── theme.js            # Aydınlık/Karanlık (Light/Dark) tema geçişleri ve CSS değişken yönetimi
    ├── modules/                # Hesaplama ve Entegrasyon Modülleri
    │   ├── calculations.js     # Endüktif/Kapasitif oranları istemci tarafında anlık hesaplayan mantık
    │   ├── forecast.js         # Backend'deki AI tahmin servisleriyle konuşan köprü modül
    │   └── scenarios.js        # Reaktör/Yük simülasyonlarının mantıksal durum yönetimi
    └── ui/                     # Görsel Bileşenler (UI Components)
        ├── alerts.js           # Sistem uyarılarını ve bildirim banner'larını DOM'a çizen modül
        ├── charts.js           # Chart.js kullanarak kümülatif ve saatlik tahmin grafiklerini oluşturan modül
        ├── dashboard.js        # Ana özet ekranını (Dashboard) ve genel metrik kartlarını yöneten modül
        ├── data_entry.js       # Manuel veri girişi formunu ve validasyonları kontrol eden modül
        ├── detail.js           # Trafo detay sayfasındaki veri tablolarını ve sekmeleri yöneten modül
        ├── forecast_ui.js      # Yapay zeka tahmin sonuçlarını ve güvenilirlik (SHAP vb.) skorlarını görselleştiren modül
        ├── maneuver_ui.js      # Manevra (Sürükle-Bırak) ve simülasyon (What-If) arayüz etkileşimlerini yöneten modül
        ├── scada_sld_v4.js     # SCADA Tek Hat Şeması'nın (Single Line Diagram) gelişmiş render motoru
        └── topology.js         # Ağ topolojisini çizen ve enerji akış animasyonlarını çalıştıran modül
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
