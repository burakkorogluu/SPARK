// ============================================
// data.js - Simülasyon Veri Üreteci ve Veri Modeli
// Reaktif Güç Takip ve Analiz Sistemi
// ============================================

const VeriModulu = (() => {
    'use strict';

    // ─── Yardımcı Fonksiyonlar ───
    function formatTarih(date, withHour = false) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        if (!withHour) return `${y}-${m}-${d}`;
        const hh = String(date.getHours()).padStart(2, '0');
        const mm = String(date.getMinutes()).padStart(2, '0');
        return `${y}-${m}-${d} ${hh}:${mm}`;
    }

    function parseDate(str) {
        if (!str) return new Date();
        const parts = str.split(' ');
        const [y, m, d] = parts[0].split('-').map(Number);
        if (parts[1]) {
            const [hh, mm] = parts[1].split(':').map(Number);
            return new Date(y, m - 1, d, hh || 0, mm || 0);
        }
        return new Date(y, m - 1, d);
    }

    // ─── Resmi Tatil Günleri (2025) ───
    const TATIL_GUNLERI = [
        '2025-01-01', // Yılbaşı
        '2025-03-30', '2025-03-31', '2025-04-01', // Ramazan Bayramı
        '2025-04-23', // Ulusal Egemenlik ve Çocuk Bayramı
        '2025-05-01', // Emek ve Dayanışma Günü
        '2025-05-19', // Atatürk'ü Anma, Gençlik ve Spor Bayramı
        '2025-06-06', '2025-06-07', '2025-06-08', '2025-06-09', // Kurban Bayramı
        '2025-07-15', // Demokrasi ve Millî Birlik Günü
        '2025-08-30', // Zafer Bayramı
        '2025-10-29', // Cumhuriyet Bayramı
    ];

    const TATIL_SET = new Set(TATIL_GUNLERI);

    // ─── Gerçek Trafo Tanımları (TEİAŞ 2025) ───
    const TRAFOLAR = [
        {
            id: 'UMR-TRA',
            adi: 'Ümraniye TM – TRA',
            bolge: 'Ümraniye',
            tip: 'Yer altı kablolu',
            kapasite: 100,
            aciklama: 'Ümraniye Trafo Merkezi, 100 MVA Güç, Yer altı kablo ağı',
        },
        {
            id: 'UMR-TRB',
            adi: 'Ümraniye TM – TRB',
            bolge: 'Ümraniye',
            tip: 'Yer altı kablolu',
            kapasite: 100,
            aciklama: 'Ümraniye Trafo Merkezi, 100 MVA Güç, %14.8 kapasitif oran ile en riskli trafo',
        },
        {
            id: 'KRT-TRA',
            adi: 'Kartal TM – TRA',
            bolge: 'Kartal',
            tip: 'Karma (Kablo + Havai)',
            kapasite: 80,
            aciklama: 'Kartal Trafo Merkezi, 80 MVA Güç, Karma hat yapısı',
        },
        {
            id: 'KRT-TRB',
            adi: 'Kartal TM – TRB',
            bolge: 'Kartal',
            tip: 'Karma (Kablo + Havai)',
            kapasite: 80,
            aciklama: 'Kartal Trafo Merkezi, 80 MVA Güç, Karma hat yapısı',
        },
    ];

    let _ekTrafolar = [];
    try {
        const kayitli = localStorage.getItem('spark_ek_trafolar');
        if (kayitli) {
            _ekTrafolar = JSON.parse(kayitli);
            if (Array.isArray(_ekTrafolar)) {
                _ekTrafolar.forEach(t => TRAFOLAR.push(t));
            }
        }
    } catch (e) {
        console.warn('Ek trafolar yüklenemedi:', e);
    }

    function trafoEkle(trafoObj) {
        if (!TRAFOLAR.find(t => t.id === trafoObj.id)) {
            TRAFOLAR.push(trafoObj);
            _ekTrafolar.push(trafoObj);
            try {
                localStorage.setItem('spark_ek_trafolar', JSON.stringify(_ekTrafolar));
            } catch (e) {
                console.error('Trafo kaydedilemedi:', e);
            }
        }
    }

    // ─── Veri Aralığı Parametreleri ───
    const BASLANGIC_TARIH = '2025-01-01';
    const BITIS_TARIH = '2025-07-22 14:00'; // Gerçek Temmuz saatlik son kayıt tarihi

    // ─── Gerçek TEİAŞ Saatlik Veri Seti (2025-01-01 00:00 -> 2025-07-22 14:00) ───
    // Format: [trafoId, saatlikTarih, aktifEnerji (kWh), enduktifEnerji (kVArh), kapasitifEnerji (kVArh)]
    let _RAW_DATA = [];

    // ─── Tüm Saatlik Verileri Yükleme ───
    let _tumVeriler = [];
    let _veriMap = new Map(); // trafoId → [veriler]

    let _silinmisVeriler = new Set();
    const STORAGE_KEY_SILINMIS = 'spark_silinmis_veriler';

    function silinmisVerileriKaydet() {
        try {
            localStorage.setItem(STORAGE_KEY_SILINMIS, JSON.stringify(Array.from(_silinmisVeriler)));
        } catch (e) {}
    }

    function silinmisVerileriYukle() {
        try {
            const kayitli = localStorage.getItem(STORAGE_KEY_SILINMIS);
            if (kayitli) {
                _silinmisVeriler = new Set(JSON.parse(kayitli));
            }
        } catch (e) {}
    }

    function tumVerileriYukle() {
        _tumVeriler = [];
        _veriMap = new Map();
        silinmisVerileriYukle();

        TRAFOLAR.forEach((trafo) => {
            _veriMap.set(trafo.id, []);
        });

        _RAW_DATA.forEach(([trafoId, tarih, aktifEnerji, enduktifEnerji, kapasitifEnerji]) => {
            if (_silinmisVeriler.has(`${trafoId}_${tarih}`)) return;
            const d = parseDate(tarih);
            const gun = d.getDay();
            const dateStr = tarih.split(' ')[0];
            const veri = {
                trafoId,
                tarih,
                aktifEnerji,
                enduktifEnerji,
                kapasitifEnerji,
                haftaSonu: gun === 0 || gun === 6,
                tatil: TATIL_SET.has(dateStr),
            };
            _tumVeriler.push(veri);
            if (_veriMap.has(trafoId)) {
                _veriMap.get(trafoId).push(veri);
            }
        });
    }

    async function init() {
        try {
            if (typeof SPARK_RAW_DATA !== 'undefined') {
                _RAW_DATA = SPARK_RAW_DATA;
                console.log(`VeriModulu: ${_RAW_DATA.length} satır ham veri yüklendi.`);
            } else {
                throw new Error("SPARK_RAW_DATA bulunamadı");
            }
        } catch (e) {
            console.error('VeriModulu: raw_data.js yüklenemedi:', e);
            _RAW_DATA = [];
        }
        
        tumVerileriYukle();
        ekVerileriYukle();
    }

    // ─── Kullanıcı Tarafından Eklenen Veriler ───
    let _ekVeriler = []; // Manuel girilen veriler burada tutulur

    // ─── localStorage Persistence ───
    const STORAGE_KEY = 'spark_ek_veriler';

    function ekVerileriKaydet() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(_ekVeriler));
        } catch (e) {
            // localStorage dolu veya erişilemez — sessizce devam et
        }
    }

    function ekVerileriYukle() {
        try {
            const kayitli = localStorage.getItem(STORAGE_KEY);
            if (!kayitli) return;
            const veriler = JSON.parse(kayitli);
            if (!Array.isArray(veriler)) return;
            veriler.forEach(v => {
                // Doğrudan iç veri yapılarına ekle (tekrar kaydetmeye gerek yok)
                _ekVeriler.push(v);
                if (!_veriMap.has(v.trafoId)) {
                    _veriMap.set(v.trafoId, []);
                }
                const trafoVerileri = _veriMap.get(v.trafoId);
                const mevcutIdx = trafoVerileri.findIndex(mevcut => mevcut.tarih === v.tarih);
                
                if (mevcutIdx !== -1) {
                    trafoVerileri[mevcutIdx] = v;
                    const genelIdx = _tumVeriler.findIndex(genel => genel.trafoId === v.trafoId && genel.tarih === v.tarih);
                    if (genelIdx !== -1) _tumVeriler[genelIdx] = v;
                } else {
                    trafoVerileri.push(v);
                    _tumVeriler.push(v);
                }
            });
            // Tüm trafoların verilerini tarihe göre sırala
            _veriMap.forEach((veriler) => {
                veriler.sort((a, b) => a.tarih.localeCompare(b.tarih));
            });
        } catch (e) {
            // Parse hatası — sessizce devam et
        }
    }

    // Modül yüklendiğinde kayıtlı ek verileri geri yükle
    // ekVerileriYukle() artık init() içinden çağrılıyor

    function veriEkle(veri) {
        // ── Mükerrer Kontrol ──
        // Aynı trafoId + tarih varsa üzerine yaz (çift sayımı önle)
        const trafoVerileri = _veriMap.get(veri.trafoId);
        if (trafoVerileri) {
            const mevcutIdx = trafoVerileri.findIndex(v => v.tarih === veri.tarih);
            if (mevcutIdx !== -1) {
                // Mevcut veriyi güncelle
                trafoVerileri[mevcutIdx] = veri;
                // _tumVeriler'den de güncelle
                const genelIdx = _tumVeriler.findIndex(v => v.trafoId === veri.trafoId && v.tarih === veri.tarih);
                if (genelIdx !== -1) _tumVeriler[genelIdx] = veri;
                // _ekVeriler'den de güncelle
                const ekIdx = _ekVeriler.findIndex(v => v.trafoId === veri.trafoId && v.tarih === veri.tarih);
                if (ekIdx !== -1) {
                    _ekVeriler[ekIdx] = veri;
                } else {
                    _ekVeriler.push(veri);
                }
                ekVerileriKaydet();
                return;
            }
        }

        // ── Yeni Veri Ekle ──
        _ekVeriler.push(veri);
        _tumVeriler.push(veri);
        if (!_veriMap.has(veri.trafoId)) {
            _veriMap.set(veri.trafoId, []);
        }
        _veriMap.get(veri.trafoId).push(veri);
        // Tarihe göre sırala
        _veriMap.get(veri.trafoId).sort((a, b) => a.tarih.localeCompare(b.tarih));
        ekVerileriKaydet();
    }

    function veriSil(trafoId, tarih) {
        _silinmisVeriler.add(`${trafoId}_${tarih}`);
        silinmisVerileriKaydet();

        // Ana haritadan sil
        const trafoVerileri = _veriMap.get(trafoId);
        if (trafoVerileri) {
            const idx = trafoVerileri.findIndex(v => v.tarih === tarih);
            if (idx !== -1) trafoVerileri.splice(idx, 1);
        }
        // Genel listeden sil
        const genelIdx = _tumVeriler.findIndex(v => v.trafoId === trafoId && v.tarih === tarih);
        if (genelIdx !== -1) _tumVeriler.splice(genelIdx, 1);
        // Ek verilerden sil
        const ekIdx = _ekVeriler.findIndex(v => v.trafoId === trafoId && v.tarih === tarih);
        if (ekIdx !== -1) _ekVeriler.splice(ekIdx, 1);
        ekVerileriKaydet();
    }

    // ─── Public API ───
    return {
        init,
        getTrafolar: () => TRAFOLAR,
        getTrafo: (id) => TRAFOLAR.find((t) => t.id === id),
        trafoEkle,
        getTumVeriler: () => _tumVeriler,
        getTrafoVerileri: (trafoId) => _veriMap.get(trafoId) || [],
        getAylikVeriler: (trafoId, yil, ay) => {
            // ay: 1-12 (Ocak=1, Temmuz=7)
            const prefix = `${yil}-${String(ay).padStart(2, '0')}`;
            return (_veriMap.get(trafoId) || []).filter((v) =>
                v.tarih.startsWith(prefix)
            );
        },
        getTatiller: () => TATIL_GUNLERI,
        veriEkle,
        veriSil,
        BUGUN: BITIS_TARIH.split(' ')[0],
        BUGUN_SAATLIK: BITIS_TARIH,
        formatTarih,
        parseDate,
    };
})();
