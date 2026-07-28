/**
 * SPARK Sistem Alarmları ve Bildirim Modülü (alerts.js)
 */
const AlertManager = (() => {
    'use strict';

    async function loadAlerts() {
        try {
            const alerts = await ApiClient.fetchAlerts(10);
            renderAlertBanner(alerts);
        } catch (err) {
            console.error("Alarmlar çekilirken hata:", err);
        }
    }

    function renderAlertBanner(alerts) {
        const container = document.getElementById('system-alerts-container');
        if (!container || !alerts || alerts.length === 0) return;

        container.innerHTML = alerts.map(a => {
            const bgClass = a.severity === 'critical' ? 'alert-box alert-tehlikeli' : 'alert-box alert-dikkat';
            return `
                <div class="${bgClass}" style="margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <strong>[${a.timestamp}] ${a.severity.toUpperCase()}</strong>: ${App.escapeHTML(a.message)}
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
