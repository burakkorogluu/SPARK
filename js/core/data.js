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
        // 2026
        '2026-01-01',
        '2026-03-20', '2026-03-21', '2026-03-22',
        '2026-04-23',
        '2026-05-01',
        '2026-05-19',
        '2026-05-27', '2026-05-28', '2026-05-29', '2026-05-30',
        '2026-07-15',
        '2026-08-30',
        '2026-10-29',
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
                // Hatalı/bozuk kayıtları temizle (Örn: string olarak kaydedilmiş olanlar)
                const gecerliTrafolar = _ekTrafolar.filter(t => t && typeof t === 'object' && t.id);
                gecerliTrafolar.forEach(t => TRAFOLAR.push(t));
                
                // Eğer bozuk kayıtlar varsa localStorage'ı temiziyle güncelle
                if (gecerliTrafolar.length !== _ekTrafolar.length) {
                    _ekTrafolar = gecerliTrafolar;
                    localStorage.setItem('spark_ek_trafolar', JSON.stringify(_ekTrafolar));
                }
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
    
    function getFormattedCurrentDate() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hour = String(now.getHours()).padStart(2, '0');
        return `${year}-${month}-${day} ${hour}:00`;
    }
    const BITIS_TARIH = getFormattedCurrentDate();
    // ─── Tüm Saatlik Verileri Yükleme ───
    let _tumVeriler = [];
    let _veriMap = new Map(); // trafoId → [veriler]
    let _loadedMonths = new Set();
    // Hızlı erişim indeksi: "trafoId|tarih" → _tumVeriler dizisindeki index
    let _tumVerilerIndex = new Map();

    async function loadAylikVeriler(yil, ay) {
        const monthKey = `${yil}-${String(ay).padStart(2, '0')}`;
        if (_loadedMonths.has(monthKey)) {
            return; // Zaten yüklendi
        }
        
        const startDate = `${monthKey}-01`;
        const lastDay = new Date(yil, ay, 0).getDate();
        const endDate = `${monthKey}-${String(lastDay).padStart(2, '0')}`;
        
        try {
            const measurements = await ApiClient.fetchMeasurements(startDate, endDate);
            
            const yeniVeriler = measurements.map(m => {
                const tarih = m.timestamp.replace('T', ' ');
                const d = parseDate(tarih);
                const gun = d.getDay();
                const dateStr = tarih.split(' ')[0];
                return {
                    trafoId: m.transformer_id,
                    tarih: tarih,
                    aktifEnerji: m.active_kwh,
                    enduktifEnerji: m.inductive_kvarh,
                    kapasitifEnerji: m.capacitive_kvarh,
                    haftaSonu: gun === 0 || gun === 6,
                    tatil: TATIL_SET.has(dateStr)
                };
            });
            
            veriEkleToplu(yeniVeriler);
            _loadedMonths.add(monthKey);
            console.log(`VeriModulu: ${monthKey} dönemi için ${yeniVeriler.length} ölçüm başarıyla yüklendi.`);
        } catch (e) {
            console.error(`VeriModulu: ${monthKey} verileri çekilemedi:`, e);
            document.body.insertAdjacentHTML('afterbegin', `<div style="background:red;color:white;padding:10px;z-index:99999;position:fixed;top:0;left:0;width:100%;">API GET ERROR: ${e.message}</div>`);
        }
    }

    async function init() {
        _tumVeriler = [];
        _veriMap = new Map();
        _loadedMonths = new Set();
        _tumVerilerIndex = new Map();
        TRAFOLAR.forEach((trafo) => {
            _veriMap.set(trafo.id, []);
        });
        localStorage.removeItem('spark_ek_veriler');
        localStorage.removeItem('spark_silinmis_veriler');
    }

    async function veriEkle(veri) {
        const payload = {
            transformer_id: veri.trafoId,
            timestamp: veri.tarih,
            active_kwh: parseInt(veri.aktifEnerji, 10) || 0,
            inductive_kvarh: parseInt(veri.enduktifEnerji, 10) || 0,
            capacitive_kvarh: parseInt(veri.kapasitifEnerji, 10) || 0
        };

        await ApiClient.addMeasurement(payload);

        const indexKey = `${veri.trafoId}|${veri.tarih}`;
        const trafoVerileri = _veriMap.get(veri.trafoId);

        if (trafoVerileri) {
            const existingPos = _tumVerilerIndex.get(indexKey);
            if (existingPos !== undefined) {
                // Veri zaten var — güncelle
                _tumVeriler[existingPos] = veri;
                const trafoIdx = trafoVerileri.findIndex(v => v.tarih === veri.tarih);
                if (trafoIdx !== -1) trafoVerileri[trafoIdx] = veri;
                return;
            }
        }

        const newIdx = _tumVeriler.length;
        _tumVeriler.push(veri);
        _tumVerilerIndex.set(indexKey, newIdx);
        if (!_veriMap.has(veri.trafoId)) {
            _veriMap.set(veri.trafoId, []);
        }
        _veriMap.get(veri.trafoId).push(veri);
        _veriMap.get(veri.trafoId).sort((a, b) => (a.tarih || '').localeCompare(b.tarih || ''));
    }

    function veriEkleToplu(yeniVerilerDizisi) {
        // O(n) ekleme — Map indeksi ile duplicate kontrolü
        let needsSort = false;
        yeniVerilerDizisi.forEach(veri => {
            const indexKey = `${veri.trafoId}|${veri.tarih}`;
            const existingPos = _tumVerilerIndex.get(indexKey);

            if (existingPos !== undefined) {
                // Güncelle
                _tumVeriler[existingPos] = veri;
            } else {
                // Yeni ekle
                const newPos = _tumVeriler.length;
                _tumVeriler.push(veri);
                _tumVerilerIndex.set(indexKey, newPos);
                needsSort = true;
            }

            if (!_veriMap.has(veri.trafoId)) _veriMap.set(veri.trafoId, []);
            const trafoVerileri = _veriMap.get(veri.trafoId);
            const trafoIdx = trafoVerileri.findIndex(v => v.tarih === veri.tarih);
            if (trafoIdx !== -1) {
                trafoVerileri[trafoIdx] = veri;
            } else {
                trafoVerileri.push(veri);
                needsSort = true;
            }
        });

        if (needsSort) {
            _veriMap.forEach(veriler => veriler.sort((a, b) => {
                const ta = (a && a.tarih) ? a.tarih : '';
                const tb = (b && b.tarih) ? b.tarih : '';
                return ta.localeCompare(tb);
            }));
        }
    }

    async function veriSil(trafoId, tarih) {
        await ApiClient.deleteMeasurement(trafoId, tarih);

        // İndeksten sil
        const indexKey = `${trafoId}|${tarih}`;
        const pos = _tumVerilerIndex.get(indexKey);
        if (pos !== undefined) {
            _tumVeriler.splice(pos, 1);
            _tumVerilerIndex.delete(indexKey);
            // Kaydırılan indeksleri güncelle
            for (let i = pos; i < _tumVeriler.length; i++) {
                const v = _tumVeriler[i];
                _tumVerilerIndex.set(`${v.trafoId}|${v.tarih}`, i);
            }
        }
        // trafoMap'ten sil
        const trafoVerileri = _veriMap.get(trafoId);
        if (trafoVerileri) {
            const idx = trafoVerileri.findIndex(v => v.tarih === tarih);
            if (idx !== -1) trafoVerileri.splice(idx, 1);
        }
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
        loadAylikVeriler,
        getTatiller: () => TATIL_GUNLERI,
        veriEkle,
        veriEkleToplu,
        veriSil,
        BUGUN: BITIS_TARIH.split(' ')[0],
        BUGUN_SAATLIK: BITIS_TARIH,
        formatTarih,
        parseDate,
    };
})();
