# 🌐 SPARK | Akıllı Şebeke Reaktif Güç Takip, Saatlik Tahmin ve Karar Destek Sistemi

**SPARK**, Türkiye Elektrik İletim A.Ş. (**TEİAŞ**) trafo merkezlerinin saatlik yük verilerini kullanarak aktif, endüktif ve kapasitif enerji tüketimlerini gerçek zamanlı izleyen; EPDK reaktif ceza sınırlarına karşı gelişmiş yapay zeka (XGBoost), makine öğrenmesi ve meteorolojik verilerle **saatlik ay sonu ceza projeksiyonu** sunan modern bir **SCADA ve Karar Destek Sistemidir**. Sistem ayrıca **Pandapower** tabanlı güç akışı (powerflow) analizleriyle şebeke topolojisini simüle edebilmektedir.

---

## 🎯 Projenin Amacı ve Çözdüğü Problem

Türkiye'de **EPDK (Enerji Piyasası Düzenleme Kurumu)** mevzuatına göre aylık kümülatif reaktif enerji tüketim oranlarının sınırları (%20 Endüktif, %15 Kapasitif) aşması durumunda kurumlara cezai işlem uygulanır. Geleneksel sistemlerin aksine SPARK, sadece anlık durumu göstermekle kalmaz, ay sonuna kadar olan kümülatif oranı tahmin ederek önceden uyarı verir. Ayrıca uygulanacak reaktif müdahalelerin (örn. Şönt Reaktör veya Yük Aktarımı) güç akışı üzerindeki kesin faydasını simüle eder.

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

SPARK, sektör standardı olan **Batch Prediction Serving** mimarisi kullanmaktadır:
* **Asenkron Arka Plan Görevi (Cron):** Modeller periyodik olarak geçmiş verilerle eğitilir ve önümüzdeki 30 günün saatlik tahminlerini üretip veritabanına kaydeder.
* **Akıllı Temizlik:** Simülatörden veya OSOS'tan "Gerçek" ölçüm verisi geldiğinde, veritabanındaki o saate ait eski tahmin otomatik olarak silinir.
* **Sıfır Bekleme (Sub-second API):** Kullanıcı arayüzden tahmin istediğinde modelleri anlık çalıştırmak yerine doğrudan veritabanından önceden hesaplanmış veriler çekilir. Yanıt süresi milisaniyeler seviyesindedir.

---

## 🖥️ Sistem Ekranları ve Modüller

### 1. 📊 Genel Görünüm (Dashboard)
Trafoların kümülatif durumlarının, güvenlik rozetlerinin (Yeşil/Sarı/Kırmızı) ve Chart.js destekli anlık özet grafiklerinin bulunduğu ana ekran.

### 2. 🔌 Trafo Detay Analizi & Saatlik Veri
Seçilen trafonun saat saat tüketim geçmişi, kümülatif ilerleyiş grafikleri ve manuel operatör müdahalesine imkan tanıyan veri tablosu.
* **Excel Veri Yükleme (Upload Excel):** Geçmişe dönük trafo verilerini sisteme topluca aktarmak için Excel yükleme arayüzü sunar.

### 3. 🌐 Şebeke Topolojisi, SCADA & Güç Akışı Analizi
Trafolar arası enerji akışını animasyonlarla gösteren endüstriyel şema. Pandapower tabanlı altyapı sayesinde **Güç Akışı (Power Flow)** analizleri çalıştırılabilir.
* **Kesici Kontrolü (Toggle Breaker):** SCADA ekranı üzerinden trafoların veya hatların enerjisi kesilip verilebilir, güç akışı değişimi simüle edilebilir.
* **Alarm Yönetimi (Ack Alarm):** Limit aşımlarında üretilen SCADA alarmları operatör tarafından onaylanabilir.

### 4. 📈 Saatlik Ay Sonu Tahminci & Yapay Zeka (XGBoost + SHAP)
Python Backend'de çalışan farklı tahmin algoritmaları ve değerlendirme servisleri:
1. **🤖 XGBoost & SHAP (Yapay Zeka):** Hava durumu vb. verileri analiz eder. SHAP ile istatistiksel kanıt sunar.
2. **🌳 Random Forest (Makine Öğrenmesi):** Hafta sonu, saat ve gecikme (lag) özniteliklerini kullanan Regresyon Ormanı.
3. **🚀 Topluluk Modeli (Ensemble):** Çeşitli modellerin birleştirilmiş, daha stabil ve genel geçerliliği en yüksek modelidir.
4. **📈 İstatistiksel ve Zaman Serisi Modelleri:** Holt-Winters, Doğrusal Regresyon, İstatistiksel Ortalama gibi yaklaşımlar da sisteme entegredir.

---

## 🛠️ Mimari ve Klasör Yapısı (Güncel)

SPARK, **Python FastAPI** sunucusu (Modüler Yapı) ve **Vanilla JS** ön yüzünden oluşan modern bir yapıdadır. Proje yakın zamanda refactor edilmiş ve klasör yapısı daha ölçeklenebilir, modern bir standarda (Router, Service, Core mimarisine) getirilmiştir.

```text
SPARK/
├── index.html                  # Ana uygulama iskeleti ve giriş noktası (DOM yapılandırması)
├── backend/
│   ├── main.py                 # FastAPI uygulamasının ana giriş noktası
│   ├── api/
│   │   └── routes/             # API Endpoints (alerts, analysis, forecast, maneuver, osos, powerflow, scada vb.)
│   ├── core/                   # Çekirdek Yapılar: WebSocket yöneticisi, Simülatör (Sentetik veri üretimi)
│   ├── db/                     # Veritabanı Modülleri: database.py, init_db.py, models.py (SQLAlchemy)
│   ├── schemas/                # Pydantic şemaları (Veri validasyonu)
│   ├── services/               # İş Mantığı (Business Logic)
│   │   ├── analysis_service.py # Aylık oran ve ceza hesaplamaları
│   │   ├── grid_topology.py    # Pandapower ile güç akışı simülasyonları
│   │   ├── maneuver_service.py # Yük aktarımı, reaktör manevraları simülasyonu
│   │   ├── weather_service.py  # Open-Meteo entegrasyonu
│   │   └── forecast/           # Yapay Zeka ve ML tahmin motoru, cache yönetimi, veri hazırlama
│   ├── scripts/                # Bağımsız yardımcı betikler (Veri aktarma, model test vb.)
│   └── tests/                  # Pytest ile birim ve entegrasyon testleri
├── css/
│   └── style.css               # Tüm sistemin görsel tasarım sistemi
└── js/
    ├── core/                   # Temel İstemci Katmanı (Routing, HTTP API fetch, Theme)
    ├── modules/                # Hesaplama, Tahmin Entegrasyonu, Senaryo yönetimi
    └── ui/                     # Görsel Bileşenler (Dashboard, Şebeke Topolojisi (topology.js), Grafikler)
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
Sunucu ayaktayken, ana dizindeki **`index.html`** dosyasını herhangi bir modern web tarayıcısında (Chrome, Firefox, Safari) açmanız yeterlidir. Veya bir lokal web sunucusu ile (örn: `python3 -m http.server 8080`) kök dizini (SPARK) sunarak çalıştırabilirsiniz.
