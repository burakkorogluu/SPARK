import re

with open('js/ui/charts.js', 'r', encoding='utf-8') as f:
    js = f.read()

# Update createCumulativeLineChart
old_line = "function createCumulativeLineChart(canvasId, kumulatifData, tahminData, sinir) {"
new_line = "function createCumulativeLineChart(canvasId, inputData, tahminData, sinir, resolution = 'daily') {"
js = js.replace(old_line, new_line)

old_line_data = """        const mevcutDaily = toDailyChartData(kumulatifData);
        const mevcutLabels = mevcutDaily.map((d) => d.label);
        const mevcutValues = mevcutDaily.map((d) => d.kumulatifKapasitifOran);"""
new_line_data = """        const isHourly = resolution === 'hourly';
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
        }"""
js = js.replace(old_line_data, new_line_data)

old_line_tahmin = """            const sonMevcut = mevcutDaily[mevcutDaily.length - 1];
            const tDaily = toDailyChartData(
                tahminData,
                sonMevcut.aktifEnerji,
                sonMevcut.kapasitifEnerji,
                sonMevcut.enduktifEnerji,
                sonMevcut.tarih
            );
            
            const tLabels = tDaily.map((d) => d.label);
            const tValues = tDaily.map((d) => d.kumulatifKapasitifOran);"""
new_line_tahmin = """            let tLabels = [];
            let tValues = [];
            
            if (isHourly) {
                let totalAktif = 0;
                let totalKap = 0;
                if (inputData.length > 0) {
                    inputData.forEach(v => { totalAktif += v.aktifEnerji||0; totalKap += v.kapasitifEnerji||0; });
                }
                tahminData.forEach(v => {
                    totalAktif += v.aktifEnerji || 0;
                    totalKap += v.kapasitifEnerji || 0;
                    tValues.push(totalAktif > 0 ? (totalKap / totalAktif) * 100 : 0);
                    const day = v.tarih.split(' ')[0].split('-')[2];
                    const hour = v.tarih.split(' ')[1].substring(0, 5);
                    tLabels.push(`${day} ${hour}`);
                });
            } else {
                const sonMevcut = mevcutDaily[mevcutDaily.length - 1] || { aktifEnerji: 0, kapasitifEnerji: 0, enduktifEnerji: 0, tarih: null };
                const tDaily = toDailyChartData(
                    tahminData,
                    sonMevcut.aktifEnerji,
                    sonMevcut.kapasitifEnerji,
                    sonMevcut.enduktifEnerji,
                    sonMevcut.tarih
                );
                tLabels = tDaily.map((d) => d.label);
                tValues = tDaily.map((d) => d.kumulatifKapasitifOran);
            }"""
js = js.replace(old_line_tahmin, new_line_tahmin)

# Update createDailyBarChart
old_bar = "function createDailyBarChart(canvasId, kumulatifData, tahminData, sinir) {"
new_bar = "function createDailyBarChart(canvasId, inputData, tahminData, sinir, resolution = 'daily') {"
js = js.replace(old_bar, new_bar)

old_bar_data = """        const mevcutDaily = toDailyChartData(kumulatifData);
        const labels = mevcutDaily.map((d) => d.label);
        const values = mevcutDaily.map((d) => {
            if (d.aktifEnerji > 0) {
                return (d.kapasitifEnerji / d.aktifEnerji) * 100;
            }
            return 0;
        });"""
new_bar_data = """        const isHourly = resolution === 'hourly';
        let labels = [];
        let values = [];
        let mevcutDaily = [];
        
        if (isHourly) {
            inputData.forEach(v => {
                values.push(v.aktifEnerji > 0 ? (v.kapasitifEnerji / v.aktifEnerji) * 100 : 0);
                const day = v.tarih.split(' ')[0].split('-')[2];
                const hour = v.tarih.split(' ')[1].substring(0, 5);
                labels.push(`${day} ${hour}`);
            });
            mevcutDaily = inputData;
        } else {
            mevcutDaily = toDailyChartData(inputData);
            labels = mevcutDaily.map((d) => d.label);
            values = mevcutDaily.map((d) => {
                if (d.aktifEnerji > 0) return (d.kapasitifEnerji / d.aktifEnerji) * 100;
                return 0;
            });
        }"""
js = js.replace(old_bar_data, new_bar_data)

old_bar_tahmin = """            const sonMevcut = mevcutDaily[mevcutDaily.length - 1];
            const tDaily = toDailyChartData(
                tahminData,
                0, 0, 0, // Günlük bağımsız (ayrık) olduğu için initial değer vermiyoruz
                sonMevcut ? sonMevcut.tarih : null
            );
            const tLabels = tDaily.map((d) => d.label);
            const tValues = tDaily.map((d) => {
                if (d.aktifEnerji > 0) {
                    return (d.kapasitifEnerji / d.aktifEnerji) * 100;
                }
                return 0;
            });"""
new_bar_tahmin = """            let tLabels = [];
            let tValues = [];
            
            if (isHourly) {
                tahminData.forEach(v => {
                    tValues.push(v.aktifEnerji > 0 ? (v.kapasitifEnerji / v.aktifEnerji) * 100 : 0);
                    const day = v.tarih.split(' ')[0].split('-')[2];
                    const hour = v.tarih.split(' ')[1].substring(0, 5);
                    tLabels.push(`${day} ${hour}`);
                });
            } else {
                const sonMevcut = mevcutDaily[mevcutDaily.length - 1];
                const tDaily = toDailyChartData(
                    tahminData,
                    0, 0, 0, // Günlük bağımsız (ayrık) olduğu için initial değer vermiyoruz
                    sonMevcut ? sonMevcut.tarih : null
                );
                tLabels = tDaily.map((d) => d.label);
                tValues = tDaily.map((d) => {
                    if (d.aktifEnerji > 0) return (d.kapasitifEnerji / d.aktifEnerji) * 100;
                    return 0;
                });
            }"""
js = js.replace(old_bar_tahmin, new_bar_tahmin)

with open('js/ui/charts.js', 'w', encoding='utf-8') as f:
    f.write(js)

print("Updated charts.js for toggles")
