# 🌐 SPARK | Akıllı Şebeke Reaktif Güç Takip, Saatlik Tahmin ve Karar Destek Sistemi

**SPARK**, Türkiye Elektrik İletim A.Ş. (**TEİAŞ**) trafo merkezlerinin saatlik yük verilerini kullanarak aktif, endüktif ve kapasitif enerji tüketimlerini gerçek zamanlı izleyen; EPDK reaktif ceza sınırlarına karşı yapay zeka ve makine öğrenmesi modelleriyle **saatlik ay sonu ceza projeksiyonu** sunan gelişmiş bir **SCADA ve Karar Destek Sistemidir**.

---

## 🎯 Projenin Amacı ve Çözdüğü Problem

Türkiye'de **EPDK (Enerji Piyasası Düzenleme Kurumu)** mevzuatına göre aylık kümülatif reaktif enerji tüketim oranlarının sınırları (%20 Endüktif, %15 Kapasitif) aşması durumunda kurumlara cezai işlem uygulanır. Geleneksel sistemlerin aksine SPARK, sadece anlık durumu göstermekle kalmaz, ay sonuna kadar olan kümülatif oranı tahmin ederek önceden uyarı verir. Ayrıca uygulanacak reaktif müdahalelerin (örn. Şönt Reaktör) kesin faydasını simüle eder.

---

## ⚡ Veri Seti ve Altyapı

Sistem, gerçek TEİAŞ yük kayıtları ve OSOS tabanlı saatlik okumalarla çalışır. Önceki "Sadece Tarayıcı (Client-Side)" mimarisinden ölçeklenebilir modern **Backend & Frontend** mimarisine geçiş yapılmıştır.
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

### 4. 📈 Saatlik Ay Sonu Tahminci (Makine Öğrenmesi)
Python Backend'de (Scikit-Learn & Statsmodels) çalışan 7 farklı tahmin algoritması:
1. **🌳 Random Forest (Makine Öğrenmesi):** Hafta sonu, saat ve 24 saatlik gecikme (lag) özniteliklerini kullanan Regresyon Ormanı.
2. **🚀 Topluluk Modeli (Ensemble):** Random Forest ve Holt-Winters modellerinin birleştirilmiş daha stabil versiyonu.
3. **📈 Holt-Winters Üçlü Üssel Düzeltme:** Mevsimsellik ve trendi ayrıştıran istatistiksel zaman serisi modeli (24 saatlik periyot).
4. **Doğrusal Regresyon (Linear Regression):** Gecikmeli öznitelikler üzerinden lineer eğilim hesabı.
5. **İstatistiksel Ortalama:** Son 7 günün aynı saatlerinin aritmetik ortalaması.
6. **Geçen Hafta (Persistence):** Bir önceki haftanın birebir tekrarı kabulü.
7. **Geçen Ay:** Geçen ayki hareketliliğin devam edeceği varsayımı.

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
│       ├── analysis_service.py # Veri analizi ve aylık oran hesaplamaları
│       └── forecast_service.py # Scikit-Learn destekli tahmin ve ML motoru
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

# FastAPI sunucusunu başlatın
cd backend
uvicorn main:app --reload --port 8000
```
*(Sunucu `http://127.0.0.1:8000` adresinde ayağa kalkacaktır.)*

### 2. Frontend (İstemci) Başlatma
Sunucu ayaktayken, ana dizindeki **`index.html`** dosyasını herhangi bir modern web tarayıcısında (Chrome, Firefox, Safari) açmanız yeterlidir. Arayüz otomatik olarak yerel sunucuya bağlanarak çalışmaya başlayacaktır.
