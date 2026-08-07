/**
 * SPARK Sistem Alarmları ve Bildirim Modülü (alerts.js)
 */
const AlertManager = (() => {
    'use strict';

    let dropdownListenerAdded = false;
    let allAlerts = [];
    let currentFilter = 'all';
    let readAlerts = new Set(JSON.parse(localStorage.getItem('spark_read_alerts') || '[]'));

    async function loadAlerts(year = null, month = null) {
        try {
            // Eski bildirimleri geri getirmek için 50'ye çıkarıldı
            allAlerts = await ApiClient.fetchAlerts(50, year, month);
            // Backend'den id gelmiyorsa tutarlı bir hash üretelim
            allAlerts.forEach(a => {
                a.id = a.id || btoa(unescape(encodeURIComponent(a.timestamp + a.message))).substring(0, 25);
            });
            renderAlertBanner();
            setupDropdown();
        } catch (err) {
            console.error("Alarmlar çekilirken hata:", err);
        }
    }

    function saveReadState() {
        localStorage.setItem('spark_read_alerts', JSON.stringify([...readAlerts]));
    }

    function setupDropdown() {
        if (dropdownListenerAdded) return;
        
        const btn = document.getElementById('btn-notifications');
        const dropdown = document.getElementById('notification-dropdown');
        if (btn && dropdown) {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                // Daha güvenilir bir görünürlük kontrolü
                const isCurrentlyVisible = dropdown.style.display === 'flex' || dropdown.style.display === 'block';
                dropdown.style.display = isCurrentlyVisible ? 'none' : 'flex';
            });

            document.addEventListener('click', (e) => {
                if (!btn.contains(e.target) && !dropdown.contains(e.target)) {
                    dropdown.style.display = 'none';
                }
            });
            
            // Filtre Butonları
            const filterBtns = document.querySelectorAll('.notification-filter');
            filterBtns.forEach(fbtn => {
                fbtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    filterBtns.forEach(b => b.classList.remove('active'));
                    fbtn.classList.add('active');
                    currentFilter = fbtn.dataset.filter;
                    renderAlertBanner();
                });
            });

            // Tümünü Okundu İşaretle Butonu
            const markAllBtn = document.getElementById('btn-mark-all-read');
            if (markAllBtn) {
                markAllBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    allAlerts.forEach(a => readAlerts.add(a.id));
                    saveReadState();
                    renderAlertBanner();
                });
            }

            // Tekil Bildirim Okundu İşaretleme
            const container = document.getElementById('system-alerts-container');
            if (container) {
                container.addEventListener('click', (e) => {
                    const markBtn = e.target.closest('.btn-mark-read');
                    if (markBtn) {
                        e.stopPropagation();
                        const alertId = markBtn.dataset.id;
                        if (alertId) {
                            readAlerts.add(alertId);
                            saveReadState();
                            renderAlertBanner();
                        }
                    }
                });
            }

            dropdownListenerAdded = true;
        }
    }

    function renderAlertBanner() {
        const container = document.getElementById('system-alerts-container');
        const badge = document.getElementById('notification-badge');
        
        let displayAlerts = allAlerts;
        if (currentFilter !== 'all') {
            displayAlerts = allAlerts.filter(a => a.severity === currentFilter);
        }

        const unreadCount = allAlerts.filter(a => !readAlerts.has(a.id)).length;

        if (badge) {
            if (unreadCount > 0) {
                badge.textContent = unreadCount;
                badge.style.display = 'flex';
            } else {
                badge.style.display = 'none';
            }
        }

        if (!container) return;
        
        if (!displayAlerts || displayAlerts.length === 0) {
            container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 13px;">Bu kategoriye ait bildirim bulunmuyor.</div>';
            return;
        }

        container.innerHTML = displayAlerts.map(a => {
            const isRead = readAlerts.has(a.id);
            const bgClass = a.severity === 'critical' ? 'alert-box alert-tehlikeli' : 'alert-box alert-dikkat';
            const severityTR = a.severity === 'critical' ? 'KRİTİK' : (a.severity === 'warning' ? 'UYARI' : a.severity.toUpperCase());
            const opacityStyle = isRead ? 'opacity: 0.6;' : '';
            
            return `
                <div class="${bgClass}" style="padding: 10px; border-radius: 0; font-size: 12px; margin-bottom: 0; ${opacityStyle} transition: opacity 0.2s ease;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                        <span style="font-weight: 600;">${severityTR}</span>
                        <span style="font-size: 10px; opacity: 0.7;">${a.timestamp}</span>
                    </div>
                    <div style="color: var(--text-secondary); display: flex; justify-content: space-between; align-items: flex-end; gap: 10px;">
                        <div style="flex: 1;">${App.escapeHTML(a.message)}</div>
                        ${!isRead ? `<button class="btn-mark-read" data-id="${a.id}" style="background: transparent; border: none; padding: 4px; margin: -4px; cursor: pointer; color: var(--color-success); border-radius: 0; display: flex;" title="Okundu olarak işaretle" onmouseover="this.style.background='rgba(16, 185, 129, 0.1)'" onmouseout="this.style.background='transparent'">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                        </button>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    return {
        loadAlerts,
        renderAlertBanner
    };
})();


