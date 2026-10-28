// Global state management using React Context.
// setState is stable, so the local patch helpers below can be plain functions
// without affecting callback identities or closure semantics.
import React, { createContext, useContext, useState, useCallback, useRef } from 'react'
import { fetchHistory, fetchPrediction, sendSearch } from './api'
import { prepareCandles } from './visualizer/visualizer-data'

// UI cap for series slots; actions still iterate the array
export const MAX_SERIES = 2

// Monotonic id source so removed slots never reuse an id
let seriesSeq = 0

const createSeries = (symbol = null, assetClass = null) => ({
    id: `series-${++seriesSeq}`,
    symbol,
    assetClass,
    data: [],
    hiddenLevel: 0,
    status: 'idle',
    error: null,
    message: null
})

// Initial state
const initialState = {
    series: [],
    focusedSeriesId: null,
    predictions: {},
    timespan: '7d',
    drawMovingAverage: false,
    drawExponentialMovingAverage: false,
    searchedHistory: {},
    chartMode: 'bars'
}

// Create context
const AppContext = createContext(null)

// Cache key for a symbol/asset/timespan combination
const chartKey = (assetClass, symbol, timespan) => `${assetClass}:${symbol}:${timespan}`

// Prefer the chart's prepared candles when they match and have data; otherwise normalize rows
function resolvePredictionCandles(chart, slot, timespan, fallbackRows = null) {
    const snapshot = chart?.getSeriesSnapshot?.(slot.id)
    const snapshotMatches = snapshot &&
        snapshot.symbol === slot.symbol &&
        snapshot.timespan === timespan
    if (snapshotMatches && snapshot.data?.length) {
        return snapshot.data
    }
    return prepareCandles(fallbackRows ?? slot.data ?? [], timespan)
}

// One prediction request; resolve failures become rejected promises for allSettled
function requestPrediction(chart, slot, timespan, fallbackRows = null) {
    try {
        const candles = resolvePredictionCandles(chart, slot, timespan, fallbackRows)
        if (!candles.length) throw new Error('No chart data available for prediction')
        return fetchPrediction(slot.symbol, slot.assetClass, candles)
    } catch (err) {
        return Promise.reject(err)
    }
}

// Resolve the legacy predict target; an empty focused slot must not shadow a match
function resolveLegacyTarget(series, focused, primary, symbol, assetClass) {
    const matching = series.find(s => s.symbol === symbol && s.assetClass === assetClass)
    if (focused && (focused.symbol || focused.assetClass)) return focused
    return matching ?? focused ?? primary
}

// Provider component
export function StateProvider({ children }) {
    const [state, setState] = useState(initialState)
    const prefetchInFlight = useRef(new Set())
    const chartInstanceRef = useRef(null)
    const requestTokens = useRef({})

    // Generic shallow patch of the global state
    const patch = (update) => setState(prev => ({
        ...prev,
        ...(typeof update === 'function' ? update(prev) : update)
    }))

    // Bump and return a slot's request token
    const nextRequestToken = (seriesId) => {
        const token = (requestTokens.current[seriesId] ?? 0) + 1
        requestTokens.current[seriesId] = token
        return token
    }

    const isCurrentToken = (seriesId, token) => requestTokens.current[seriesId] === token

    // Record that a symbol/asset/timespan has been searched (cached)
    const markSearched = (key) => patch(prev => ({
        searchedHistory: { ...prev.searchedHistory, [key]: true }
    }))

    // Store one slot's history and mark the cache key searched
    const applySeriesHistory = (seriesId, data, key) => patch(prev => {
        if (!prev.series.some(s => s.id === seriesId)) return {}
        return {
            series: prev.series.map(s => s.id === seriesId ? {
                ...s,
                data: Array.isArray(data) ? data : [],
                status: 'ready',
                error: null,
                message: null
            } : s),
            predictions: { ...prev.predictions },
            searchedHistory: { ...prev.searchedHistory, [key]: true }
        }
    })

    // History failure clears only the failing slot
    const failSeriesLoad = (seriesId, err) => patch(prev => ({
        series: prev.series.map(s => s.id === seriesId ? {
            ...s,
            data: [],
            status: 'error',
            error: err?.message ?? 'Failed to load data',
            message: null
        } : s),
        predictions: { ...prev.predictions }
    }))

    // Let graph.jsx register its chart instance so runPrediction can read series snapshots
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

    // After a history fetch: warm the prefetch cache for larger timeframes
    const finishHistoryFetch = useCallback((symbol, assetClass, timespan, data) => {
        if (Array.isArray(data) && data.length > 0) {
            prefetchHistory(symbol, assetClass, timespan)
        }
    }, [prefetchHistory])

    // Mark one slot loading, clear its data, and drop its stale prediction
    const beginSeriesLoad = (seriesId, symbol, assetClass, timespan) => patch(prev => {
        const predictions = { ...prev.predictions }
        delete predictions[seriesId]
        return {
            timespan,
            predictions,
            series: prev.series.map(s => s.id === seriesId ? {
                ...s,
                symbol,
                assetClass,
                data: [],
                // Reloading the same instrument keeps its visibility; a new one starts visible
                hiddenLevel: s.symbol === symbol && s.assetClass === assetClass
                    ? (s.hiddenLevel ?? 0)
                    : 0,
                status: 'loading',
                error: null,
                message: 'Collecting Data...'
            } : s)
        }
    })

    const addSeriesSlot = useCallback(() => {
        if (state.series.length >= MAX_SERIES) return
        const slot = createSeries()
        setState(prev => {
            if (prev.series.length >= MAX_SERIES) return prev
            return {
                ...prev,
                series: [...prev.series, slot],
                focusedSeriesId: slot.id,
                predictions: { ...prev.predictions }
            }
        })
    }, [state.series.length])

    const focusSeries = useCallback((id) => {
        patch({ focusedSeriesId: id ?? null })
    }, [])

    const removeSeries = useCallback((id) => {
        nextRequestToken(id)
        setState(prev => {
            const series = prev.series.filter(s => s.id !== id)
            if (series.length === prev.series.length) return prev

            const predictions = { ...prev.predictions }
            delete predictions[id]
            const focusStillExists = series.some(s => s.id === prev.focusedSeriesId)
            const focusedSeriesId = focusStillExists ? prev.focusedSeriesId : (series[0]?.id ?? null)
            return { ...prev, series, predictions, focusedSeriesId }
        })
    }, [])

    const reorderSeries = useCallback((sourceId, targetId) => {
        setState(prev => {
            const from = prev.series.findIndex(s => s.id === sourceId)
            const to = prev.series.findIndex(s => s.id === targetId)
            if (from < 0 || to < 0 || from === to) return prev

            const series = [...prev.series]
            const [moved] = series.splice(from, 1)
            series.splice(to, 0, moved)
            return { ...prev, series }
        })
    }, [])

    // 0 = main graph visible, 1 = main graph hidden
    const cycleSeriesVisibility = useCallback((id) => {
        setState(prev => {
            const index = prev.series.findIndex(s => s.id === id)
            if (index < 0) return prev

            const series = [...prev.series]
            const slot = series[index]
            series[index] = { ...slot, hiddenLevel: (slot.hiddenLevel ?? 0) >= 1 ? 0 : 1 }
            return { ...prev, series }
        })
    }, [])

    const isDuplicateSeries = useCallback((symbol, assetClass, excludeId = null) => {
        if (!symbol || !assetClass) return false
        return state.series.some(s =>
            s.id !== excludeId && s.symbol === symbol && s.assetClass === assetClass
        )
    }, [state.series])

    // Replace or fill one slot; duplicate guard leaves all data untouched
    const setSeriesSymbol = useCallback(async (seriesId, symbol, assetClass, timespan = state.timespan) => {
        if (!seriesId || !symbol || !assetClass) {
            return { ok: false, error: 'Symbol required' }
        }
        if (isDuplicateSeries(symbol, assetClass, seriesId)) {
            return { ok: false, error: 'Already on chart' }
        }

        const resolvedTimespan = timespan || state.timespan
        const key = chartKey(assetClass, symbol, resolvedTimespan)
        const token = nextRequestToken(seriesId)
        beginSeriesLoad(seriesId, symbol, assetClass, resolvedTimespan)

        try {
            await sendSearch(symbol, assetClass, resolvedTimespan)
            const data = await fetchHistory(symbol, assetClass, resolvedTimespan)
            if (!isCurrentToken(seriesId, token)) return { ok: false, stale: true }
            applySeriesHistory(seriesId, data, key)
            finishHistoryFetch(symbol, assetClass, resolvedTimespan, data)
            return { ok: true, id: seriesId, data, timespan: resolvedTimespan }
        } catch (err) {
            if (!isCurrentToken(seriesId, token)) return { ok: false, stale: true }
            failSeriesLoad(seriesId, err)
            return { ok: false, error: err?.message ?? 'Failed to load data' }
        }
    }, [state.timespan, isDuplicateSeries, finishHistoryFetch])

    // Backward-compatible wrapper: focused slot, else primary, creating one when empty
    const setAsset = useCallback(async (symbol, assetClass, timespan = state.timespan) => {
        const target = state.series.find(s => s.id === state.focusedSeriesId) ?? state.series[0] ?? null
        if (target) {
            return setSeriesSymbol(target.id, symbol, assetClass, timespan)
        }

        const slot = createSeries()
        setState(prev => ({
            ...prev,
            series: [...prev.series, slot],
            focusedSeriesId: slot.id
        }))
        return setSeriesSymbol(slot.id, symbol, assetClass, timespan)
    }, [state.series, state.focusedSeriesId, state.timespan, setSeriesSymbol])

    // Mark every populated slot loading for a global timespan change
    const beginTimespanLoad = (timespan) => patch(prev => ({
        timespan,
        predictions: {},
        series: prev.series.map(s => {
            if (!s.symbol || !s.assetClass) return s
            const key = chartKey(s.assetClass, s.symbol, timespan)
            return {
                ...s,
                status: 'loading',
                error: null,
                message: prev.searchedHistory[key] ? 'Loading...' : 'Collecting Data...'
            }
        })
    }))

    // Update the global timespan and refetch every populated slot in parallel
    const setTimespan = useCallback(async (timespan) => {
        if (!timespan) return

        const targets = state.series.filter(s => s.symbol && s.assetClass)
        const tokens = {}
        targets.forEach(slot => { tokens[slot.id] = nextRequestToken(slot.id) })
        beginTimespanLoad(timespan)

        await Promise.allSettled(targets.map(async (slot) => {
            try {
                const data = await fetchHistory(slot.symbol, slot.assetClass, timespan)
                if (!isCurrentToken(slot.id, tokens[slot.id])) return
                applySeriesHistory(slot.id, data, chartKey(slot.assetClass, slot.symbol, timespan))
                finishHistoryFetch(slot.symbol, slot.assetClass, timespan, data)
            } catch (err) {
                if (isCurrentToken(slot.id, tokens[slot.id])) failSeriesLoad(slot.id, err)
            }
        }))
    }, [state.series, finishHistoryFetch])

    // Store one slot's prediction and mark it ready
    const applyPrediction = (seriesId, prediction) => patch(prev => ({
        predictions: { ...prev.predictions, [seriesId]: prediction },
        series: prev.series.map(s => s.id === seriesId ? {
            ...s,
            status: 'ready',
            error: null,
            message: null
        } : s)
    }))

    // Prediction failure keeps the slot's candles and any existing forecast
    const failPrediction = (seriesId, err) => patch(prev => ({
        predictions: { ...prev.predictions },
        series: prev.series.map(s => s.id === seriesId ? {
            ...s,
            status: 'error',
            error: err?.message ?? 'Prediction failed',
            message: null
        } : s)
    }))

    // Mark prediction targets loading without touching their candles
    const beginPredictionLoad = (targets) => {
        const targetIds = new Set(targets.map(s => s.id))
        patch(prev => ({
            predictions: { ...prev.predictions },
            series: prev.series.map(s => targetIds.has(s.id) ? {
                ...s,
                status: 'loading',
                error: null,
                message: 'Loading...'
            } : s)
        }))
    }

    // Predict the given slots in parallel; one failure never blocks the rest
    const predictTargets = useCallback(async (targets, timespan, fallbackRowsById = {}) => {
        if (!targets.length) return

        const tokens = {}
        targets.forEach(slot => { tokens[slot.id] = requestTokens.current[slot.id] ?? 0 })
        beginPredictionLoad(targets)

        const results = await Promise.allSettled(targets.map(slot => requestPrediction(
            chartInstanceRef.current, slot, timespan, fallbackRowsById[slot.id] ?? null
        )))

        results.forEach((result, index) => {
            const slot = targets[index]
            if (!isCurrentToken(slot.id, tokens[slot.id])) return
            if (result.status === 'fulfilled') {
                applyPrediction(slot.id, result.value)
            } else {
                failPrediction(slot.id, result.reason)
            }
        })
    }, [])

    // Legacy single-target path: predict the focused/primary slot, fetching only when needed
    const runLegacyPrediction = useCallback(async (symbol, options) => {
        const focused = state.series.find(s => s.id === state.focusedSeriesId) ?? null
        const primary = state.series[0] ?? null
        const assetClass = options.assetClass ?? focused?.assetClass ?? primary?.assetClass ?? null
        if (!assetClass) return

        const target = resolveLegacyTarget(state.series, focused, primary, symbol, assetClass)
        const timespan = options.timespan ?? state.timespan
        const hasCurrentData = Boolean(
            target &&
            target.symbol === symbol &&
            target.assetClass === assetClass &&
            Array.isArray(target.data) &&
            target.data.length > 0 &&
            timespan === state.timespan
        )

        if (hasCurrentData) {
            await predictTargets([target], timespan)
            return
        }

        const result = target
            ? await setSeriesSymbol(target.id, symbol, assetClass, timespan)
            : await setAsset(symbol, assetClass, timespan)
        if (!result?.ok) return

        const slot = { id: result.id, symbol, assetClass, data: result.data ?? [] }
        await predictTargets([slot], result.timespan, { [result.id]: result.data })
    }, [state.series, state.focusedSeriesId, state.timespan, setSeriesSymbol, setAsset, predictTargets])

    // Run prediction for every populated slot, or one when options.seriesId is set
    const runPrediction = useCallback(async (horizon = 7, options = {}) => {
        const populated = state.series.filter(s => s.symbol && s.assetClass)
        if (options.symbol && populated.length <= 1) {
            return runLegacyPrediction(options.symbol, options)
        }

        const timespan = options.seriesId ? (options.timespan ?? state.timespan) : state.timespan
        const targets = populated.filter(s => !options.seriesId || s.id === options.seriesId)
        if (!targets.length) return

        if (options.seriesId) patch({ timespan })
        await predictTargets(targets, timespan)
    }, [state.series, state.timespan, runLegacyPrediction, predictTargets])

    const primary = state.series[0] ?? null
    const value = {
        ...state,
        historicalData: primary?.data ?? [],
        predictionData: primary ? (state.predictions[primary.id] ?? null) : null,
        currentSymbol: primary?.symbol ?? null,
        assetClass: primary?.assetClass ?? null,
        isLoading: state.series.some(s => s.status === 'loading'),
        loadingMessage: state.series.find(s => s.status === 'loading')?.message ?? null,
        error: state.series.find(s => s.error)?.error ?? null,
        setTimespan,
        setChartMode: (chartMode) => patch({ chartMode }),
        setDrawMovingAverage: (drawMovingAverage) => patch({ drawMovingAverage }),
        setDrawExponentialMovingAverage: (drawExponentialMovingAverage) => patch({ drawExponentialMovingAverage }),
        setAsset,
        runPrediction,
        registerChart,
        addSeriesSlot,
        focusSeries,
        removeSeries,
        reorderSeries,
        cycleSeriesVisibility,
        isDuplicateSeries,
        setSeriesSymbol
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
