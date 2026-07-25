/**
 * ═════════════════════════════════════════════════════════════════════════════
 * SPARK | Geliştirici & Otonom Sistem Denetçi Ajanı (Developer Audit Agent)
 * ═════════════════════════════════════════════════════════════════════════════
 * Bu modül, son kullanıcı arayüzünde görünmez. Sadece geliştiriciler (F12 Konsol)
 * ve otonom test süreçleri için arka planda çalışarak tüm JS modüllerini, 
 * API sözleşmelerini, _RAW_DATA veri kalitesini ve DOM bütünlüğünü denetler.
 * 
 * Konsolda manuel çalıştırmak için: AjanModulu.calistir() veya AjanModulu.rapor()
 */

const AjanModulu = (function () {
    const DENETIM_SONUCLARI = {
        basarili: [],
        uyarilar: [],
        hatalar: [],
        tamamlandi: false,
        zamanDamgasi: null
    };

    function logBasarili(kategori, mesaj) {
        DENETIM_SONUCLARI.basarili.push({ kategori, mesaj });
    }

    function logUyari(kategori, mesaj) {
        DENETIM_SONUCLARI.uyarilar.push({ kategori, mesaj });
    }

    function logHata(kategori, mesaj) {
        DENETIM_SONUCLARI.hatalar.push({ kategori, mesaj });
    }

    // 1. Modül Varlığı ve API Sözleşmesi Denetimi
    function denetleModuller() {
        const beklenenModuller = [
            { ad: 'VeriModulu', getObj: () => (typeof VeriModulu !== 'undefined' ? VeriModulu : null), kritikApiler: ['getTumVeriler', 'getTrafolar', 'getAylikVeriler'] },
            { ad: 'HesaplamaModulu', getObj: () => (typeof HesaplamaModulu !== 'undefined' ? HesaplamaModulu : null), kritikApiler: ['oranHesapla', 'aylikOzetHesapla', 'tumTrafoOzetleri'] },
            { ad: 'TahminModulu', getObj: () => (typeof TahminModulu !== 'undefined' ? TahminModulu : null), kritikApiler: ['aySonuTahminiYap', 'topluTahmin'] },
            { ad: 'SenaryoModulu', getObj: () => (typeof SenaryoModulu !== 'undefined' ? SenaryoModulu : null), kritikApiler: ['senaryoUygula', 'senaryoKarsilastir'] },
            { ad: 'GrafikModulu', getObj: () => (typeof GrafikModulu !== 'undefined' ? GrafikModulu : null), kritikApiler: ['createDashboardBarChart', 'createEnergyDoughnut'] },
            { ad: 'TopolojiModulu', getObj: () => (typeof TopolojiModulu !== 'undefined' ? TopolojiModulu : null), kritikApiler: ['render', 'openPowerTriangleModal'] },
            { ad: 'App', getObj: () => (typeof App !== 'undefined' ? App : null), kritikApiler: ['init', 'switchDashboardView', 'renderForecastBanner', 'renderDashboard'] }
        ];

        beklenenModuller.forEach(mod => {
            try {
                const obj = mod.getObj();
                if (!obj) {
                    logHata('Modül Bağımlılığı', `${mod.ad} global nesnesi tarayıcı hafızasında bulunamadı! Dosya yüklenmemiş veya JS hatası oluşmuş olabilir.`);
                } else {
                    let eksikApi = 0;
                    mod.kritikApiler.forEach(api => {
                        if (typeof obj[api] !== 'function') {
                            logHata('API Sözleşmesi', `${mod.ad}.${api}() fonksiyonu dışa aktarılmamış veya eksik!`);
                            eksikApi++;
                        }
                    });
                    if (eksikApi === 0) {
                        logBasarili('Modül API', `${mod.ad} aktif ve tüm (${mod.kritikApiler.length}) kritik API sözleşmelerini hatasız karşılıyor.`);
                    }
                }
            } catch (e) {
                logHata('Modül Denetimi', `${mod.ad} incelenirken istisna oluştu: ${e.message}`);
            }
        });
    }

    // 2. Veri Seti ve Kalite Denetimi
    function denetleVeriler() {
        try {
            const vm = typeof VeriModulu !== 'undefined' ? VeriModulu : null;
            if (!vm) {
                logHata('Veri Denetimi', 'VeriModulu yüklenemediği için veri tutarlılık denetimi yapılamıyor.');
                return;
            }

            const trafolar = vm.getTrafolar();
            if (Array.isArray(trafolar) && trafolar.length > 0) {
                const idler = trafolar.map(t => t.id).join(', ');
                logBasarili('Veri Kaynakları', `TRAFOLAR tanımı başarılı: Toplam ${trafolar.length} trafo merkezi aktif (${idler}).`);
            } else {
                logHata('Veri Kaynakları', 'TRAFOLAR listesi boş veya dizi formatında değil.');
            }

            const veriler = vm.getTumVeriler();
            if (Array.isArray(veriler) && veriler.length > 0) {
                logBasarili('Veri Kaynakları', `TEİAŞ saatlik veri tabanından toplam ${veriler.length.toLocaleString('tr-TR')} satır kayıt başarıyla okundu.`);

                let nanSayisi = 0;
                let negatifSayisi = 0;
                let bozukTarih = 0;

                veriler.forEach(v => {
                    if (isNaN(v.aktifEnerji) || isNaN(v.enduktifEnerji) || isNaN(v.kapasitifEnerji)) nanSayisi++;
                    if (v.aktifEnerji < 0 || v.enduktifEnerji < 0 || v.kapasitifEnerji < 0) negatifSayisi++;
                    if (!v.tarih || !v.tarih.includes('-')) bozukTarih++;
                });

                if (nanSayisi === 0 && negatifSayisi === 0 && bozukTarih === 0) {
                    logBasarili('Veri Kalitesi', '19.452+ saatlik kaydın tamamında sayısal bütünlük, tarih formatı ve pozitif enerji okumaları %100 geçerli.');
                } else {
                    if (nanSayisi > 0) logHata('Veri Kalitesi', `${nanSayisi} kayıtta sayısal olmayan (NaN) değer tespit edildi.`);
                    if (negatifSayisi > 0) logHata('Veri Kalitesi', `${negatifSayisi} kayıtta negatif enerji okuması (hatalı veri) tespit edildi.`);
                    if (bozukTarih > 0) logUyari('Veri Kalitesi', `${bozukTarih} kayıtta standart dışı tarih formatı var.`);
                }
            } else {
                logHata('Veri Kaynakları', '_RAW_DATA saatlik veri dizisi yüklenemedi veya boş döndü.');
            }
        } catch (e) {
            logHata('Veri Denetimi', `Veri taraması sırasında istisna (exception) oluştu: ${e.message}`);
        }
    }

    // 3. DOM & UI Senkronizasyon Denetimi
    function denetleDOM() {
        try {
            // Sadece ana kontrol panelindeyken (index.html) tam DOM testi yapalım
            if (window.location.pathname.includes('audit.html')) return;

            const kritikElementler = [
                { id: 'summary-cards', aciklama: 'KPI Özet Kart Alanı' },
                { id: 'trafo-grid', aciklama: 'Trafo Kartları Izgarası' },
                { id: 'chart-dashboard-bar', aciklama: 'Çift Barlı Karşılaştırma Grafiği Canvas' },
                { id: 'chart-dashboard-doughnut', aciklama: 'Enerji Dağılımı Halka Grafiği Canvas' },
                { id: 'dashboard-forecast-banner', aciklama: 'Dashboard Ay Sonu Tahmin & Risk Bildirim Alanı' },
                { id: 'scada-forecast-banner', aciklama: 'SCADA Ay Sonu Tahmin & Risk Bildirim Alanı' },
                { id: 'scada-board', aciklama: 'SCADA Tek Hat Vektör Alanı' },
                { id: 'power-triangle-modal', aciklama: 'Güç Üçgeni & Fazör Analizi Modal Ekranı' },
                { id: 'power-triangle-canvas', aciklama: 'Güç Üçgeni Çizim Canvas' },
                { id: 'btn-view-charts', aciklama: 'Tablo/Grafik Görünüm Geçiş Butonu' },
                { id: 'btn-view-scada', aciklama: 'SCADA Görünüm Geçiş Butonu' }
            ];

            let eksikDom = 0;
            kritikElementler.forEach(el => {
                const dom = document.getElementById(el.id);
                if (!dom) {
                    logHata('DOM Senkronizasyon', `#${el.id} (${el.aciklama}) HTML üzerinde bulunamadı!`);
                    eksikDom++;
                }
            });

            if (eksikDom === 0) {
                logBasarili('DOM Senkronizasyon', `Tüm (${kritikElementler.length}) kritik arayüz elementi ve banner taşıyıcıları HTML ile tam uyumlu.`);
            }
        } catch (e) {
            logHata('DOM Denetimi', `DOM taraması sırasında istisna oluştu: ${e.message}`);
        }
    }

    // 4. Hesaplama ve Algoritma Motoru Güvenlik Testi (Sandbox)
    function denetleAlgoritmalar() {
        try {
            const hm = typeof HesaplamaModulu !== 'undefined' ? HesaplamaModulu : null;
            if (!hm) return;

            // Sıfıra bölünme testi
            const oranSifir = hm.oranHesapla(100, 0);
            if (oranSifir === 0) {
                logBasarili('Algoritma Testi', 'HesaplamaModulu.oranHesapla(100, 0) sıfıra bölünme koruması başarılı (0 döndürüyor).');
            } else {
                logHata('Algoritma Testi', `Sıfıra bölünme testi başarısız. Beklenen: 0, Alınan: ${oranSifir}`);
            }

            // Tahmin motoru testi
            const tm = typeof TahminModulu !== 'undefined' ? TahminModulu : null;
            const vm = typeof VeriModulu !== 'undefined' ? VeriModulu : null;
            if (tm && vm) {
                const trafolar = vm.getTrafolar();
                if (trafolar && trafolar.length > 0) {
                    const testTrafoId = trafolar[0].id;
                    const tumVeriler = vm.getTrafoVerileri(testTrafoId);
                    if (tumVeriler && tumVeriler.length > 0) {
                        const sonVeriTarih = vm.parseDate(tumVeriler[tumVeriler.length - 1].tarih);
                        const testYil = sonVeriTarih.getFullYear();
                        const testAy = sonVeriTarih.getMonth() + 1;
                        
                        const sonuc = tm.aySonuTahminiYap(testTrafoId, testYil, testAy, 'ensemble');
                        if (sonuc && sonuc.tahminVeriler && sonuc.tahminVeriler.length > 0) {
                            logBasarili('Algoritma Testi', `TahminModulu (${testTrafoId}) için ${sonuc.tahminVeriler.length} adım (saat/gün) gelecek simülasyonunu başarıyla üretti.`);
                        } else {
                            logUyari('Algoritma Testi', `${testTrafoId} için ${testAy}/${testYil} dönemi tahmin motoru boş sonuç döndürdü.`);
                        }
                    }
                }
            }
        } catch (e) {
            logHata('Algoritma Testi', `Matematiksel sandbox denetiminde hata: ${e.message}`);
        }
    }

    // Ana denetimi başlat
    function calistir(sessizYazdir = false) {
        DENETIM_SONUCLARI.basarili = [];
        DENETIM_SONUCLARI.uyarilar = [];
        DENETIM_SONUCLARI.hatalar = [];

        try { denetleModuller(); } catch (e) { logHata('Ajan Hatası', e.message); }
        try { denetleVeriler(); } catch (e) { logHata('Ajan Hatası', e.message); }
        try { denetleDOM(); } catch (e) { logHata('Ajan Hatası', e.message); }
        try { denetleAlgoritmalar(); } catch (e) { logHata('Ajan Hatası', e.message); }

        DENETIM_SONUCLARI.tamamlandi = true;
        DENETIM_SONUCLARI.zamanDamgasi = new Date().toLocaleTimeString('tr-TR');

        if (sessizYazdir || true) {
            rapor();
        }

        return DENETIM_SONUCLARI;
    }

    // Konsola Şık Rapor Çıktısı Bas
    function rapor() {
        if (!DENETIM_SONUCLARI.tamamlandi) {
            calistir(false);
            return;
        }

        console.group('%c🤖 SPARK Geliştirici Otonom Denetçi Raporu', 'color: #60a5fa; font-size: 14px; font-weight: bold; background: #0f172a; padding: 6px 12px; border-radius: 6px;');
        console.log(`%c✅ Başarılı: ${DENETIM_SONUCLARI.basarili.length} | %c⚠️ Uyarı: ${DENETIM_SONUCLARI.uyarilar.length} | %c❌ Hata: ${DENETIM_SONUCLARI.hatalar.length}`, 'color: #10b981; font-weight: bold;', 'color: #f59e0b; font-weight: bold;', 'color: #ef4444; font-weight: bold;');
        
        if (DENETIM_SONUCLARI.hatalar.length > 0) {
            console.group('%c❌ Kritik Hatalar', 'color: #ef4444; font-weight: bold;');
            DENETIM_SONUCLARI.hatalar.forEach(i => console.error(`[${i.kategori}] ${i.mesaj}`));
            console.groupEnd();
        }

        if (DENETIM_SONUCLARI.uyarilar.length > 0) {
            console.group('%c⚠️ Uyarılar ve Bilgilendirmeler', 'color: #f59e0b; font-weight: bold;');
            DENETIM_SONUCLARI.uyarilar.forEach(i => console.warn(`[${i.kategori}] ${i.mesaj}`));
            console.groupEnd();
        }

        console.groupCollapsed('%c✅ Başarılı Doğrulamalar (' + DENETIM_SONUCLARI.basarili.length + ')', 'color: #10b981;');
        DENETIM_SONUCLARI.basarili.forEach(i => console.log(`%c✔ [${i.kategori}] %c${i.mesaj}`, 'color: #10b981; font-weight: bold;', 'color: #cbd5e1;'));
        console.groupEnd();

        console.groupEnd();
        return DENETIM_SONUCLARI;
    }

    return {
        calistir,
        rapor,
        getSonuclar: () => DENETIM_SONUCLARI
    };
})();

// Sayfa yüklendiğinde Ajan global olarak erişilebilir
window.AjanModulu = AjanModulu;

// Ana uygulama yüklendikten 1 saniye sonra konsola otomatik sessiz denetim raporu bas (Geliştirici F12 için)
window.addEventListener('load', () => {
    setTimeout(() => {
        if (typeof AjanModulu !== 'undefined' && !window.location.pathname.includes('audit.html')) {
            AjanModulu.calistir(true);
        }
    }, 1000);
});
