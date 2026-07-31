---
name: project_auditor
description: SPARK projesindeki tüm dosyaların, README dokümantasyonunun, veritabanının, backend-frontend API sözleşmelerinin, gereksiz/kullanılmayan dosyaların ve yüklenen saatlik verilerin uyumunu denetleyen otonom full-stack denetim yeteneği.
---

# SPARK Otonom Proje & Dosya Denetçi Ajanı (Self-Diagnostic & Verification Skill)

Bu yetenek (`Skill`), SPARK şebeke takip ve karar destek sisteminde dosyalarda yapılan değişikliklerin ardından projenin (Frontend + Backend) kendi kendini denetlemesini sağlar.

## 🤖 Denetim Kapsamı

### 1. Dosya Varlığı ve Klasör Yapısı (README vs Kod)
* `README.md` içinde listelenen tüm dosyaların disk üzerinde mevcut olup olmadığını doğrula.
* `backend/` dizinindeki temel Python dosyalarının (`main.py`, `models.py`, `database.py`, `import_data.py`) ve `services/` alt dizinindeki servislerin varlığını doğrula.

### 2. Gereksiz ve Kullanılmayan Dosya Taraması (Orphan / Unused Files)
* Frontend: `js/` ve `css/` klasörlerindeki hiçbir HTML dosyasında çağrılmayan öksüz betik ve stil dosyalarını tespit et.
* Backend: `backend/` klasöründe hiçbir yerde `import` edilmeyen (kullanılmayan) öksüz `.py` scriptlerini tespit et.
* Veritabanı: Konfigürasyon dosyalarında (`database.py` vb.) referans verilmeyen sahipsiz/boş `.db` dosyalarını tespit et.

### 3. Yüklenen Veriler ve Veritabanı Uyumu (`Data Integrity Audit`)
* `js/data.js` içindeki `TRAFOLAR` tanımlarını (`id`, `adi`, `bolge`, `kapasite`) denetle (`UMR-TRA`, `UMR-TRB`, `KRT-TRA`, `KRT-TRB`).
* Veritabanı (örn. `osos_sim.db`) şemasıyla `backend/models.py` içerisindeki SQLAlchemy modellerinin uyumlu olup olmadığını denetle.
* `_RAW_DATA` veritabanındaki (eğer mevcutsa) satırları denetle ve `trafoId` değerlerinin `TRAFOLAR` dizisinde tanımlı bir ID olduğunu çapraz kontrol et.
* Diğer modüllerin sadece geçerli trafo özelliklerini ve EPDK ceza sınırlarını (`%20` endüktif, `%15` kapasitif) kullandığını doğrula.

### 4. HTML <-> JS DOM Senkronizasyon Denetimi
* `js/*.js` dosyalarında geçen `document.getElementById('ID')` veya `querySelector('#ID')` referanslarını topla.
* Aranan her ID'nin `index.html` veya ilgili arayüz dosyasında tanımlı olduğunu doğrula.

### 5. Frontend-Backend API Sözleşmesi & Modül Çağrı Denetimi
* Frontend JS dosyalarındaki API isteklerinin (`fetch('/api/...')`), Backend (`main.py` ve router'lar) tarafındaki endpoint tanımlarıyla (örn. `@app.get(...)`) eşleştiğini doğrula.
* IIFE modüllerinin (`return { ... }`) dışa aktardığı tüm API'leri doğrula (`VeriModulu`, `HesaplamaModulu`, vb.).
* Çapraz modül çağrılarını (`ModulAdi.fonksiyon(...)`) denetleyerek eksik, yanlış yazılmış veya silinmiş fonksiyon çağrılarını tespit et.

### 6. Sözdizimi (Syntax) ve Bağımlılık (Requirements) Denetimi
* Projedeki tüm Python dosyalarını (syntax error) ve JSON konfigürasyonlarını sözdizimi açısından denetle.
* `backend/requirements.txt` dosyasının projenin kullandığı dış kütüphanelerle uyumlu ve güncel olup olmadığını kontrol et.

### 7. README ve Dokümantasyon Doğruluk Kontrolü
* `README.md` içerisinde klasör yapısı (tree) ve listelenen tüm dosyaların diskte gerçekte mevcut olduğunu teyit et.
* Sistem genelinde belirtilen mimari bileşenlerin eksiksiz çalıştığını/kod içerisinde tanımlı olduğunu doğrula.

### 8. Çalıştırma Yöntemleri
1. **Python CLI Denetimi (Önerilen Full-Stack Denetim):**
   Terminal üzerinden yeni denetim aracını çalıştırarak kapsamlı konsol raporu alabilirsiniz:
   ```bash
   python .agents/skills/project_auditor/scripts/audit_project.py
   ```
2. **Tarayıcı İçi Görsel Paneli (`audit.html`):**
   Kullanıcı doğrudan `audit.html` dosyasını tarayıcıda açarak veya `index.html` üst menüsündeki **"🤖 Ajan Denetimi"** butonuna tıklayarak frontend odaklı görsel sağlık raporunu inceleyebilir.
3. **Tarayıcı Konsol Ajanı:**
   Tarayıcı geliştirici konsolunda `AjanModulu.calistir()` komutu çalıştırılarak anlık konsol raporu alınabilir.
