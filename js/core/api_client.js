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
                    throw new Error(errorDetail);
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
            url += `&transformer_id=${encodeURIComponent(transformerId)}`;
        }
        return _fetch(url, { cache: 'no-store' });
    }

    async function fetchTransformers() {
        return _fetch(`${API_BASE_URL}/transformers`);
    }

    async function fetchAnalysisSummary(year, month, transformerId = null) {
        let url = `${API_BASE_URL}/analysis/summary?year=${year}&month=${month}`;
        if (transformerId) url += `&transformer_id=${encodeURIComponent(transformerId)}`;
        return _fetch(url);
    }

    async function fetchForecast(transformerId, year, month, method = 'ensemble') {
        const url = `${API_BASE_URL}/forecast?transformer_id=${encodeURIComponent(transformerId)}&year=${year}&month=${month}&method=${method}`;
        return _fetch(url);
    }

    async function fetchManeuverAssets() {
        return _fetch(`${API_BASE_URL}/maneuver/assets`);
    }

    async function fetchManeuverSuggestions() {
        return _fetch(`${API_BASE_URL}/maneuver/suggest`);
    }

    async function simulateManeuver(assetType, assetId, targetTrafoId) {
        const url = `${API_BASE_URL}/maneuver/simulate?asset_type=${encodeURIComponent(assetType)}&asset_id=${encodeURIComponent(assetId)}&target_trafo_id=${encodeURIComponent(targetTrafoId)}`;
        return _fetch(url, { method: 'POST' });
    }

    async function applyManeuver(assetType, assetId, targetTrafoId, reason = null, overrideOverload = false) {
        return _fetch(`${API_BASE_URL}/maneuver/apply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                asset_type: assetType,
                asset_id: assetId,
                target_trafo_id: targetTrafoId,
                reason: reason,
                override_overload: overrideOverload
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

    async function addTransformer(trafoData) {
        return _fetch(`${API_BASE_URL}/maneuver/transformer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(trafoData)
        });
    }

    async function addReactor(reactorData) {
        return _fetch(`${API_BASE_URL}/maneuver/reactor`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reactorData)
        });
    }

    async function deleteFeeder(feederId) {
        return _fetch(`${API_BASE_URL}/maneuver/feeder/${encodeURIComponent(feederId)}`, { method: 'DELETE' });
    }

    async function deleteReactor(reactorId) {
        return _fetch(`${API_BASE_URL}/maneuver/reactor/${encodeURIComponent(reactorId)}`, { method: 'DELETE' });
    }

    async function bulkUpdateTopology(bulkData) {
        return _fetch(`${API_BASE_URL}/maneuver/topology/bulk-update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bulkData)
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

    async function fetchAlerts(limit = 20) {
        return _fetch(`${API_BASE_URL}/alerts?limit=${limit}`);
    }

    async function checkAlerts(year = null, month = null) {
        let url = `${API_BASE_URL}/alerts/check`;
        if (year && month) url += `?year=${year}&month=${month}`;
        return _fetch(url, { method: 'POST' });
    }

    async function evaluateModels(transformerId, steps = 168) {
        return _fetch(`${API_BASE_URL}/models/evaluate?transformer_id=${encodeURIComponent(transformerId)}&steps=${steps}`);
    }

    async function fetchScadaState() {
        return _fetch(`${API_BASE_URL}/scada/state`);
    }

    async function toggleScadaBreaker(breakerId, targetState, trafoId = 'UMR-TRA', reason = 'SCADA Operatör Manevrası') {
        return _fetch(`${API_BASE_URL}/scada/breaker`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                breaker_id: breakerId,
                target_state: targetState,
                trafo_id: trafoId,
                reason: reason
            })
        });
    }

    async function ackScadaAlarm(alarmId) {
        return _fetch(`${API_BASE_URL}/scada/alarm/ack`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ alarm_id: alarmId })
        });
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
        addTransformer,
        addFeeder,
        addReactor,
        deleteFeeder,
        deleteReactor,
        bulkUpdateTopology,
        addMeasurement,
        deleteMeasurement,
        fetchAlerts,
        checkAlerts,
        evaluateModels,
        fetchScadaState,
        toggleScadaBreaker,
        ackScadaAlarm
    };
})();
