// Global state management using React Context
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

// Provider component
export function StateProvider({ children }) {
    const [state, setState] = useState(initialState)
    const prefetchInFlight = useRef(new Set())
    const chartInstanceRef = useRef(null)

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

        const key = `${assetClass}:${symbol}:${prefetchTs}`
        if (state.searchedHistory[key]) return
        if (prefetchInFlight.current.has(key)) return

        prefetchInFlight.current.add(key)
        try {
            const data = await fetchHistory(symbol, assetClass, prefetchTs)
            if (Array.isArray(data) && data.length > 0) {
                setState(prev => ({
                    ...prev,
                    searchedHistory: {
                        ...prev.searchedHistory,
                        [key]: true
                    }
                }))
            }
        } catch {
            // Silent background prefetch
        } finally {
            prefetchInFlight.current.delete(key)
        }
    }, [getPrefetchTimespan, state.searchedHistory])

    // Set the current asset and fetch its history
    const setAsset = useCallback(async (symbol, assetClass, timespan = state.timespan) => {
        setState(prev => ({
            ...prev,
            currentSymbol: symbol,
            assetClass: assetClass,
            timespan,
            isLoading: true,
            loadingMessage: 'Collecting Data...',
            error: null,
            predictionData: null
        }))

        try {
            await sendSearch(symbol, assetClass, timespan)
            const data = await fetchHistory(symbol, assetClass, timespan)
            const key = `${assetClass}:${symbol}:${timespan}`
            setState(prev => ({
                ...prev,
                historicalData: data,
                searchedHistory: {
                    ...prev.searchedHistory,
                    [key]: true
                },
                isLoading: false,
                loadingMessage: null
            }))

            if (Array.isArray(data) && data.length > 0) {
                // Background cache warm-up for larger timeframes
                prefetchHistory(symbol, assetClass, timespan)
            } else {
                // Ensure UI clears on empty result
                setState(prev => ({
                    ...prev,
                    historicalData: [],
                    predictionData: null
                }))
            }
        } catch (err) {
            setState(prev => ({
                ...prev,
                error: err.message,
                isLoading: false,
                loadingMessage: null,
                historicalData: [],
                predictionData: null
            }))
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

        const key = `${targetAssetClass}:${targetSymbol}:${targetTimespan}`

        setState(prev => ({
            ...prev,
            currentSymbol: targetSymbol,
            assetClass: targetAssetClass,
            timespan: targetTimespan,
            isLoading: true,
            loadingMessage: 'Loading...',
            error: null
        }))

        try {
            if (ensureSearched && !state.searchedHistory[key]) {
                await sendSearch(targetSymbol, targetAssetClass, targetTimespan)
                const history = await fetchHistory(targetSymbol, targetAssetClass, targetTimespan)
                setState(prev => ({
                    ...prev,
                    historicalData: history,
                    searchedHistory: {
                        ...prev.searchedHistory,
                        [key]: true
                    }
                }))
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
            setState(prev => ({
                ...prev,
                predictionData: prediction,
                isLoading: false,
                loadingMessage: null
            }))
        } catch (err) {
            setState(prev => ({
                ...prev,
                error: err.message,
                isLoading: false,
                loadingMessage: null
            }))
        }
    }, [state.currentSymbol, state.assetClass, state.timespan, state.searchedHistory])

    // Update only chart timespan for current symbol/asset without re-running search endpoint
    const setTimespan = useCallback(async (timespan) => {
        if (!timespan) return

        const targetSymbol = state.currentSymbol
        const targetAssetClass = state.assetClass
        const key = `${targetAssetClass}:${targetSymbol}:${timespan}`
        const wasSearched = !!(targetSymbol && targetAssetClass && state.searchedHistory[key])

        setState(prev => ({
            ...prev,
            timespan,
            error: null,
            isLoading: !!(targetSymbol && targetAssetClass),
            loadingMessage: (targetSymbol && targetAssetClass)
                ? (wasSearched ? 'Loading...' : 'Collecting Data...')
                : null
        }))

        if (!targetSymbol || !targetAssetClass) return

        try {
            const data = await fetchHistory(targetSymbol, targetAssetClass, timespan)
            setState(prev => ({
                ...prev,
                historicalData: data,
                searchedHistory: {
                    ...prev.searchedHistory,
                    [key]: true
                },
                isLoading: false,
                loadingMessage: null
            }))

            if (Array.isArray(data) && data.length > 0) {
                prefetchHistory(targetSymbol, targetAssetClass, timespan)
            } else {
                setState(prev => ({
                    ...prev,
                    historicalData: [],
                    predictionData: null
                }))
            }
        } catch (err) {
            setState(prev => ({
                ...prev,
                error: err.message,
                isLoading: false,
                loadingMessage: null,
                historicalData: [],
                predictionData: null
            }))
        }
    }, [state.currentSymbol, state.assetClass, state.searchedHistory])

    const value = {
        ...state,
        setTimespan,
        setChartMode: (chartMode) => setState(prev => ({ ...prev, chartMode })),
        setDrawMovingAverage: (drawMovingAverage) => setState(prev => ({ ...prev, drawMovingAverage })),
        setDrawExponentialMovingAverage: (drawExponentialMovingAverage) => setState(prev => ({ ...prev, drawExponentialMovingAverage })),
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
