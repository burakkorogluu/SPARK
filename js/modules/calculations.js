// ============================================
// calculations.js - Hesaplama Motoru
// Reaktif Güç Takip ve Analiz Sistemi
// ============================================

const HesaplamaModulu = (() => {
    'use strict';

    // ─── TEİAŞ Yasal Sınır Değerleri ───
    const SINIRLAR = {
        enduktif: 20.0, // %20
        kapasitif: 15.0, // %15
    };

    // ─── Risk Seviye Tanımları ───
    // Oran aralığına göre risk seviyesi belirlenir.
    // Her seviye: üst sınır, etiket, renk kodu ve ikon içerir.
    const RISK_SEVIYELERI = {
        kapasitif: [
            { sinir: 10, seviye: 'guvenli', etiket: 'Güvenli', renk: '#43A047', bg: 'rgba(46, 125, 50, 0.1)', ikon: '' },
            { sinir: 12, seviye: 'dikkat', etiket: 'Dikkat', renk: '#FB8C00', bg: 'rgba(245, 124, 0, 0.1)', ikon: '' },
            { sinir: 15, seviye: 'riskli', etiket: 'Riskli', renk: '#F4511E', bg: 'rgba(230, 81, 0, 0.1)', ikon: '' },
            { sinir: Infinity, seviye: 'tehlikeli', etiket: 'Tehlikeli', renk: '#E53935', bg: 'rgba(198, 40, 40, 0.1)', ikon: '' },
        ],
        enduktif: [
            { sinir: 12, seviye: 'guvenli', etiket: 'Güvenli', renk: '#43A047', bg: 'rgba(46, 125, 50, 0.1)', ikon: '' },
            { sinir: 16, seviye: 'dikkat', etiket: 'Dikkat', renk: '#FB8C00', bg: 'rgba(245, 124, 0, 0.1)', ikon: '' },
            { sinir: 20, seviye: 'riskli', etiket: 'Riskli', renk: '#F4511E', bg: 'rgba(230, 81, 0, 0.1)', ikon: '' },
            { sinir: Infinity, seviye: 'tehlikeli', etiket: 'Tehlikeli', renk: '#E53935', bg: 'rgba(198, 40, 40, 0.1)', ikon: '' },
        ],
    };

    // ─── Temel Oran Hesaplama ───
    function oranHesapla(reaktifEnerji, aktifEnerji) {
        if (!aktifEnerji || aktifEnerji === 0) return 0;
        return (reaktifEnerji / aktifEnerji) * 100;
    }

    // ─── Kümülatif Oranlar Hesaplama ───
    // Bir dizi saatlik veya günlük veriyi alır ve her gün için
    // ayın başından itibaren birikimli (kümülatif) oranları hesaplar.
    function kumulatifOranlarHesapla(veriler) {
        if (!veriler || !veriler.length) return [];
        const dayMap = new Map();

        veriler.forEach((v) => {
            const dateStr = v.tarih.split(' ')[0]; // "YYYY-MM-DD"
            if (!dayMap.has(dateStr)) {
                dayMap.set(dateStr, {
                    ...v,
                    tarih: dateStr,
                    aktifEnerji: 0,
                    enduktifEnerji: 0,
                    kapasitifEnerji: 0,
                });
            }
            const d = dayMap.get(dateStr);
            d.aktifEnerji += Math.max(0, v.aktifEnerji || 0);
            d.enduktifEnerji += Math.max(0, v.enduktifEnerji || 0);
            d.kapasitifEnerji += Math.max(0, v.kapasitifEnerji || 0);
        });

        let toplamAktif = 0;
        let toplamEnduktif = 0;
        let toplamKapasitif = 0;

        return Array.from(dayMap.values()).map((v) => {
            toplamAktif += v.aktifEnerji;
            toplamEnduktif += v.enduktifEnerji;
            toplamKapasitif += v.kapasitifEnerji;

            return {
                ...v,
                kumulatifAktif: toplamAktif,
                kumulatifEnduktif: toplamEnduktif,
                kumulatifKapasitif: toplamKapasitif,
                gunlukKapasitifOran: oranHesapla(v.kapasitifEnerji, v.aktifEnerji),
                gunlukEnduktifOran: oranHesapla(v.enduktifEnerji, v.aktifEnerji),
                kumulatifKapasitifOran: oranHesapla(toplamKapasitif, toplamAktif),
                kumulatifEnduktifOran: oranHesapla(toplamEnduktif, toplamAktif),
            };
        });
    }

    // ─── Risk Seviyesi Belirleme ───
    function riskSeviyesiBelirle(oran, tip = 'kapasitif') {
        const seviyeler = RISK_SEVIYELERI[tip];
        for (const s of seviyeler) {
            if (oran < s.sinir) return s;
        }
        return seviyeler[seviyeler.length - 1];
    }

    // ─── Aylık Özet Hesaplama ───
    // Belirli bir trafonun belirli bir aydaki tüm verilerinin özetini çıkarır.
    function aylikOzetHesapla(veriler) {
        if (!veriler || veriler.length === 0) return null;

        const kumulatifler = kumulatifOranlarHesapla(veriler);
        const sonGun = kumulatifler[kumulatifler.length - 1];

        const toplamAktif = sonGun.kumulatifAktif;
        const toplamEnduktif = sonGun.kumulatifEnduktif;
        const toplamKapasitif = sonGun.kumulatifKapasitif;

        const kapasitifOran = oranHesapla(toplamKapasitif, toplamAktif);
        const enduktifOran = oranHesapla(toplamEnduktif, toplamAktif);

        return {
            saatSayisi: veriler.length,
            gunSayisi: Math.max(1, Math.round(veriler.length / 24)),
            toplamAktif,
            toplamEnduktif,
            toplamKapasitif,
            kapasitifOran,
            enduktifOran,
            kapasitifRisk: riskSeviyesiBelirle(kapasitifOran, 'kapasitif'),
            enduktifRisk: riskSeviyesiBelirle(enduktifOran, 'enduktif'),
            kumulatifGunluk: kumulatifler,
        };
    }

    // ─── Tüm Trafoların Aylık Özeti ───
    function tumTrafoOzetleri(yil, ay) {
        return VeriModulu.getTrafolar().map((trafo) => {
            const veriler = VeriModulu.getAylikVeriler(trafo.id, yil, ay);
            const ozet = aylikOzetHesapla(veriler);
            return { trafo, ozet };
        });
    }

    // ─── Sayı Formatlama (Türkçe) ───
    function formatSayi(sayi, ondalik = 2) {
        if (sayi == null || isNaN(sayi)) return '—';
        return sayi.toLocaleString('tr-TR', {
            minimumFractionDigits: ondalik,
            maximumFractionDigits: ondalik,
        });
    }

    function formatEnerji(sayi) {
        if (sayi == null || isNaN(sayi)) return '—';
        return sayi.toLocaleString('tr-TR', { maximumFractionDigits: 0 });
    }

    // ─── Uyarı Mesajı Üretme ───
    function uyariMesajiUret(trafoAdi, kapasitifOran, enduktifOran = 0, tahminKapOran = null, tahminEndOran = null) {
        const kapRisk = riskSeviyesiBelirle(kapasitifOran, 'kapasitif');
        const endRisk = riskSeviyesiBelirle(enduktifOran, 'enduktif');

        const riskSira = { 'tehlikeli': 4, 'riskli': 3, 'dikkat': 2, 'guvenli': 0 };
        const kapSira = riskSira[kapRisk.seviye] || 0;
        const endSira = riskSira[endRisk.seviye] || 0;

        if (endSira > kapSira) {
            if (endRisk.seviye === 'dikkat') {
                let msg = `${trafoAdi} trafosunda endüktif oran %${formatSayi(enduktifOran)} seviyesindedir ve dikkat eşiğine yaklaşmaktadır.`;
                if (tahminEndOran != null) msg += ` Ay sonunda %${formatSayi(tahminEndOran)} beklenmektedir.`;
                return msg;
            } else if (endRisk.seviye === 'riskli') {
                let msg = `⚠️ ${trafoAdi} trafosunda endüktif oran %${formatSayi(enduktifOran)} seviyesindedir.`;
                if (tahminEndOran != null && tahminEndOran >= SINIRLAR.enduktif) {
                    msg += ` Ay sonunda %${formatSayi(tahminEndOran)} ile %${SINIRLAR.enduktif} sınırının aşılması beklenmektedir.`;
                }
                return msg;
            } else if (endRisk.seviye === 'tehlikeli') {
                return `🔴 ${trafoAdi} trafosunda endüktif oran %${formatSayi(enduktifOran)} ile %${SINIRLAR.enduktif} yasal sınırını AŞMIŞ durumdadır! Acil müdahale gereklidir.`;
            }
        }

        if (kapRisk.seviye === 'guvenli') {
            return `${trafoAdi} trafosunda kapasitif (%${formatSayi(kapasitifOran)}) ve endüktif (%${formatSayi(enduktifOran)}) oranlar güvenli bölgededir.`;
        } else if (kapRisk.seviye === 'dikkat') {
            let msg = `${trafoAdi} trafosunda kapasitif oran %${formatSayi(kapasitifOran)} seviyesindedir ve dikkat eşiğine yaklaşmaktadır.`;
            if (tahminKapOran != null) {
                msg += ` Mevcut trend devam ederse ay sonunda %${formatSayi(tahminKapOran)} seviyesine ulaşması beklenmektedir.`;
            }
            return msg;
        } else if (kapRisk.seviye === 'riskli') {
            let msg = `⚠️ ${trafoAdi} trafosunda kapasitif oran %${formatSayi(kapasitifOran)} seviyesindedir.`;
            if (tahminKapOran != null && tahminKapOran >= SINIRLAR.kapasitif) {
                msg += ` Mevcut yük profili devam ederse ay sonunda %${formatSayi(tahminKapOran)} ile %${SINIRLAR.kapasitif} sınırının aşılması beklenmektedir.`;
            }
            return msg;
        } else {
            return `🔴 ${trafoAdi} trafosunda kapasitif oran %${formatSayi(kapasitifOran)} ile %${SINIRLAR.kapasitif} yasal sınırını AŞMIŞ durumdadır! Acil müdahale gereklidir.`;
        }
    }

    // ─── Public API ───
    return {
        SINIRLAR,
        RISK_SEVIYELERI,
        oranHesapla,
        kumulatifOranlarHesapla,
        riskSeviyesiBelirle,
        aylikOzetHesapla,
        tumTrafoOzetleri,
        formatSayi,
        formatEnerji,
        uyariMesajiUret,
    };
})();
