# 🌐 SPARK | Akıllı Şebeke Reaktif Güç Takip, Saatlik Tahmin ve Karar Destek Sistemi

**SPARK**, Türkiye Elektrik İletim A.Ş. (**TEİAŞ**) trafo merkezlerinin saatlik yük verilerini kullanarak aktif, endüktif ve kapasitif enerji tüketimlerini gerçek zamanlı izleyen; EPDK reaktif ceza sınırlarına karşı gelişmiş yapay zeka (XGBoost), makine öğrenmesi ve meteorolojik verilerle **saatlik ay sonu ceza projeksiyonu** sunan modern bir **SCADA ve Karar Destek Sistemidir**.

---

## 🎯 Projenin Amacı ve Çözdüğü Problem

Türkiye'de **EPDK (Enerji Piyasası Düzenleme Kurumu)** mevzuatına göre aylık kümülatif reaktif enerji tüketim oranlarının sınırları (%20 Endüktif, %15 Kapasitif) aşması durumunda kurumlara cezai işlem uygulanır. Geleneksel sistemlerin aksine SPARK, sadece anlık durumu göstermekle kalmaz, ay sonuna kadar olan kümülatif oranı tahmin ederek önceden uyarı verir. Ayrıca uygulanacak reaktif müdahalelerin (örn. Şönt Reaktör) kesin faydasını simüle eder.

---

## ⚡ Veri Seti ve Altyapı

Sistem, gerçek TEİAŞ yük kayıtları, OSOS tabanlı saatlik okumalar ve **Open-Meteo API** üzerinden anlık/geçmiş hava durumu (Sıcaklık, Nem, Rüzgar, Bulutluluk vb.) metrikleriyle çalışır.
Veriler SQLite veritabanı (`osos_sim.db`) üzerinde tutulmakta olup, SQLAlchemy ORM ile yönetilmektedir.

**Tanımlı Örnek Trafolar:**
* 🏙️ **Ümraniye TM – TRA (`UMR-TRA`)**: `100 MVA` 
* 🏙️ **Ümraniye TM – TRB (`UMR-TRB`)**: `100 MVA` (Kapasitif riski yüksek)
* ⚓ **Kartal TM – TRA (`KRT-TRA`)**: `80 MVA`
* ⚓ **Kartal TM – TRB (`KRT-TRB`)**: `80 MVA`

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
1. **🤖 XGBoost & SHAP (Yapay Zeka):** Sıcaklık, Nem, Rüzgar, Bulutluluk ve THI (Hissedilen Isı İndeksi) verilerini analiz ederek en tutarlı tahminleri üretir. SHAP entegrasyonu sayesinde arayüze "Neden sınır ihlali yaşandığına" dair istatistiksel kanıtlar (XAI) sunar.
2. **🌳 Random Forest (Makine Öğrenmesi):** Hafta sonu, saat ve 24 saatlik gecikme (lag) özniteliklerini kullanan Regresyon Ormanı.
3. **🚀 Topluluk Modeli (Ensemble):** Çeşitli modellerin birleştirilmiş daha stabil versiyonu.
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
│   ├── main.py                 # FastAPI sunucu kökü
│   ├── database.py             # SQLite veritabanı bağlantı ayarları
│   ├── models.py               # SQLAlchemy ORM modelleri
│   ├── schemas.py              # Pydantic veri doğrulama şemaları
│   ├── init_db.py              # Veritabanı ilklendirme scripti
│   ├── osos_sim.db             # Uygulama veritabanı
│   └── services/
│       ├── weather_service.py  # Open-Meteo Entegrasyonu ve Backfill Mekanizması
│       ├── analysis_service.py # Veri analizi ve aylık oran hesaplamaları
│       └── forecast_service.py # XGBoost, SHAP ve ML tahmin motoru
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
Sunucu ayaktayken, ana dizindeki **`index.html`** dosyasını herhangi bir modern web tarayıcısında (Chrome, Firefox, Safari) açmanız yeterlidir. Localhost üzerinden sunucu ayağa kalkmışsa doğrudan iletişim kurulur.
