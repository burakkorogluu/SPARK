/**
 * SPARK API İstemcisi
 * Backend sunucusu ile haberleşerek verileri, tahminleri ve analizleri alır.
 *
 * Özellikler:
 * - Merkezi hata yakalama (interceptor pattern)
 * - Otomatik yeniden deneme (exponential backoff)
 * - İstek zaman aşımı desteği (AbortController)
 */
const ApiClient = (() => {
    'use strict';

    const API_BASE_URL = 'http://127.0.0.1:8000/api';
    const DEFAULT_TIMEOUT_MS = 15000;  // 15 saniye
    const MAX_RETRIES = 2;
    const RETRY_BASE_DELAY_MS = 500;

    /**
     * Merkezi fetch yardımcısı — timeout, retry ve hata yönetimini içerir.
     */
    async function _fetch(url, options = {}, retryCount = 0) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                // 4xx hataları yeniden denenmez
                if (response.status >= 400 && response.status < 500) {
                    let errorDetail = `HTTP ${response.status}`;
                    try {
                        const body = await response.json();
                        errorDetail = body.detail || JSON.stringify(body);
                    } catch (_) { /* json parse başarısız */ }
                    throw new Error(`API Hatası ${response.status}: ${errorDetail}`);
                }
                throw new Error(`API Hatası: ${response.status}`);
            }

            return await response.json();

        } catch (err) {
            clearTimeout(timeoutId);

            const isTimeout = err.name === 'AbortError';
            const isNetworkError = err instanceof TypeError;

            // Retry: sadece ağ/timeout hatalarında, max deneme sayısına kadar
            if ((isTimeout || isNetworkError) && retryCount < MAX_RETRIES) {
                const delay = RETRY_BASE_DELAY_MS * Math.pow(2, retryCount);
                console.warn(`[ApiClient] Yeniden deneniyor (${retryCount + 1}/${MAX_RETRIES}): ${url} — ${err.message}`);
                await new Promise(r => setTimeout(r, delay));
                return _fetch(url, options, retryCount + 1);
            }

            if (isTimeout) {
                throw new Error(`Zaman aşımı: Sunucu ${DEFAULT_TIMEOUT_MS / 1000}s içinde yanıt vermedi.`);
            }
            throw err;
        }
    }

    async function fetchMeasurements(startDate, endDate, transformerId = null) {
        let url = `${API_BASE_URL}/osos/fetch?start_date=${startDate}&end_date=${endDate}`;
        if (transformerId) {
            url += `&transformer_id=${transformerId}`;
        }
        return _fetch(url, { cache: 'no-store' });
    }

    async function fetchTransformers() {
        return _fetch(`${API_BASE_URL}/transformers`);
    }
    
    async function fetchAnalysisSummary(year, month, transformerId = null) {
        let url = `${API_BASE_URL}/analysis/summary?year=${year}&month=${month}`;
        if (transformerId) url += `&transformer_id=${transformerId}`;
        return _fetch(url);
    }
    
    async function fetchForecast(transformerId, year, month, method = 'ensemble') {
        const url = `${API_BASE_URL}/forecast?transformer_id=${transformerId}&year=${year}&month=${month}&method=${method}`;
        return _fetch(url);
    }

    async function fetchManeuverAssets() {
        return _fetch(`${API_BASE_URL}/maneuver/assets`);
    }

    async function fetchManeuverSuggestions() {
        return _fetch(`${API_BASE_URL}/maneuver/suggest`);
    }

    async function simulateManeuver(assetType, assetId, targetTrafoId) {
        const url = `${API_BASE_URL}/maneuver/simulate?asset_type=${assetType}&asset_id=${assetId}&target_trafo_id=${targetTrafoId}`;
        return _fetch(url, { method: 'POST' });
    }

    async function applyManeuver(assetType, assetId, targetTrafoId, reason = null) {
        return _fetch(`${API_BASE_URL}/maneuver/apply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                asset_type: assetType,
                asset_id: assetId,
                target_trafo_id: targetTrafoId,
                reason: reason
            })
        });
    }

    async function fetchManeuverHistory(limit = 50, offset = 0) {
        return _fetch(`${API_BASE_URL}/maneuver/history?limit=${limit}&offset=${offset}`);
    }

    async function rollbackManeuver(logId) {
        return _fetch(`${API_BASE_URL}/maneuver/rollback/${logId}`, { method: 'POST' });
    }

    async function addFeeder(feederData) {
        return _fetch(`${API_BASE_URL}/maneuver/feeder`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(feederData)
        });
    }

    async function addReactor(reactorData) {
        return _fetch(`${API_BASE_URL}/maneuver/reactor`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reactorData)
        });
    }

    async function addMeasurement(data) {
        return _fetch(`${API_BASE_URL}/osos/measurements`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
    }

    async function deleteMeasurement(transformerId, timestamp) {
        const url = `${API_BASE_URL}/osos/measurements?transformer_id=${encodeURIComponent(transformerId)}&timestamp=${encodeURIComponent(timestamp)}`;
        return _fetch(url, { method: 'DELETE' });
    }

    return {
        fetchMeasurements,
        fetchTransformers,
        fetchAnalysisSummary,
        fetchForecast,
        fetchManeuverAssets,
        fetchManeuverSuggestions,
        simulateManeuver,
        applyManeuver,
        fetchManeuverHistory,
        rollbackManeuver,
        addFeeder,
        addReactor,
        addMeasurement,
        deleteMeasurement
    };
})();
