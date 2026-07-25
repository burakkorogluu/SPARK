// ============================================
// scenarios.js - Senaryo Simülasyon Motoru
// Reaktif Güç Takip ve Analiz Sistemi
// ============================================

const SenaryoModulu = (() => {
    'use strict';

    // ─── Senaryo Türleri ───
    const SENARYO_TURLERI = {
        reaktor: {
            id: 'reaktor',
            adi: 'Şönt Reaktör Devreye Alma',
            aciklama: 'Kapasitif etkiyi sönümlemek için şebekeye endüktif yük (reaktör) bağlanır.',
            birim: 'kVArh/gün',
            etiketMiktar: 'Reaktör Kapasitesi (kVArh/gün)',
            etki: 'kapasitifAzaltma',
        },
        yukTransferi: {
            id: 'yukTransferi',
            adi: 'Yük Transferi (Aktif Yük Ekleme)',
            aciklama: 'Başka bir trafodan aktif yük kaydırılarak kapasitif/aktif oranı düşürülür.',
            birim: 'kWh/gün',
            etiketMiktar: 'Transfer Miktarı (kWh/gün)',
            etki: 'aktifArtirma',
        },
        kabloCikarma: {
            id: 'kabloCikarma',
            adi: 'Kablo Devreden Çıkarma',
            aciklama: 'Boşta çalışan yer altı kabloları geçici olarak devreden çıkarılır.',
            birim: 'kVArh/gün',
            etiketMiktar: 'Azaltma Miktarı (kVArh/gün)',
            etki: 'kapasitifAzaltma',
        },
    };

    // ─── Senaryo Uygulama ───
    // Tahmin sonucundaki verilere müdahale parametreleri uygulanır.
    function senaryoUygula(tumVeriler, senaryoTuru, baslangicTarihi, miktar) {
        const isHourly = tumVeriler && tumVeriler.length > 0 && typeof tumVeriler[0].tarih === 'string' && tumVeriler[0].tarih.includes(':');
        // Formdan girilen miktar günlük (kVArh/gün veya kWh/gün) olduğu için saatlik veride her saate saatlik payı (miktar / 24) uygulanır.
        const adimMiktar = isHourly ? (miktar / 24) : miktar;

        return tumVeriler.map((v) => {
            const yeniVeri = { ...v };

            // Senaryo sadece başlangıç tarihinden itibaren ve yalnızca bugün/tahmin günlerine uygulanır
            const canApply = v.tarih >= baslangicTarihi && (v.tahmin === true || (typeof VeriModulu !== 'undefined' && v.tarih >= VeriModulu.BUGUN));
            if (canApply) {
                // Hafta sonu / tatil günlerinde müdahale etkisi farklılaşır
                const tarih = typeof VeriModulu !== 'undefined' ? VeriModulu.parseDate(v.tarih) : new Date(v.tarih);
                const isIzinGunu = v.haftaSonu || v.tatil || tarih.getDay() === 0 || tarih.getDay() === 6;

                switch (senaryoTuru) {
                    case 'reaktor':
                    case 'kabloCikarma':
                        // Kapasitif enerjiyi azalt (minimum 0)
                        yeniVeri.kapasitifEnerji = Math.max(0, Math.round(yeniVeri.kapasitifEnerji - adimMiktar));
                        break;
                    case 'yukTransferi': {
                        // Aktif enerjiyi artır — hafta sonu/tatillerde yük transferi
                        // daha düşük etkinlikte (%60) uygulanır
                        const etkiliMiktar = isIzinGunu ? Math.round(adimMiktar * 0.60) : Math.round(adimMiktar);
                        yeniVeri.aktifEnerji = Math.round(yeniVeri.aktifEnerji + etkiliMiktar);
                        break;
                    }
                }
                yeniVeri.senaryoUygulandi = true;
            }

            return yeniVeri;
        });
    }

    // ─── Senaryo Karşılaştırma ───
    // Orijinal ve senaryolu verilerin ay sonu özetlerini karşılaştırır.
    function senaryoKarsilastir(orijinalVeriler, senaryoluVeriler) {
        const orijinalOzet = HesaplamaModulu.aylikOzetHesapla(orijinalVeriler);
        const senaryoOzet = HesaplamaModulu.aylikOzetHesapla(senaryoluVeriler);

        if (!orijinalOzet || !senaryoOzet) return null;

        const kapasitifFark = senaryoOzet.kapasitifOran - orijinalOzet.kapasitifOran;
        const enduktifFark = senaryoOzet.enduktifOran - orijinalOzet.enduktifOran;

        return {
            orijinal: orijinalOzet,
            senaryo: senaryoOzet,
            kapasitifFark,
            enduktifFark,
            iyilesmeSaglandi: senaryoOzet.kapasitifOran < orijinalOzet.kapasitifOran,
            sinirAltinaIndi:
                orijinalOzet.kapasitifOran >= HesaplamaModulu.SINIRLAR.kapasitif &&
                senaryoOzet.kapasitifOran < HesaplamaModulu.SINIRLAR.kapasitif,
            kapasitifOranOrijinal: orijinalOzet.kapasitifOran,
            kapasitifOranSenaryo: senaryoOzet.kapasitifOran,
        };
    }

    // ─── Public API ───
    return {
        SENARYO_TURLERI,
        senaryoUygula,
        senaryoKarsilastir,
    };
})();
