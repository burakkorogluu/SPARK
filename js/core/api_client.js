/**
 * SPARK API İstemcisi
 * Backend sunucusu ile haberleşerek verileri, tahminleri ve analizleri alır.
 */
const ApiClient = (() => {
    'use strict';

    const API_BASE_URL = 'http://127.0.0.1:8000/api';

    async function fetchMeasurements(startDate, endDate, transformerId = null) {
        let url = `${API_BASE_URL}/osos/fetch?start_date=${startDate}&end_date=${endDate}`;
        if (transformerId) {
            url += `&transformer_id=${transformerId}`;
        }
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) throw new Error(`API Hatası: ${response.status}`);
        return await response.json();
    }

    async function fetchTransformers() {
        const response = await fetch(`${API_BASE_URL}/transformers`);
        if (!response.ok) throw new Error(`API Hatası: ${response.status}`);
        return await response.json();
    }
    
    async function fetchAnalysisSummary(year, month, transformerId = null) {
        let url = `${API_BASE_URL}/analysis/summary?year=${year}&month=${month}`;
        if (transformerId) url += `&transformer_id=${transformerId}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`API Hatası: ${response.status}`);
        return await response.json();
    }
    
    async function fetchForecast(transformerId, year, month, method = 'ensemble') {
        const url = `${API_BASE_URL}/forecast?transformer_id=${transformerId}&year=${year}&month=${month}&method=${method}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`API Hatası: ${response.status}`);
        return await response.json();
    }

    async function fetchManeuverAssets() {
        const response = await fetch(`${API_BASE_URL}/maneuver/assets`);
        if (!response.ok) throw new Error(`API Hatası: ${response.status}`);
        return await response.json();
    }

    async function fetchManeuverSuggestions() {
        const response = await fetch(`${API_BASE_URL}/maneuver/suggest`);
        if (!response.ok) throw new Error(`API Hatası: ${response.status}`);
        return await response.json();
    }

    async function simulateManeuver(assetType, assetId, targetTrafoId) {
        const url = `${API_BASE_URL}/maneuver/simulate?asset_type=${assetType}&asset_id=${assetId}&target_trafo_id=${targetTrafoId}`;
        const response = await fetch(url, { method: 'POST' });
        if (!response.ok) throw new Error(`API Hatası: ${response.status}`);
        return await response.json();
    }

    async function applyManeuver(assetType, assetId, targetTrafoId, reason = null) {
        const response = await fetch(`${API_BASE_URL}/maneuver/apply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                asset_type: assetType,
                asset_id: assetId,
                target_trafo_id: targetTrafoId,
                reason: reason
            })
        });
        if (!response.ok) throw new Error(`API Hatası: ${response.status}`);
        return await response.json();
    }

    async function fetchManeuverHistory(limit = 50, offset = 0) {
        const url = `${API_BASE_URL}/maneuver/history?limit=${limit}&offset=${offset}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`API Hatası: ${response.status}`);
        return await response.json();
    }

    async function rollbackManeuver(logId) {
        const url = `${API_BASE_URL}/maneuver/rollback/${logId}`;
        const response = await fetch(url, { method: 'POST' });
        if (!response.ok) throw new Error(`API Hatası: ${response.status}`);
        return await response.json();
    }

    async function addFeeder(feederData) {
        const response = await fetch(`${API_BASE_URL}/maneuver/feeder`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(feederData)
        });
        if (!response.ok) throw new Error(`API Hatası: ${response.status}`);
        return await response.json();
    }

    async function addReactor(reactorData) {
        const response = await fetch(`${API_BASE_URL}/maneuver/reactor`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reactorData)
        });
        if (!response.ok) throw new Error(`API Hatası: ${response.status}`);
        return await response.json();
    }

    async function addMeasurement(data) {
        const response = await fetch(`${API_BASE_URL}/osos/measurements`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error(`API Hatası: ${response.status}`);
        return await response.json();
    }

    async function deleteMeasurement(transformerId, timestamp) {
        const url = `${API_BASE_URL}/osos/measurements?transformer_id=${encodeURIComponent(transformerId)}&timestamp=${encodeURIComponent(timestamp)}`;
        const response = await fetch(url, { method: 'DELETE' });
        if (!response.ok) throw new Error(`API Hatası: ${response.status}`);
        return await response.json();
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

