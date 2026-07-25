import re

with open('js/core/app.js', 'r', encoding='utf-8') as f:
    js = f.read()

# Add chartResolution to state
js = js.replace('dashboardView: \'charts\',', 'dashboardView: \'charts\',\n        chartResolution: \'daily\', // daily | hourly')

# In renderTrafoDetay, pass state.chartResolution and veriler
old_render_charts = """        if (!tahminSonucu.tamamlanmis && tahminSonucu.tahminVeriler.length > 0) {
            tahminBadge.style.display = '';
            if (barTahminBadge) barTahminBadge.style.display = '';
            GrafikModulu.createCumulativeLineChart(
                'chart-detay-line',
                ozet.kumulatifGunluk,
                tahminSonucu.tahminVeriler,
                HesaplamaModulu.SINIRLAR.kapasitif
            );
            GrafikModulu.createDailyBarChart(
                'chart-detay-bar',
                ozet.kumulatifGunluk,
                tahminSonucu.tahminVeriler,
                HesaplamaModulu.SINIRLAR.kapasitif
            );
        } else {
            tahminBadge.style.display = 'none';
            if (barTahminBadge) barTahminBadge.style.display = 'none';
            GrafikModulu.createCumulativeLineChart(
                'chart-detay-line',
                ozet.kumulatifGunluk,
                null,
                HesaplamaModulu.SINIRLAR.kapasitif
            );
            GrafikModulu.createDailyBarChart(
                'chart-detay-bar',
                ozet.kumulatifGunluk,
                null,
                HesaplamaModulu.SINIRLAR.kapasitif
            );
        }"""

new_render_charts = """        // Sync Toggle UI state
        document.querySelectorAll('.chart-res-toggle button').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.res === state.chartResolution);
        });
        const barTitle = document.getElementById('detay-bar-title');
        if (barTitle) {
            barTitle.textContent = state.chartResolution === 'hourly' ? 'Saatlik Kapasitif Oran Dağılımı (Ayrık)' : 'Günlük Kapasitif Oran Dağılımı (Ayrık)';
        }

        if (!tahminSonucu.tamamlanmis && tahminSonucu.tahminVeriler.length > 0) {
            tahminBadge.style.display = '';
            if (barTahminBadge) barTahminBadge.style.display = '';
            GrafikModulu.createCumulativeLineChart(
                'chart-detay-line',
                state.chartResolution === 'hourly' ? veriler : ozet.kumulatifGunluk,
                tahminSonucu.tahminVeriler,
                HesaplamaModulu.SINIRLAR.kapasitif,
                state.chartResolution
            );
            GrafikModulu.createDailyBarChart(
                'chart-detay-bar',
                state.chartResolution === 'hourly' ? veriler : ozet.kumulatifGunluk,
                tahminSonucu.tahminVeriler,
                HesaplamaModulu.SINIRLAR.kapasitif,
                state.chartResolution
            );
        } else {
            tahminBadge.style.display = 'none';
            if (barTahminBadge) barTahminBadge.style.display = 'none';
            GrafikModulu.createCumulativeLineChart(
                'chart-detay-line',
                state.chartResolution === 'hourly' ? veriler : ozet.kumulatifGunluk,
                null,
                HesaplamaModulu.SINIRLAR.kapasitif,
                state.chartResolution
            );
            GrafikModulu.createDailyBarChart(
                'chart-detay-bar',
                state.chartResolution === 'hourly' ? veriler : ozet.kumulatifGunluk,
                null,
                HesaplamaModulu.SINIRLAR.kapasitif,
                state.chartResolution
            );
        }"""
js = js.replace(old_render_charts, new_render_charts)

# Add event listeners for chart-res-toggle
event_listeners = """
    function bindEvents() {
        document.querySelectorAll('.chart-res-toggle button').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const res = e.target.dataset.res;
                state.chartResolution = res;
                renderTrafoDetay();
            });
        });"""
js = js.replace("    function bindEvents() {", event_listeners)

with open('js/core/app.js', 'w', encoding='utf-8') as f:
    f.write(js)

print("Updated app.js for toggles")
