// ============================================
// charts.js - Chart.js Grafik Konfigürasyonları
// Reaktif Güç Takip ve Analiz Sistemi
// ============================================

const GrafikModulu = (() => {
    'use strict';

    // ─── Chart.js Global Defaults ───
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.borderColor = 'rgba(148, 163, 184, 0.08)';
    Chart.defaults.font.family = "'Inter', sans-serif";
    Chart.defaults.font.size = 12;

    // Aktif grafik referansları (destroy etmek için)
    const _charts = {};

    // ─── Yardımcı: Var olan grafiği yok et ───
    function destroyChart(id) {
        if (_charts[id]) {
            _charts[id].destroy();
            delete _charts[id];
        }
    }

    // ─── Sınır çizgisi annotation oluşturucu ───
    function sinirAnnotation(value, label, axis = 'y') {
        const config = {
            type: 'line',
            borderColor: '#ef4444',
            borderWidth: 2,
            borderDash: [6, 4],
            label: {
                display: true,
                content: label,
                position: 'end',
                backgroundColor: 'rgba(229, 57, 53, 0.85)',
                color: '#fff',
                font: { size: 11, weight: '600' },
                padding: { x: 6, y: 3 },
                borderRadius: 4,
            },
        };

        if (axis === 'y') {
            config.yMin = value;
            config.yMax = value;
        } else {
            config.xMin = value;
            config.xMax = value;
        }

        return config;
    }

    // ═══════════════════════════════════════════
    // 1. Dashboard — Yatay Bar Chart
    //    Tüm trafoların kapasitif oranları
    // ═══════════════════════════════════════════
    function createDashboardBarChart(canvasId, trafoOzetleri) {
        destroyChart(canvasId);
        const ctx = document.getElementById(canvasId)?.getContext('2d');
        if (!ctx) return;

        // Özel Plugin: Chart.js bar grafiği borderDash desteklemediği için manuel Canvas çizimi
        // Ayrıca bu plugin ile dış çerçeveye parıldama (glow) efekti de ekliyoruz.
        const dashedBarPlugin = {
            id: 'dashedBarPlugin',
            afterDatasetDraw(chart, args) {
                const { ctx } = chart;
                const dataset = chart.data.datasets[args.index];
                
                if (dataset.customDashedBorder) {
                    const meta = chart.getDatasetMeta(args.index);
                    ctx.save();
                    meta.data.forEach((bar, index) => {
                        if (dataset.data[index] === null) return;
                        
                        const left = Math.min(bar.x, bar.base);
                        const right = Math.max(bar.x, bar.base);
                        const width = right - left;
                        const top = bar.y - (bar.height / 2);
                        
                        ctx.beginPath();
                        ctx.setLineDash(dataset.customDashedBorder);
                        ctx.lineWidth = dataset.customBorderWidth || 2;
                        
                        const strokeColor = Array.isArray(dataset.borderColor) ? dataset.borderColor[index] : dataset.borderColor;
                        ctx.strokeStyle = strokeColor;
                        
                        // Hafif dış parlama (neon glow) efekti
                        ctx.shadowColor = strokeColor;
                        ctx.shadowBlur = 8;
                        ctx.shadowOffsetX = 0;
                        ctx.shadowOffsetY = 0;
                        
                        if (typeof ctx.roundRect === 'function') {
                            ctx.roundRect(left, top, width, bar.height, [0, 8, 8, 0]);
                        } else {
                            ctx.rect(left, top, width, bar.height);
                        }
                        ctx.stroke();
                        
                        // Gölgeyi sıfırla ki diğer çizimlere etki etmesin
                        ctx.shadowBlur = 0;
                        
                        // Şeffaf bir dolgu (sadece tahmin barının uç kısmı için hoş bir görünüm verebilir)
                        ctx.fillStyle = chart.canvas.ownerDocument.body.getAttribute('data-theme') === 'light' 
                            ? strokeColor + '0A' // %4 opaklık
                            : strokeColor + '14'; // %8 opaklık
                        ctx.fill();
                    });
                    ctx.restore();
                }
            }
        };

        const labels = trafoOzetleri.map((d) => {
            const parts = d.trafo.adi.split(' – ');
            return parts.length > 1 ? `${parts[0]} (${parts[1]})` : d.trafo.adi;
        });
        const values = trafoOzetleri.map(
            (d) => d.ozet?.kapasitifOran || 0
        );
        const tahminValues = trafoOzetleri.map(
            (d) => d.tahminOzet?.kapasitifOran !== undefined ? d.tahminOzet.kapasitifOran : null
        );
        const hasTahmin = tahminValues.some(v => v !== null);

        const isLight = document.body.getAttribute('data-theme') === 'light';
        const colors = values.map((v) => {
            const risk = HesaplamaModulu.riskSeviyesiBelirle(v, 'kapasitif');
            return risk.renk;
        });

        // Gradient oluşturucu
        const createGradient = (context, colorStr) => {
            const chart = context.chart;
            const {ctx, chartArea} = chart;
            if (!chartArea) return colorStr + (isLight ? 'E6' : '30'); // fallback
            
            const gradient = ctx.createLinearGradient(chartArea.left, 0, chartArea.right, 0);
            if (colorStr.startsWith('#')) {
                gradient.addColorStop(0, colorStr + (isLight ? '20' : '10')); 
                gradient.addColorStop(1, colorStr + (isLight ? 'E6' : 'CC')); 
            } else {
                gradient.addColorStop(0, colorStr);
                gradient.addColorStop(1, colorStr);
            }
            return gradient;
        };

        const datasets = [
            {
                label: 'Mevcut Oran (%)',
                data: values,
                backgroundColor: (context) => {
                    const color = colors[context.dataIndex] || '#1E88E5';
                    return createGradient(context, color);
                },
                borderColor: colors.map(c => c + (isLight ? 'FF' : 'AA')),
                borderWidth: 1,
                borderRadius: 6,
                barThickness: hasTahmin ? 16 : 28,
                grouped: false, // Barların aynı hizada üst üste binmesi için
                // Bar ucuna ufak bir parlama vermek için ekstra ayarlar eklenebilir
            }
        ];

        if (hasTahmin) {
            const tColors = tahminValues.map(v => {
                if (v === null) return '#8b5cf6';
                return HesaplamaModulu.riskSeviyesiBelirle(v, 'kapasitif').renk;
            });
            datasets.push({
                label: 'Ay Sonu Tahmini (%)',
                data: tahminValues,
                backgroundColor: 'transparent', // Custom plugin hallediyor
                borderColor: tColors,
                borderWidth: 0, 
                customBorderWidth: 2, 
                customDashedBorder: [6, 4], 
                borderRadius: 8,
                barThickness: 28, // Mevcut orandan daha kalın, onu içine alacak şekilde
                grouped: false, // Üst üste binmesi için
            });
        }

        // Z-Index düzenlemesi (Tahmin barı altta kalıp taşsın ki görsel bütünlük olsun)
        // Chart.js'de dataset dizisindeki sıra çizim sırasıdır. 
        // Ancak biz grouped: false kullandık. Mevcut barın (16px) tam olarak tahmin barının (28px) 
        // üstünde çizilmesi için Mevcut barın en son (üstte) çizilmesi daha iyi olur.
        // O yüzden datasets sırasını tersine çeviriyoruz, fakat legend sırasını korumak için 
        // legend oluşturulurken ayar yapacağız.
        const sortedDatasets = hasTahmin ? [datasets[1], datasets[0]] : datasets;

        _charts[canvasId] = new Chart(ctx, {
            type: 'bar',
            plugins: [dashedBarPlugin],
            data: {
                labels,
                datasets: sortedDatasets,
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'y', // Aynı kategoridekileri birlikte göster
                    intersect: false
                },
                plugins: {
                    legend: {
                        display: hasTahmin,
                        position: 'top',
                        labels: {
                            color: isLight ? '#1e293b' : '#cbd5e1',
                            font: { size: 12, weight: '600', family: 'Inter' },
                            padding: 16,
                            generateLabels: (chart) => {
                                const isLt = document.body.getAttribute('data-theme') === 'light';
                                // Legend'ı orijinal düzende göstermek için datasetleri kendi sıramıza göre filtreliyoruz
                                const datasetMevcut = chart.data.datasets.find(ds => ds.label.includes('Mevcut'));
                                const datasetTahmin = chart.data.datasets.find(ds => ds.label.includes('Tahmin'));
                                
                                const labels = [];
                                if (datasetMevcut) {
                                    labels.push({
                                        text: datasetMevcut.label,
                                        fillStyle: isLt ? '#94a3b840' : '#47556940',
                                        strokeStyle: isLt ? '#64748b' : '#94a3b8',
                                        lineWidth: 1,
                                        hidden: !chart.isDatasetVisible(chart.data.datasets.indexOf(datasetMevcut)),
                                        datasetIndex: chart.data.datasets.indexOf(datasetMevcut),
                                        fontColor: isLt ? '#1e293b' : '#cbd5e1'
                                    });
                                }
                                if (datasetTahmin) {
                                    labels.push({
                                        text: datasetTahmin.label,
                                        fillStyle: 'transparent',
                                        strokeStyle: isLt ? '#64748b' : '#94a3b8',
                                        lineWidth: 2,
                                        lineDash: [6, 4],
                                        hidden: !chart.isDatasetVisible(chart.data.datasets.indexOf(datasetTahmin)),
                                        datasetIndex: chart.data.datasets.indexOf(datasetTahmin),
                                        fontColor: isLt ? '#1e293b' : '#cbd5e1'
                                    });
                                }
                                return labels;
                            }
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(15, 23, 42, 0.95)',
                        borderColor: 'rgba(148, 163, 184, 0.2)',
                        borderWidth: 1,
                        cornerRadius: 8,
                        padding: 12,
                        callbacks: {
                            label: (item) => {
                                const dsLabel = item.dataset.label || '';
                                return `${dsLabel}: %${item.parsed.x.toFixed(2)}`;
                            },
                        },
                    },
                    annotation: {
                        annotations: {
                            limitLine: sinirAnnotation(15, '%15 Sınır', 'x'),
                        },
                    },
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        max: 22,
                        grid: { color: 'rgba(148, 163, 184, 0.06)' },
                        ticks: { callback: (v) => `%${v}` },
                    },
                    y: {
                        grid: { display: false },
                    },
                },
            },
        });
    }

    // ═══════════════════════════════════════════
    // 2. Dashboard — Enerji Dağılım Doughnut
    // ═══════════════════════════════════════════
    function createEnergyDoughnut(canvasId, aktif, enduktif, kapasitif) {
        destroyChart(canvasId);
        const ctx = document.getElementById(canvasId)?.getContext('2d');
        if (!ctx) return;

        const isLight = document.body.getAttribute('data-theme') === 'light';
        const sliceBorder = isLight ? '#ffffff' : '#111827';
        const sliceColors = isLight
            ? ['rgba(30, 136, 229, 0.85)', 'rgba(142, 36, 170, 0.85)', 'rgba(67, 160, 71, 0.85)']
            : ['rgba(30, 136, 229, 0.65)', 'rgba(142, 36, 170, 0.65)', 'rgba(67, 160, 71, 0.65)'];

        _charts[canvasId] = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Aktif (kWh)', 'Endüktif (kVArh)', 'Kapasitif (kVArh)'],
                datasets: [
                    {
                        data: [aktif, enduktif, kapasitif],
                        backgroundColor: sliceColors,
                        borderColor: sliceBorder,
                        borderWidth: 3,
                        hoverOffset: 6,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            padding: 16,
                            usePointStyle: true,
                            pointStyleWidth: 10,
                            font: { size: 12 },
                        },
                    },
                    tooltip: {
                        backgroundColor: 'rgba(15, 23, 42, 0.95)',
                        borderColor: 'rgba(148, 163, 184, 0.2)',
                        borderWidth: 1,
                        cornerRadius: 8,
                        padding: 12,
                        callbacks: {
                            label: (item) => {
                                const val = item.parsed;
                                const total = item.dataset.data.reduce((a, b) => a + b, 0);
                                const pct = ((val / total) * 100).toFixed(1);
                                return `${item.label}: ${val.toLocaleString('tr-TR')} (${pct}%)`;
                            },
                        },
                    },
                },
                cutout: '62%',
            },
        });
    }

    // ─── Yardımcı Fonksiyon: Günlük Grafik Verilerine Dönüştürme ───
    function toDailyChartData(veriler, initialAktif = 0, initialKap = 0, initialEnd = 0, skipFirstDateStr = null) {
        if (!veriler || !veriler.length) return [];
        const dayMap = new Map();

        veriler.forEach((v) => {
            const dateStr = v.tarih.split(' ')[0]; // "YYYY-MM-DD"
            if (!dayMap.has(dateStr)) {
                dayMap.set(dateStr, {
                    ...v,
                    tarih: dateStr,
                    label: dateStr.split('-')[2], // "01", "02", ... "31"
                    aktifEnerji: 0,
                    enduktifEnerji: 0,
                    kapasitifEnerji: 0,
                });
            }
            const d = dayMap.get(dateStr);
            d.aktifEnerji += (v.aktifEnerji || 0);
            d.enduktifEnerji += (v.enduktifEnerji || 0);
            d.kapasitifEnerji += (v.kapasitifEnerji || 0);
        });

        let tmpAktif = initialAktif;
        let tmpKap = initialKap;
        let tmpEnd = initialEnd;

        const results = [];
        for (const d of dayMap.values()) {
            if (skipFirstDateStr && d.tarih === skipFirstDateStr) {
                // Sadece mevcut kümülatife enerji ekle ama yeni etiket oluşturma
                tmpAktif += d.aktifEnerji;
                tmpKap += d.kapasitifEnerji;
                tmpEnd += d.enduktifEnerji;
                continue;
            }
            tmpAktif += d.aktifEnerji;
            tmpKap += d.kapasitifEnerji;
            tmpEnd += d.enduktifEnerji;

            const gunlukKapOran = d.aktifEnerji > 0 ? (d.kapasitifEnerji / d.aktifEnerji) * 100 : 0;
            const gunlukEndOran = d.aktifEnerji > 0 ? (d.enduktifEnerji / d.aktifEnerji) * 100 : 0;
            const kumKapOran = tmpAktif > 0 ? (tmpKap / tmpAktif) * 100 : 0;
            const kumEndOran = tmpAktif > 0 ? (tmpEnd / tmpAktif) * 100 : 0;

            results.push({
                ...d,
                kumulatifAktif: tmpAktif,
                kumulatifEnduktif: tmpEnd,
                kumulatifKapasitif: tmpKap,
                gunlukKapasitifOran: gunlukKapOran,
                gunlukEnduktifOran: gunlukEndOran,
                kumulatifKapasitifOran: kumKapOran,
                kumulatifEnduktifOran: kumEndOran,
            });
        }
        return results;
    }

    // ═══════════════════════════════════════════
    // 3. Trafo Detay / Tahmin — Kümülatif & Günlük Oran Çizgi Grafik
    // ═══════════════════════════════════════════
    function createCumulativeLineChart(canvasId, inputData, tahminData, sinir, resolution = 'daily') {
        destroyChart(canvasId);
        const ctx = document.getElementById(canvasId)?.getContext('2d');
        if (!ctx) return;

        const isHourly = resolution === 'hourly';
        let mevcutLabels = [];
        let mevcutValues = [];
        let mevcutDaily = [];
        
        if (isHourly) {
            // inputData is raw hourly 'veriler'
            let totalAktif = 0;
            let totalKap = 0;
            inputData.forEach(v => {
                totalAktif += v.aktifEnerji || 0;
                totalKap += v.kapasitifEnerji || 0;
                mevcutValues.push(totalAktif > 0 ? (totalKap / totalAktif) * 100 : 0);
                const day = v.tarih.split(' ')[0].split('-')[2];
                const hour = v.tarih.split(' ')[1].substring(0, 5);
                mevcutLabels.push(`${day} ${hour}`);
            });
            mevcutDaily = inputData; // Just to get length for loop below
        } else {
            mevcutDaily = toDailyChartData(inputData);
            mevcutLabels = mevcutDaily.map((d) => d.label);
            mevcutValues = mevcutDaily.map((d) => d.kumulatifKapasitifOran);
        }

        const datasets = [
            {
                label: 'Kümülatif Kapasitif Oran (%)',
                data: mevcutValues,
                borderColor: '#1E88E5',
                backgroundColor: 'rgba(30, 136, 229, 0.1)',
                fill: true,
                tension: 0.35,
                pointRadius: 3,
                pointHoverRadius: 6,
                pointBackgroundColor: '#1E88E5',
                pointBorderColor: '#1e293b',
                pointBorderWidth: 2,
                borderWidth: 2.5,
            },
        ];

        let allLabels = [...mevcutLabels];
        let allValuesForScale = [...mevcutValues];

        if (tahminData && tahminData.length > 0) {
            const sonMevcut = mevcutDaily[mevcutDaily.length - 1];
            const tahminDaily = toDailyChartData(
                tahminData,
                sonMevcut ? sonMevcut.kumulatifAktif : 0,
                sonMevcut ? sonMevcut.kumulatifKapasitif : 0,
                sonMevcut ? sonMevcut.kumulatifEnduktif : 0,
                sonMevcut ? sonMevcut.tarih : null
            );

            const tahminLabels = tahminDaily.map((d) => d.label);
            const tahminKumValues = tahminDaily.map((d) => d.kumulatifKapasitifOran);

            // Köprü: son gerçek noktadan tahmin başlangıcına bağlantı
            const bridgeKumData = new Array(mevcutValues.length - 1).fill(null);
            bridgeKumData.push(mevcutValues[mevcutValues.length - 1]);
            bridgeKumData.push(...tahminKumValues);

            allLabels = [...mevcutLabels, ...tahminLabels];
            allValuesForScale.push(...tahminKumValues);

            datasets.push({
                label: 'Tahmin Edilen Kümülatif (%)',
                data: bridgeKumData,
                borderColor: '#FB8C00',
                backgroundColor: 'rgba(251, 140, 0, 0.1)',
                fill: true,
                borderDash: [6, 4],
                tension: 0.35,
                pointRadius: 4,
                pointHoverRadius: 7,
                pointBackgroundColor: '#FB8C00',
                pointBorderColor: '#1e293b',
                pointBorderWidth: 2,
                borderWidth: 2.8,
            });
        }

        const validValues = allValuesForScale.filter(v => typeof v === 'number' && !isNaN(v));
        const minV = validValues.length ? Math.min(...validValues) : 0;
        const maxV = validValues.length ? Math.max(...validValues) : 20;
        const pad = Math.max(0.4, (maxV - minV) * 0.15);

        _charts[canvasId] = new Chart(ctx, {
            type: 'line',
            data: { labels: allLabels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { position: 'top' },
                    tooltip: {
                        backgroundColor: 'rgba(15, 23, 42, 0.95)',
                        borderColor: 'rgba(148, 163, 184, 0.2)',
                        borderWidth: 1,
                        cornerRadius: 8,
                        padding: 12,
                        callbacks: {
                            title: (items) => {
                                if (!items.length) return '';
                                const lbl = items[0].label;
                                if (lbl.includes(' ')) {
                                    const [day, hour] = lbl.split(' ');
                                    return `${day}. Gün, ${hour} (Kümülatif Oran Değişimi)`;
                                }
                                return `${lbl}. Gün (Kümülatif Oran Değişimi)`;
                            },
                            label: (item) =>
                                item.parsed.y !== null
                                    ? `${item.dataset.label}: %${item.parsed.y.toFixed(2)}`
                                    : '',
                        },
                    },
                    annotation: {
                        annotations: {
                            limitLine: sinirAnnotation(sinir, `%${sinir} Sınır`),
                        },
                    },
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(148, 163, 184, 0.06)' },
                        title: {
                            display: true,
                            text: 'Gün',
                            color: '#94a3b8',
                            font: { weight: '600' },
                        },
                    },
                    y: {
                        grid: { color: 'rgba(148, 163, 184, 0.06)' },
                        suggestedMin: Math.max(0, Math.floor((minV - pad) * 10) / 10),
                        suggestedMax: Math.max(Math.ceil((maxV + pad) * 10) / 10, sinir + 2),
                        title: {
                            display: true,
                            text: 'Kapasitif Oran (%)',
                            color: '#94a3b8',
                            font: { weight: '600' },
                        },
                        ticks: { callback: (v) => `%${v}` },
                    },
                },
            },
        });
    }

    // ═══════════════════════════════════════════
    // 3.1. Günlük Ayrık Kapasitif Oran — Sütun (Bar) Chart
    // ═══════════════════════════════════════════
    function createDailyBarChart(canvasId, inputData, tahminData, sinir, resolution = 'daily') {
        destroyChart(canvasId);
        const ctx = document.getElementById(canvasId)?.getContext('2d');
        if (!ctx) return;

        const isHourly = resolution === 'hourly';
        let allLabels = [];
        let allValuesForScale = [];
        let mevcutValues = [];
        let tahminValues = [];
        
        let mevcutDaily = [];
        
        if (isHourly) {
            inputData.forEach(v => {
                const val = v.aktifEnerji > 0 ? (v.kapasitifEnerji / v.aktifEnerji) * 100 : 0;
                mevcutValues.push(val);
                const day = v.tarih.split(' ')[0].split('-')[2];
                const hour = v.tarih.split(' ')[1].substring(0, 5);
                allLabels.push(`${day} ${hour}`);
            });
            mevcutDaily = inputData;
        } else {
            mevcutDaily = toDailyChartData(inputData);
            allLabels = mevcutDaily.map((d) => d.label);
            mevcutValues = mevcutDaily.map((d) => d.gunlukKapasitifOran || (d.aktifEnerji > 0 ? (d.kapasitifEnerji / d.aktifEnerji) * 100 : 0));
        }

        allValuesForScale = [...mevcutValues];
        const isLight = document.body.getAttribute('data-theme') === 'light';
        const colors = mevcutValues.map((v) => typeof v === 'number' && !isNaN(v) ? HesaplamaModulu.riskSeviyesiBelirle(v, 'kapasitif').renk : '#000');
        const bgColors = colors.map((c) => isLight ? (c + 'E6') : (c + '80'));
        const datasets = [];

        if (tahminData && tahminData.length > 0) {
            let tLabels = [];
            if (isHourly) {
                tahminData.forEach(v => {
                    tahminValues.push(v.aktifEnerji > 0 ? (v.kapasitifEnerji / v.aktifEnerji) * 100 : 0);
                    const day = v.tarih.split(' ')[0].split('-')[2];
                    const hour = v.tarih.split(' ')[1].substring(0, 5);
                    tLabels.push(`${day} ${hour}`);
                });
            } else {
                const sonMevcut = mevcutDaily[mevcutDaily.length - 1];
                const tahminDaily = toDailyChartData(
                    tahminData,
                    0, 0, 0,
                    sonMevcut ? sonMevcut.tarih : null
                );
                tLabels = tahminDaily.map((d) => d.label);
                tahminValues = tahminDaily.map((d) => d.gunlukKapasitifOran || (d.aktifEnerji > 0 ? (d.kapasitifEnerji / d.aktifEnerji) * 100 : 0));
            }

            allLabels = [...allLabels, ...tLabels];
            allValuesForScale.push(...tahminValues);

            const dataset1Data = [...mevcutValues, ...new Array(tahminValues.length).fill(null)];
            const dataset1Colors = [...colors, ...new Array(tahminValues.length).fill('transparent')];
            const dataset1BgColors = [...bgColors, ...new Array(tahminValues.length).fill('transparent')];
            const dataset2Data = [...new Array(mevcutValues.length).fill(null), ...tahminValues];

            datasets.push({
                label: isHourly ? 'Gerçekleşen Saatlik Oran (%)' : 'Gerçekleşen Günlük Oran (%)',
                data: dataset1Data,
                backgroundColor: dataset1BgColors,
                borderColor: dataset1Colors,
                borderWidth: 2,
                borderRadius: 6,
                barThickness: 'flex',
                maxBarThickness: 32,
            });

            datasets.push({
                label: isHourly ? 'Tahmin Edilen Saatlik Oran (%)' : 'Tahmin Edilen Günlük Oran (%)',
                data: dataset2Data,
                backgroundColor: isLight ? 'rgba(251, 140, 0, 0.85)' : 'rgba(251, 140, 0, 0.25)',
                borderColor: '#FB8C00',
                borderWidth: 2,
                borderRadius: 6,
                barThickness: 'flex',
                maxBarThickness: 32,
            });
        } else {
            datasets.push({
                label: isHourly ? 'Gerçekleşen Saatlik Oran (%)' : 'Gerçekleşen Günlük Oran (%)',
                data: mevcutValues,
                backgroundColor: bgColors,
                borderColor: colors,
                borderWidth: 2,
                borderRadius: 6,
                barThickness: 'flex',
                maxBarThickness: 32,
            });
        }

        const validValues = allValuesForScale.filter(v => typeof v === 'number' && !isNaN(v));
        const minV = validValues.length ? Math.min(...validValues) : 0;
        const maxV = validValues.length ? Math.max(...validValues) : 20;
        const pad = Math.max(1, (maxV - minV) * 0.15);

        _charts[canvasId] = new Chart(ctx, {
            type: 'bar',
            data: { labels: allLabels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { position: 'top' },
                    tooltip: {
                        backgroundColor: 'rgba(15, 23, 42, 0.95)',
                        borderColor: 'rgba(148, 163, 184, 0.2)',
                        borderWidth: 1,
                        cornerRadius: 8,
                        padding: 12,
                        callbacks: {
                            title: (items) => {
                                if (!items.length) return '';
                                const lbl = items[0].label;
                                if (lbl.includes(' ')) {
                                    const [day, hour] = lbl.split(' ');
                                    return `${day}. Gün, ${hour} (Ayrık Oran)`;
                                }
                                return `${lbl}. Gün (Günlük Ayrık Oran)`;
                            },
                            label: (item) => {
                                if (item.parsed.y === null || isNaN(item.parsed.y)) return '';
                                const valStr = `%${item.parsed.y.toFixed(2)}`;
                                const risk = HesaplamaModulu.riskSeviyesiBelirle(item.parsed.y, 'kapasitif');
                                return `${item.dataset.label}: ${valStr} (${risk.etiket})`;
                            },
                        },
                    },
                    annotation: {
                        annotations: {
                            limitLine: sinirAnnotation(sinir, `%${sinir} Sınır`),
                        },
                    },
                },
                scales: {
                    x: {
                        stacked: true,
                        grid: { color: 'rgba(148, 163, 184, 0.06)' },
                        title: {
                            display: true,
                            text: 'Gün',
                            color: '#94a3b8',
                            font: { weight: '600' },
                        },
                    },
                    y: {
                        stacked: true,
                        beginAtZero: true,
                        grid: { color: 'rgba(148, 163, 184, 0.06)' },
                        suggestedMax: Math.max(Math.ceil((maxV + pad) * 10) / 10, sinir + 3),
                        title: {
                            display: true,
                            text: 'Günlük Kapasitif Oran (%)',
                            color: '#94a3b8',
                            font: { weight: '600' },
                        },
                        ticks: { callback: (v) => `%${v}` },
                    },
                },
            },
        });
    }

    // ═══════════════════════════════════════════
    // 4. Senaryo — Karşılaştırmalı Çizgi Grafik
    // ═══════════════════════════════════════════
    function createScenarioChart(canvasId, orijinalVeriler, senaryoluVeriler, sinir) {
        destroyChart(canvasId);
        const ctx = document.getElementById(canvasId)?.getContext('2d');
        if (!ctx) return;

        const origDaily = toDailyChartData(orijinalVeriler);
        const senDaily = toDailyChartData(senaryoluVeriler);

        const labels = origDaily.map((d) => d.label);
        const origValues = origDaily.map((d) => d.kumulatifKapasitifOran);
        const senValues = senDaily.map((d) => d.kumulatifKapasitifOran);

        const allV = [...origValues, ...senValues].filter(v => typeof v === 'number' && !isNaN(v));
        const minVal = allV.length ? Math.min(...allV) : 0;
        const maxVal = allV.length ? Math.max(...allV) : 20;
        const pad = Math.max(0.5, (maxVal - minVal) * 0.15);

        _charts[canvasId] = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Müdahalesiz Orijinal (%)',
                        data: origValues,
                        borderColor: '#ef4444',
                        backgroundColor: 'rgba(239, 68, 68, 0.08)',
                        fill: true,
                        tension: 0.35,
                        borderWidth: 2.5,
                        pointRadius: 2.5,
                    },
                    {
                        label: 'Müdahale Sonrası İyileşmiş (%)',
                        data: senValues,
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16, 185, 129, 0.12)',
                        fill: true,
                        tension: 0.35,
                        borderWidth: 3,
                        pointRadius: 3,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { position: 'top' },
                    tooltip: {
                        backgroundColor: 'rgba(15, 23, 42, 0.95)',
                        borderColor: 'rgba(148, 163, 184, 0.2)',
                        borderWidth: 1,
                        cornerRadius: 8,
                        padding: 12,
                        callbacks: {
                            title: (items) => {
                                if (!items.length) return '';
                                return `${items[0].label}. Gün (Senaryo Karşılaştırması)`;
                            },
                            label: (item) =>
                                `${item.dataset.label}: %${item.parsed.y.toFixed(2)}`,
                        },
                    },
                    annotation: {
                        annotations: {
                            limitLine: sinirAnnotation(sinir, `%${sinir} Sınır`),
                        },
                    },
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(148, 163, 184, 0.06)' },
                        title: { display: true, text: 'Gün', color: '#94a3b8' },
                    },
                    y: {
                        grid: { color: 'rgba(148, 163, 184, 0.06)' },
                        suggestedMin: Math.max(0, Math.floor((minVal - pad) * 10) / 10),
                        suggestedMax: Math.max(Math.ceil((maxVal + pad) * 10) / 10, sinir + 2),
                        ticks: { callback: (v) => `%${v}` },
                    },
                },
            },
        });
    }

    function updateTheme(isLight) {
        const textColor = isLight ? '#334155' : '#94a3b8';
        const gridColor = isLight ? 'rgba(15, 23, 42, 0.08)' : 'rgba(148, 163, 184, 0.08)';
        const tooltipBg = isLight ? 'rgba(255, 255, 255, 0.95)' : 'rgba(15, 23, 42, 0.95)';
        const tooltipBorder = isLight ? 'rgba(15, 23, 42, 0.15)' : 'rgba(148, 163, 184, 0.2)';
        const tooltipText = isLight ? '#0f172a' : '#fff';

        Chart.defaults.color = textColor;
        Chart.defaults.borderColor = gridColor;

        Object.values(_charts).forEach((chart) => {
            if (!chart || !chart.options) return;
            if (chart.options.scales) {
                Object.values(chart.options.scales).forEach((scale) => {
                    if (scale.ticks) scale.ticks.color = textColor;
                    if (scale.grid) scale.grid.color = gridColor;
                    if (scale.title) scale.title.color = textColor;
                });
            }
            if (chart.options.plugins && chart.options.plugins.tooltip) {
                chart.options.plugins.tooltip.backgroundColor = tooltipBg;
                chart.options.plugins.tooltip.borderColor = tooltipBorder;
                chart.options.plugins.tooltip.titleColor = tooltipText;
                chart.options.plugins.tooltip.bodyColor = tooltipText;
            }
            if (chart.options.plugins && chart.options.plugins.legend && chart.options.plugins.legend.labels) {
                chart.options.plugins.legend.labels.color = textColor;
            }

            if (chart.config.type === 'doughnut' && chart.data.datasets && chart.data.datasets[0]) {
                chart.data.datasets[0].borderColor = isLight ? '#ffffff' : '#111827';
                chart.data.datasets[0].backgroundColor = isLight
                    ? ['rgba(30, 136, 229, 0.85)', 'rgba(142, 36, 170, 0.85)', 'rgba(67, 160, 71, 0.85)']
                    : ['rgba(30, 136, 229, 0.65)', 'rgba(142, 36, 170, 0.65)', 'rgba(67, 160, 71, 0.65)'];
            } else if (chart.config.type === 'bar' && chart.data.datasets && chart.data.datasets[0]) {
                if (chart.canvas.id === 'chart-dashboard-bar' && Array.isArray(chart.data.datasets[0].borderColor)) {
                    chart.data.datasets[0].backgroundColor = chart.data.datasets[0].borderColor.map(c => isLight ? (c + 'E6') : (c + '30'));
                } else if (Array.isArray(chart.data.datasets[0].borderColor)) {
                    chart.data.datasets[0].backgroundColor = chart.data.datasets[0].borderColor.map(c => isLight ? (c + 'E6') : (c + '80'));
                }
            }

            chart.update('none');
        });
    }

    // ─── Public API ───
    return {
        createDashboardBarChart,
        createEnergyDoughnut,
        createCumulativeLineChart,
        createDailyBarChart,
        createScenarioChart,
        destroyChart,
        updateTheme,
    };
})();
