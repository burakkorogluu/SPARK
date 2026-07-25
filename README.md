# 🌐 SPARK | Akıllı Şebeke Reaktif Güç Takip, Saatlik Tahmin ve Karar Destek Sistemi

**SPARK**, Türkiye Elektrik İletim A.Ş. (**TEİAŞ**) trafo merkezlerinin saatlik yük verilerini kullanarak aktif, endüktif ve kapasitif enerji tüketimlerini gerçek zamanlı izleyen; EPDK reaktif ceza sınırlarına karşı yapay zeka ve makine öğrenmesi modelleriyle **saatlik ay sonu ceza projeksiyonu** sunan gelişmiş bir **SCADA ve Karar Destek Sistemidir**.

---

## 🎯 Projenin Amacı ve Çözdüğü Problem

Türkiye'de **EPDK (Enerji Piyasası Düzenleme Kurumu)** mevzuatına göre aylık kümülatif reaktif enerji tüketim oranlarının sınırları (%20 Endüktif, %15 Kapasitif) aşması durumunda kurumlara cezai işlem uygulanır. Geleneksel sistemlerin aksine SPARK, sadece anlık durumu göstermekle kalmaz, ay sonuna kadar olan kümülatif oranı tahmin ederek önceden uyarı verir. Ayrıca uygulanacak reaktif müdahalelerin (örn. Şönt Reaktör) kesin faydasını simüle eder.

---

## ⚡ Gerçek TEİAŞ Veri Seti

Sistem, 2025 yılına ait **19.452 saatlik gerçek TEİAŞ yük kaydı** (`data/raw_data.json`) ile çalışır.
Veri dosyasının boyutu (1.1 MB) nedeniyle uygulama açılırken Asenkron (async/await) yapı ile `fetch` üzerinden RAM'e yüklenir.

**Tanımlı Trafolar:**
* 🏙️ **Ümraniye TM – TRA (`UMR-TRA`)**: `100 MVA` 
* 🏙️ **Ümraniye TM – TRB (`UMR-TRB`)**: `100 MVA` (Kapasitif riski en yüksek trafo)
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
Aydaki kalan tüm saatler için 7 farklı algoritma ile ileri yönlü projeksiyon üretilir.
1. **🌳 Random Forest (Makine Öğrenmesi):** Sıfırdan Vanilla JS ile yazılmış Karar Ağaçları ormanıdır. **Gelişmiş Öznitelik Mühendisliği (Feature Engineering)** kullanır:
   - Açık Hava Durumu API'si (Open-Meteo) üzerinden **Sıcaklık, Nem, Bulutluluk, Radyasyon**.
   - One-Hot kodlanmış Günler, Tatil ve Hafta Sonu bilgisi.
   - Zaman serisi gecikmeleri (Lags: `t-1`, `t-24`, `t-168`) ve Auto-Regressive yapı.
2. **🚀 Topluluk Modeli (Ensemble):** Holt-Winters + Random Forest + Regresyon + Geçen Hafta kombinasyonu.
3. **📈 Holt-Winters Üçlü Üssel Düzeltme:** Mevsimsellik ve trendi ayrıştıran istatistiksel zaman serisi.
4. Diğerleri: Doğrusal Regresyon, Ağırlıklı Ortalama, Persistence.

Sistem ayrıca **⚡ Canlı Backtesting** ile modellerin o anki verideki hata payını (WMAPE) canlı ölçer.

---

## 🛠️ Mimari ve Klasör Yapısı

Şu anki SPARK, tamamen **İstemci Tarafında (Client-Side Vanilla JS)**, sunucusuz (Serverless) olarak çalışmaktadır. 

```text
SPARK/
├── index.html                  # Ana uygulama iskeleti ve arayüz
├── audit.html                  # Ajan (Otonom Denetçi) Görsel Paneli
├── data/
│   └── raw_data.json           # 19.452 satırlık TEİAŞ veri seti
├── css/
│   └── style.css               # Tasarım sistemi
└── js/
    ├── app.js                  # Uygulama denetleyicisi (Controller)
    ├── data.js                 # Veri modülü (Async Fetch işlemleri)
    ├── calculations.js         # Reaktif ceza ve matematiksel formüller
    ├── weather.js              # Open-Meteo Canlı Hava Durumu entegrasyonu
    ├── forecast.js             # İstatistiksel modeller ve Feature Engineering
    ├── randomForest.js         # JavaScript tabanlı Random Forest Regressor
    ├── scenarios.js            # Reaktör/Yük simülasyonları
    ├── charts.js               # Chart.js yapılandırmaları
    ├── topology.js             # SCADA ve Canvas çizimleri
    └── agent.js                # Otonom Proje & Dosya Denetçi Ajanı
```

---

## ⚠️ Production (Canlı Ortam) & Ölçeklenebilirlik Notu

SPARK'ın mevcut **sadece tarayıcı (Client-Side)** mimarisi, prototipleme ve düşük trafo sayılarında muazzam hızlı ve maliyetsizdir. Ancak projenin üretim (Production) ortamına alınıp yüzlerce trafoya ölçeklenmesi durumunda mevcut mimaride **darboğazlar (bottlenecks)** yaşanacaktır:

1. **Bellek Sınırı (Out of Memory):** 100 trafoluk (milyonlarca satır) JSON dosyasının indirilip RAM'de JS objelerine çevrilmesi tarayıcıyı dondurur veya çökertir.
2. **Main Thread (Donma):** Yüzlerce trafo için JS üzerinde Random Forest ve Backtest çalıştırılması tarayıcının kilitlenmesine sebep olur.
3. **Network Yükü:** Devasa veri dosyalarının yüklenmesi açılış süresini (Load Time) uzatır.

**Ölçeklenmiş (Enterprise) Mimaride Olması Gerekenler:**
* **Veritabanı & API:** Veriler istemci yerine PostgreSQL / InfluxDB gibi veritabanlarında tutulmalı; tarayıcıya sadece sayfalama ile ihtiyaç olan (ekrandaki) küçük veri blokları gönderilmelidir.
* **Server-side ML:** Makine Öğrenmesi (Random Forest, XGBoost) ve yoğun istatistik hesapları tarayıcıdan alınıp **Python (Backend)** sunucusunda hesaplatılmalı, tarayıcıya sadece sonuçlar iletilmelidir.

---

## 🚀 Kurulum ve Çalıştırma
Hiçbir veritabanı veya Node.js/Python sunucusu kurmanıza gerek yoktur.
```bash
git clone https://github.com/kullaniciadi/SPARK.git
cd SPARK
```
**`index.html`** dosyasını herhangi bir web tarayıcısında açmanız yeterlidir.
