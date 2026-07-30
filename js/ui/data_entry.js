/**
 * SPARK Veri Girişi Ekranı Modülü (data_entry.js)
 */
const DataEntryUI = (() => {
    'use strict';

    function setupFormHandlers() {
        // Manuel veri giriş formu
        const form = document.getElementById('veri-giris-form');
        form?.addEventListener('submit', async (e) => {
            e.preventDefault();

            const trafoId = document.getElementById('input-trafo').value;
            let tarih = document.getElementById('input-tarih').value;
            tarih = tarih.replace('T', ' '); // YYYY-MM-DD HH:mm formatı için T'yi boşluğa çevir
            const aktif = parseInt(document.getElementById('input-aktif').value);
            const enduktif = parseInt(document.getElementById('input-enduktif').value);
            const kapasitif = parseInt(document.getElementById('input-kapasitif').value);

            if (!trafoId || !tarih || isNaN(aktif) || isNaN(enduktif) || isNaN(kapasitif)) {
                App.showToast('Lütfen tüm alanları doldurun.', 'error');
                return;
            }

            if (aktif < 0 || enduktif < 0 || kapasitif < 0) {
                App.showToast('Negatif enerji değeri girilemez (Hatalı ölçüm).', 'error');
                return;
            }

            const d = VeriModulu.parseDate(tarih);
            if (typeof DashboardUI !== 'undefined') DashboardUI.clearCache();

            try {
                await VeriModulu.veriEkle({
                    trafoId,
                    tarih,
                    aktifEnerji: aktif,
                    enduktifEnerji: enduktif,
                    kapasitifEnerji: kapasitif,
                    haftaSonu: d.getDay() === 0 || d.getDay() === 6,
                    tatil: false,
                });
                App.showToast('Veri veritabanına başarıyla kaydedildi!', 'success');
                form.reset();
                renderVeriTablosu();
            } catch (err) {
                console.error("Veri eklenirken hata oluştu:", err);
                App.showToast('Veri kaydedilirken hata oluştu!', 'error');
            }
        });

        // CSV dosya seçimi
        document.getElementById('btn-csv-sec')?.addEventListener('click', () => {
            document.getElementById('csv-file-input')?.click();
        });

        document.getElementById('csv-file-input')?.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            handleCSVUpload(file);
        });

        // Drag & drop
        const dropArea = document.getElementById('csv-upload-area');
        if (dropArea) {
            ['dragover', 'dragenter'].forEach(ev => {
                dropArea.addEventListener(ev, (e) => {
                    e.preventDefault();
                    dropArea.classList.add('drag-over');
                });
            });
            ['dragleave', 'drop'].forEach(ev => {
                dropArea.addEventListener(ev, (e) => {
                    if (ev === 'dragleave' && dropArea.contains(e.relatedTarget)) return;
                    dropArea.classList.remove('drag-over');
                });
            });
            dropArea.addEventListener('drop', (e) => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file && file.name.endsWith('.csv')) {
                    handleCSVUpload(file);
                }
            });
        }

        // Yeni Trafo Ekleme Modalı Kontrolleri
        const btnOpenYeniTrafo = document.getElementById('btn-open-yeni-trafo');
        const btnCloseYeniTrafo = document.getElementById('btn-close-yeni-trafo');
        const modalYeniTrafo = document.getElementById('yeni-trafo-modal');
        const formYeniTrafo = document.getElementById('yeni-trafo-form');

        if (btnOpenYeniTrafo && modalYeniTrafo) {
            btnOpenYeniTrafo.addEventListener('click', () => {
                modalYeniTrafo.style.display = 'flex';
            });
        }
        if (btnCloseYeniTrafo && modalYeniTrafo) {
            btnCloseYeniTrafo.addEventListener('click', () => {
                modalYeniTrafo.style.display = 'none';
            });
        }
        if (formYeniTrafo) {
            formYeniTrafo.addEventListener('submit', (e) => {
                e.preventDefault();
                const id = document.getElementById('new-trafo-id').value.trim().toUpperCase();
                const adi = document.getElementById('new-trafo-adi').value.trim();
                const bolge = document.getElementById('new-trafo-bolge').value.trim();
                const guc = parseInt(document.getElementById('new-trafo-guc').value, 10);

                if (id && adi) {
                    VeriModulu.trafoEkle({
                        id: id,
                        adi: adi,
                        bolge: bolge || 'Bilinmiyor',
                        tip: 'Bilinmiyor',
                        kapasite: isNaN(guc) ? 100 : guc,
                        aciklama: 'Manuel eklendi.'
                    });

                    App.showToast('Yeni trafo başarıyla eklendi.', 'success');
                    modalYeniTrafo.style.display = 'none';
                    formYeniTrafo.reset();

                    App.populateTrafoSelects();
                    const select = document.getElementById('input-trafo');
                    if (select) select.value = id;
                }
            });
        }

        // OSOS Veri Çekme
        const btnOsosFetch = document.getElementById('btn-osos-fetch');
        if (btnOsosFetch) {
            btnOsosFetch.addEventListener('click', async () => {
                const start = document.getElementById('osos-date-start').value;
                const end = document.getElementById('osos-date-end').value;

                if (!start || !end) {
                    App.showToast('Lütfen başlangıç ve bitiş tarihlerini seçin.', 'error');
                    return;
                }

                try {
                    btnOsosFetch.disabled = true;
                    btnOsosFetch.innerHTML = 'Çekiliyor...';

                    const data = await ApiClient.fetchMeasurements(start, end);
                    if (data && data.length > 0) {
                        for (const m of data) {
                            const d = new Date(m.timestamp);
                            await VeriModulu.veriEkle({
                                trafoId: m.transformer_id,
                                tarih: m.timestamp.replace('T', ' '),
                                aktifEnerji: m.active_kwh,
                                enduktifEnerji: m.inductive_kvarh,
                                kapasitifEnerji: m.capacitive_kvarh,
                                haftaSonu: d.getDay() === 0 || d.getDay() === 6,
                                tatil: false,
                            });
                        }

                        if (typeof DashboardUI !== 'undefined') DashboardUI.clearCache();
                        App.showToast(`${data.length} ölçüm başarıyla OSOS'tan çekildi!`, 'success');
                        renderVeriTablosu();
                    } else {
                        App.showToast('Belirtilen aralıkta veri bulunamadı.', 'warning');
                    }
                } catch (error) {
                    App.showToast(error.message, 'error');
                } finally {
                    btnOsosFetch.disabled = false;
                    btnOsosFetch.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle; margin-right: 5px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Verileri Çek';
                }
            });
        }
    }

    function handleCSVUpload(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target.result;
            const lines = text.split('\n').filter(l => l.trim());
            const trafolar = VeriModulu.getTrafolar();
            const trafoMap = new Set(trafolar.map(t => t.id));

            const yeniTrafolar = new Set();
            for (let i = 1; i < lines.length; i++) {
                const parts = lines[i].split(/[,;\t]/).map(s => s.trim());
                if (parts.length >= 5) {
                    const trafoId = parts[0];
                    if (!trafoMap.has(trafoId)) {
                        yeniTrafolar.add(trafoId);
                    }
                }
            }

            if (yeniTrafolar.size > 0) {
                const onay = confirm(`CSV dosyasında daha önce karşılaşılmamış şu yeni trafolar bulundu:\n${Array.from(yeniTrafolar).join(', ')}\n\nBunları sisteme otomatik olarak eklemek istiyor musunuz?`);
                if (onay) {
                    yeniTrafolar.forEach(id => {
                        VeriModulu.trafoEkle({
                            id: id,
                            adi: id,
                            bolge: 'Bilinmiyor',
                            tip: 'Bilinmiyor',
                            kapasite: 100,
                            aciklama: 'CSV\'den otomatik eklendi.'
                        });
                        trafoMap.add(id);
                    });
                    App.populateTrafoSelects();
                    App.showToast('Yeni trafolar sisteme kaydedildi.', 'success');
                }
            }

            let count = 0;
            let skipped = 0;
            let negativeSkipped = 0;
            const yeniVeriler = [];

            for (let i = 1; i < lines.length; i++) {
                const parts = lines[i].split(/[,;\t]/).map(s => s.trim());
                if (parts.length >= 5) {
                    const [trafoId, tarih, aktifStr, enduktifStr, kapasitifStr] = parts;
                    const aktif = parseFloat(aktifStr);
                    const enduktif = parseFloat(enduktifStr);
                    const kapasitif = parseFloat(kapasitifStr);
                    const dateMatch = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])( ([01]\d|2[0-3]):[0-5]\d)?$/.test(tarih);

                    if (!trafoMap.has(trafoId) || !dateMatch || isNaN(aktif) || isNaN(enduktif) || isNaN(kapasitif)) {
                        skipped++;
                        continue;
                    }

                    if (aktif < 0 || enduktif < 0 || kapasitif < 0) {
                        negativeSkipped++;
                        continue;
                    }

                    const d = VeriModulu.parseDate(tarih);
                    if (isNaN(d.getTime())) {
                        skipped++;
                        continue;
                    }

                    yeniVeriler.push({
                        trafoId,
                        tarih,
                        aktifEnerji: aktif,
                        enduktifEnerji: enduktif,
                        kapasitifEnerji: kapasitif,
                        haftaSonu: d.getDay() === 0 || d.getDay() === 6,
                        tatil: false,
                    });
                    count++;
                } else {
                    skipped++;
                }
            }

            if (yeniVeriler.length > 0) {
                if (typeof DashboardUI !== 'undefined') DashboardUI.clearCache();
                VeriModulu.veriEkleToplu(yeniVeriler);
            }

            const totalSkipped = skipped + negativeSkipped;
            let skipMsg = '';
            if (totalSkipped > 0) {
                const details = [];
                if (skipped > 0) details.push(`${skipped} biçim/trafo hatası`);
                if (negativeSkipped > 0) details.push(`${negativeSkipped} negatif değer/işaret kuralı ihlali`);
                skipMsg = ` (${details.join(', ')} atlandı)`;
            }

            if (count > 0) {
                App.showToast(`${count} adet veri başarıyla yüklendi!${skipMsg}`, 'success');
                renderVeriTablosu();
            } else {
                App.showToast(`Yüklenecek geçerli veri bulunamadı.${skipMsg}`, 'error');
            }
        };
        reader.readAsText(file);
    }

    function renderVeriGiris() {
        let varsayilan = VeriModulu.BUGUN_SAATLIK || '2025-07-22 14:00';
        const inputTarih = document.getElementById('input-tarih');
        if (inputTarih) inputTarih.value = varsayilan.replace(' ', 'T');
        renderVeriTablosu();
    }

    function renderVeriTablosu() {
        try {
            const state = App.getState();
            const filterTrafo = document.getElementById('table-trafo-filter')?.value || '';
            const startDateStr = document.getElementById('table-date-start')?.value;
            const endDateStr = document.getElementById('table-date-end')?.value;
            let veriler;

            if (filterTrafo) {
                veriler = [...VeriModulu.getTrafoVerileri(filterTrafo)];
            } else {
                veriler = [...VeriModulu.getTumVeriler()];
            }

            if (startDateStr) {
                veriler = veriler.filter(v => v && v.tarih && v.tarih.substring(0, 10) >= startDateStr);
            }
            if (endDateStr) {
                veriler = veriler.filter(v => v && v.tarih && v.tarih.substring(0, 10) <= endDateStr);
            }

            veriler.sort((a, b) => {
                const ta = (a && a.tarih) ? a.tarih : '';
                const tb = (b && b.tarih) ? b.tarih : '';
                return tb.localeCompare(ta);
            });

            const totalRows = veriler.length;
            const totalRecords = VeriModulu.getTumVeriler().length;
            const totalRowsEl = document.getElementById('table-total-rows');
            const totalRecordsEl = document.getElementById('table-total-records');
            if (totalRowsEl) totalRowsEl.textContent = totalRows;
            if (totalRecordsEl) totalRecordsEl.textContent = totalRecords;

            let totalPages = 1;
            if (state.tablePerPage !== 'all') {
                totalPages = Math.ceil(totalRows / state.tablePerPage) || 1;
                if (state.tablePage > totalPages) state.tablePage = totalPages;

                const startIndex = (state.tablePage - 1) * state.tablePerPage;
                const endIndex = startIndex + state.tablePerPage;
                veriler = veriler.slice(startIndex, endIndex);
            } else {
                state.tablePage = 1;
            }

            const pageInfoEl = document.getElementById('table-page-info');
            if (pageInfoEl) pageInfoEl.textContent = `${state.tablePage} / ${totalPages}`;

            const prevBtn = document.getElementById('table-prev-page');
            const nextBtn = document.getElementById('table-next-page');
            if (prevBtn) prevBtn.disabled = state.tablePage <= 1;
            if (nextBtn) nextBtn.disabled = state.tablePage >= totalPages;

            const tbody = document.getElementById('veri-table-body');
            if (!tbody) return;

            if (veriler.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted" style="padding: 25px 15px; font-size: 14px;">Gösterilecek kayıt bulunamadı.</td></tr>`;
                return;
            }

            tbody.innerHTML = veriler.map(v => {
                const oran = HesaplamaModulu.oranHesapla(v.kapasitifEnerji, v.aktifEnerji);
                const risk = HesaplamaModulu.riskSeviyesiBelirle(oran, 'kapasitif');
                const trafo = VeriModulu.getTrafo(v.trafoId);
                const rowClass = v.haftaSonu ? 'row-weekend' : (v.tatil ? 'row-tatil' : '');

                return `
                    <tr class="${rowClass}">
                        <td>${App.escapeHTML(v.tarih)}</td>
                        <td>${App.escapeHTML(trafo ? (trafo.adi.split(' – ').length > 1 ? trafo.adi.split(' – ')[0] + ' (' + trafo.adi.split(' – ')[1] + ')' : trafo.adi) : v.trafoId)}</td>
                        <td class="text-right">${HesaplamaModulu.formatEnerji(v.aktifEnerji)}</td>
                        <td class="text-right">${HesaplamaModulu.formatEnerji(v.enduktifEnerji)}</td>
                        <td class="text-right">${HesaplamaModulu.formatEnerji(v.kapasitifEnerji)}</td>
                        <td class="text-right" style="color:${risk.renk}; font-weight:600;">
                            %${HesaplamaModulu.formatSayi(oran)}
                        </td>
                        <td class="text-center">
                            <button class="btn btn-sm btn-ghost" onclick="App.silVeri('${App.escapeHTML(v.trafoId)}','${App.escapeHTML(v.tarih)}')">Sil</button>
                        </td>
                    </tr>
                `;
            }).join('');

        } catch (e) {
            console.error("renderVeriTablosu ERROR:", e);
            const totalRowsEl = document.getElementById('table-total-rows');
            if (totalRowsEl) totalRowsEl.innerHTML = `<span style="color:red;">Error: ${e.message}</span>`;

            const tbody = document.getElementById('veri-table-body');
            if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted" style="padding: 25px 15px; font-size: 14px; color: red;">Error rendering table: ${e.message}</td></tr>`;
        }
    }

    async function silVeri(trafoId, tarih) {
        try {
            await VeriModulu.veriSil(trafoId, tarih);
            if (typeof DashboardUI !== 'undefined') DashboardUI.clearCache();
            App.showToast('Veri veritabanından silindi.', 'info');
            renderVeriTablosu();
        } catch (err) {
            console.error("Veri silinirken hata oluştu:", err);
            App.showToast('Veri silinirken hata oluştu!', 'error');
        }
    }

    return {
        setupFormHandlers,
        handleCSVUpload,
        renderVeriGiris,
        renderVeriTablosu,
        silVeri
    };
})();
