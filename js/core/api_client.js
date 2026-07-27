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
        const response = await fetch(url);
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

    async function applyManeuver(assetType, assetId, targetTrafoId) {
        const url = `${API_BASE_URL}/maneuver/apply?asset_type=${assetType}&asset_id=${assetId}&target_trafo_id=${targetTrafoId}`;
        const response = await fetch(url, { method: 'POST' });
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
        applyManeuver
    };
})();

