// Global state management using React Context.
// setState is stable, so the local patch helpers below can be plain functions
// without affecting callback identities or closure semantics.
import React, { createContext, useContext, useState, useCallback, useRef } from 'react'
import { fetchHistory, fetchPrediction, sendSearch } from './api'

// Initial state
const initialState = {
    currentSymbol: null,
    assetClass: null,
    timespan: '7d',
    drawMovingAverage: false,
    drawExponentialMovingAverage: false,
    historicalData: [],
    predictionData: null,
    searchedHistory: {},
    chartMode: 'bars',
    isLoading: false,
    loadingMessage: null,
    error: null
}

// Create context
const AppContext = createContext(null)

// Cache key for a symbol/asset/timespan combination
const chartKey = (assetClass, symbol, timespan) => `${assetClass}:${symbol}:${timespan}`

// Provider component
export function StateProvider({ children }) {
    const [state, setState] = useState(initialState)
    const prefetchInFlight = useRef(new Set())
    const chartInstanceRef = useRef(null)

    // Generic shallow patch of the global state
    const patch = (update) => setState(prev => ({
        ...prev,
        ...(typeof update === 'function' ? update(prev) : update)
    }))

    // Record that a symbol/asset/timespan has been searched (cached)
    const markSearched = (key) => patch(prev => ({
        searchedHistory: { ...prev.searchedHistory, [key]: true }
    }))

    // Store fetched history and end the loading state
    const applyHistory = (data, key) => patch(prev => ({
        historicalData: data,
        searchedHistory: { ...prev.searchedHistory, [key]: true },
        isLoading: false,
        loadingMessage: null
    }))

    // Ensure the UI clears when there's no data
    const finishEmpty = () => patch({ historicalData: [], predictionData: null })

    // Error state; optionally clears chart data (loading failures do)
    const failLoad = (err, clearData = true) => patch({
        error: err.message,
        isLoading: false,
        loadingMessage: null,
        ...(clearData ? { historicalData: [], predictionData: null } : {})
    })

    // Let graph.jsx register its TChart instance so runPrediction can read currentData
    const registerChart = useCallback((chart) => {
        chartInstanceRef.current = chart
    }, [])

    const getPrefetchTimespan = useCallback((timespan) => {
        const ts = String(timespan || '').trim()
        if (!ts || ts === 'max') return null
        if (ts === 'ytd') return '1y'
        const h = ts.match(/^(\d+)h$/i)
        if (h) return '60d'
        const d = ts.match(/^(\d+)d$/i)
        if (d) {
            const days = Number(d[1])
            if (days <= 14) return '1y'
            if (days <= 60) return '1y'
            return 'max'
        }
        const m = ts.match(/^(\d+)m$/i)
        if (m) return 'max'
        const y = ts.match(/^(\d+)y$/i)
        if (y) return 'max'
        return null
    }, [])

    const prefetchHistory = useCallback(async (symbol, assetClass, currentTimespan) => {
        if (!symbol || !assetClass) return
        const prefetchTs = getPrefetchTimespan(currentTimespan)
        if (!prefetchTs) return

        const key = chartKey(assetClass, symbol, prefetchTs)
        if (state.searchedHistory[key]) return
        if (prefetchInFlight.current.has(key)) return

        prefetchInFlight.current.add(key)
        try {
            const data = await fetchHistory(symbol, assetClass, prefetchTs)
            if (Array.isArray(data) && data.length > 0) {
                markSearched(key)
            }
        } catch {
            // Silent background prefetch
        } finally {
            prefetchInFlight.current.delete(key)
        }
    }, [getPrefetchTimespan, state.searchedHistory])

    // After a history fetch: warm the prefetch cache or clear the UI on empty data
    const finishHistoryFetch = (symbol, assetClass, timespan, data) => {
        if (Array.isArray(data) && data.length > 0) {
            // Background cache warm-up for larger timeframes
            prefetchHistory(symbol, assetClass, timespan)
        } else {
            finishEmpty()
        }
    }

    const beginAssetLoad = (symbol, assetClass, timespan, message, resetPrediction = false) => patch({
        currentSymbol: symbol,
        assetClass,
        timespan,
        isLoading: true,
        loadingMessage: message,
        error: null,
        ...(resetPrediction ? { predictionData: null } : {})
    })

    // Set the current asset and fetch its history
    const setAsset = useCallback(async (symbol, assetClass, timespan = state.timespan) => {
        beginAssetLoad(symbol, assetClass, timespan, 'Collecting Data...', true)

        try {
            await sendSearch(symbol, assetClass, timespan)
            const data = await fetchHistory(symbol, assetClass, timespan)
            applyHistory(data, chartKey(assetClass, symbol, timespan))
            finishHistoryFetch(symbol, assetClass, timespan, data)
        } catch (err) {
            failLoad(err)
        }
    }, [state.timespan])

    // Run prediction for the current asset
    // Reads the visualizer's currentData and sends it to /predict.
    // Expects back ⌊ln(n)⌋ prediction points with upper, lower, median.
    const runPrediction = useCallback(async (horizon = 7, options = {}) => {
        const targetSymbol = options.symbol ?? state.currentSymbol
        const targetAssetClass = options.assetClass ?? state.assetClass
        const targetTimespan = options.timespan ?? state.timespan
        const ensureSearched = options.ensureSearched ?? true

        if (!targetSymbol || !targetAssetClass) return

        const key = chartKey(targetAssetClass, targetSymbol, targetTimespan)

        beginAssetLoad(targetSymbol, targetAssetClass, targetTimespan, 'Loading...')

        try {
            if (ensureSearched && !state.searchedHistory[key]) {
                await sendSearch(targetSymbol, targetAssetClass, targetTimespan)
                const history = await fetchHistory(targetSymbol, targetAssetClass, targetTimespan)
                applyHistory(history, key)
            }

            // Pull the visualizer's current candle data
            const candles = chartInstanceRef.current?.currentData ?? []
            if (!candles.length) {
                throw new Error('No chart data available for prediction')
            }

            const prediction = await fetchPrediction(
                targetSymbol,
                targetAssetClass,
                candles
            )
            patch({ predictionData: prediction, isLoading: false, loadingMessage: null })
        } catch (err) {
            failLoad(err, false)
        }
    }, [state.currentSymbol, state.assetClass, state.timespan, state.searchedHistory])

    // Update only chart timespan for current symbol/asset without re-running search endpoint
    const setTimespan = useCallback(async (timespan) => {
        if (!timespan) return

        const targetSymbol = state.currentSymbol
        const targetAssetClass = state.assetClass
        const key = chartKey(targetAssetClass, targetSymbol, timespan)
        const hasTarget = !!(targetSymbol && targetAssetClass)
        const wasSearched = !!(hasTarget && state.searchedHistory[key])

        patch({
            timespan,
            error: null,
            isLoading: hasTarget,
            loadingMessage: hasTarget ? (wasSearched ? 'Loading...' : 'Collecting Data...') : null
        })

        if (!targetSymbol || !targetAssetClass) return

        try {
            const data = await fetchHistory(targetSymbol, targetAssetClass, timespan)
            applyHistory(data, key)
            finishHistoryFetch(targetSymbol, targetAssetClass, timespan, data)
        } catch (err) {
            failLoad(err)
        }
    }, [state.currentSymbol, state.assetClass, state.searchedHistory])

    const value = {
        ...state,
        setTimespan,
        setChartMode: (chartMode) => patch({ chartMode }),
        setDrawMovingAverage: (drawMovingAverage) => patch({ drawMovingAverage }),
        setDrawExponentialMovingAverage: (drawExponentialMovingAverage) => patch({ drawExponentialMovingAverage }),
        setAsset,
        runPrediction,
        registerChart
    }

    return (
        <AppContext.Provider value={value}>
            {children}
        </AppContext.Provider>
    )
}

// Custom hook for accessing state
export function useAppState() {
    const context = useContext(AppContext)
    if (!context) {
        throw new Error('useAppState must be used within a StateProvider')
    }
    return context
}
