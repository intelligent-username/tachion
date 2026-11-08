// API calls
const API_BASE = '/api'

export async function fetchForexCurrencies({ signal } = {}) {
    const response = await fetch(`${API_BASE}/forex/currencies`, { signal })
    if (!response.ok) throw new Error('Currency suggestions are unavailable.')
    const data = await response.json()
    const isCode = code => typeof code === 'string' && /^[A-Z]{3}$/.test(code)
    if (!data || !Array.isArray(data.currencies) || !data.currencies.length ||
        !data.currencies.every(isCode) || !Array.isArray(data.pairs) || !data.pairs.length ||
        typeof data.stale !== 'boolean' || !Number.isFinite(data.refreshAfterSeconds) ||
        data.refreshAfterSeconds <= 0 || data.refreshAfterSeconds > 3600) {
        throw new Error('Invalid currency directory.')
    }
    const codes = new Set(data.currencies)
    const pairedCodes = new Set()
    for (const pair of data.pairs) {
        if (!pair || !isCode(pair.base) || !isCode(pair.quote) || pair.base === pair.quote ||
            pair.symbol !== `${pair.base}_${pair.quote}` || !codes.has(pair.base) || !codes.has(pair.quote)) {
            throw new Error('Invalid currency directory.')
        }
        pairedCodes.add(pair.base)
        pairedCodes.add(pair.quote)
    }
    if (pairedCodes.size !== codes.size) throw new Error('Invalid currency directory.')
    return data
}

// Send search request to backend
export async function sendSearch(symbol, assetClass, timespan = 'max') {
    const response = await fetch(`${API_BASE}/search`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            symbol: symbol,
            type: assetClass,
            timespan: timespan
        })
    })

    if (!response.ok) {
        throw new Error(`Failed to send search request: ${response.statusText}`)
    }

    return await response.json()
}

// Fetch historical OHLCV data for a symbol (30m interval expected from backend)
export async function fetchHistory(symbol, assetClass, timespan = 'max') {
    const params = new URLSearchParams({
        symbol: symbol,
        asset_class: assetClass,
        timespan: timespan,
        interval: '30m'
    })

    const response = await fetch(`${API_BASE}/history?${params.toString()}`, {
        method: 'GET'
    })

    if (!response.ok) {
        throw new Error(`Failed to fetch history: ${response.statusText}`)
    }

    const json = await response.json()
    return json.data
}

// Get prediction from backend
// Sends the visualizer's current OHLCV candle data and expects back
// ⌊ln(n)⌋ prediction points, each with upper, lower, and median.
export async function fetchPrediction(symbol, assetClass, candles) {
    const params = new URLSearchParams({
        symbol,
        asset_class: assetClass,
        candles: JSON.stringify(candles ?? [])
    })

    const response = await fetch(`${API_BASE}/predict?${params.toString()}`, {
        method: 'GET'
    })

    if (!response.ok) {
        throw new Error(`Failed to fetch prediction: ${response.statusText}`)
    }

    // Expected response shape:
    // { predictions: [ { timestamp, upper, lower, median }, ... ] }
    // where predictions.length === Math.floor(Math.log(candles.length))
    return await response.json()
}
