import re

with open('index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Add to Line Chart Header
old_line_header = """                <div class="card-header">
                    <h3>Kümülatif Kapasitif Oran Değişimi</h3>
                    <span class="badge badge-tahmin" id="detay-tahmin-badge" style="display:none">Tahmin Dahil</span>
                </div>"""
new_line_header = """                <div class="card-header" style="justify-content: space-between;">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <h3>Kümülatif Kapasitif Oran Değişimi</h3>
                        <span class="badge badge-tahmin" id="detay-tahmin-badge" style="display:none">Tahmin Dahil</span>
                    </div>
                    <div class="btn-group chart-res-toggle">
                        <button class="btn btn-sm active" data-res="daily">Günlük</button>
                        <button class="btn btn-sm" data-res="hourly">Saatlik</button>
                    </div>
                </div>"""
html = html.replace(old_line_header, new_line_header)

# Add to Bar Chart Header
old_bar_header = """                <div class="card-header">
                    <h3>Günlük Kapasitif Oran Dağılımı (Ayrık)</h3>
                    <span class="badge badge-tahmin" id="detay-bar-tahmin-badge" style="display:none">Tahmin Dahil</span>
                </div>"""
new_bar_header = """                <div class="card-header" style="justify-content: space-between;">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <h3 id="detay-bar-title">Günlük Kapasitif Oran Dağılımı (Ayrık)</h3>
                        <span class="badge badge-tahmin" id="detay-bar-tahmin-badge" style="display:none">Tahmin Dahil</span>
                    </div>
                    <div class="btn-group chart-res-toggle">
                        <button class="btn btn-sm active" data-res="daily">Günlük</button>
                        <button class="btn btn-sm" data-res="hourly">Saatlik</button>
                    </div>
                </div>"""
html = html.replace(old_bar_header, new_bar_header)

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(html)

print("Added toggles to index.html")
