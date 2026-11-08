// Global state management using React Context.
// setState is stable, so the local patch helpers below can be plain functions
// without affecting callback identities or closure semantics.
import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'
import { fetchHistory, fetchPrediction, sendSearch } from './api'
import { normalizeRange, prepareCandles } from './visualizer/visualizer-data'
import { loadOverlayPrefs, saveOverlayPrefs } from './prefs'
import { inverseForexPair, invertForexRows } from './symbol-utils'

// UI cap for series slots; actions still iterate the array
export const MAX_SERIES = 2

// Local history cache: swap directions are served from here, so the first
// reciprocal is computed once and the reverse direction restores the exact
// original array reference.
const HISTORY_CACHE_LIMIT = 32
const FOREX_FRESH_MS = 25 * 60 * 1000

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
    selectedRange: null,
    drawMovingAverage: false,
    drawExponentialMovingAverage: false,
    searchedHistory: {},
    chartMode: 'bars',
    // Rows shown in the chart hover tooltip
    tooltipFields: {
        price: true,
        time: true,
        open: true,
        high: true,
        low: true,
        volume: true
    }
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
    const [state, setState] = useState(() => ({ ...initialState, ...loadOverlayPrefs() }))
    const prefetchInFlight = useRef(new Map())
    const chartInstanceRef = useRef(null)
    const requestTokens = useRef({})
    const historyCache = useRef(new Map())

    useEffect(() => {
        saveOverlayPrefs(state.drawBollingerBands, state.drawVolatilityBands)
    }, [state.drawBollingerBands, state.drawVolatilityBands])

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

    // Keep the latest successful history for each symbol/timespan. A swap
    // reads this cache first, so it never waits on Search or History.
    const rememberHistory = useCallback((assetClass, symbol, timespan, data, bandHistory) => {
        if (!assetClass || !symbol) return
        const key = chartKey(assetClass, symbol, timespan)
        const cache = historyCache.current
        const previous = cache.get(key)
        const hasData = Array.isArray(data)
        const entry = {
            data: hasData ? data : previous?.data ?? [],
            bandHistory: bandHistory !== undefined
                ? (Array.isArray(bandHistory) ? bandHistory : [])
                : previous?.bandHistory ?? [],
            loadedAt: hasData ? Date.now() : previous?.loadedAt ?? Date.now()
        }
        cache.delete(key)
        cache.set(key, entry)
        while (cache.size > HISTORY_CACHE_LIMIT) {
            cache.delete(cache.keys().next().value)
        }
    }, [])

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

    // Fetch earlier bars for lagged indicators without changing visible chart data.
    const finishHistoryFetch = useCallback((seriesId, token, symbol, assetClass, timespan, data) => {
        const earlierTimespan = getPrefetchTimespan(timespan)
        if (!earlierTimespan || !Array.isArray(data) || !data.length) return
        const key = chartKey(assetClass, symbol, earlierTimespan)
        let request = prefetchInFlight.current.get(key)
        if (!request) {
            request = fetchHistory(symbol, assetClass, earlierTimespan)
            prefetchInFlight.current.set(key, request)
            request.finally(() => prefetchInFlight.current.delete(key)).catch(() => {})
        }
        request.then(history => {
            if (!isCurrentToken(seriesId, token) || !Array.isArray(history) || !history.length) return
            rememberHistory(assetClass, symbol, timespan, undefined, history)
            setState(prev => ({ ...prev, series: prev.series.map(slot =>
                slot.id === seriesId && slot.symbol === symbol && slot.assetClass === assetClass
                    ? { ...slot, bandHistory: history } : slot) }))
        }).catch(() => {})
    }, [getPrefetchTimespan, rememberHistory])

    // Refresh a cached direction silently. The applied view is never cleared;
    // a newer request token discards this result if the user swaps again.
    const refreshForexHistory = useCallback((seriesId, symbol, timespan, token) => {
        fetchHistory(symbol, 'forex', timespan).then(data => {
            if (!isCurrentToken(seriesId, token) || !Array.isArray(data) || !data.length) return
            rememberHistory('forex', symbol, timespan, data)
            applySeriesHistory(seriesId, data, chartKey('forex', symbol, timespan))
            finishHistoryFetch(seriesId, token, symbol, 'forex', timespan, data)
        }).catch(() => {})
    }, [finishHistoryFetch, rememberHistory])

    // Mark one slot loading, clear its data, and drop its stale prediction
    const beginSeriesLoad = (seriesId, symbol, assetClass, timespan) => patch(prev => {
        const predictions = { ...prev.predictions }
        delete predictions[seriesId]
        return {
            timespan,
            selectedRange: null,
            predictions,
            series: prev.series.map(s => s.id === seriesId ? {
                ...s,
                symbol,
                assetClass,
                data: [],
                bandHistory: [],
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

        // FOREX swap: when only the direction changed and history is already
        // available, flip it locally. No Search/History round-trip, no loading
        // state, and the reverse direction is an exact O(1) cache hit.
        const current = state.series.find(s => s.id === seriesId) ?? null
        if (assetClass === 'forex' && current?.assetClass === 'forex' &&
            inverseForexPair(current.symbol) === symbol) {
            const targetEntry = historyCache.current.get(key)
            const cachedSource = historyCache.current.get(chartKey('forex', current.symbol, resolvedTimespan))
            const sourceEntry = cachedSource?.data?.length
                ? {
                    data: cachedSource.data,
                    bandHistory: current.bandHistory ?? cachedSource.bandHistory ?? [],
                    loadedAt: cachedSource.loadedAt
                }
                : (current.status !== 'loading' && Array.isArray(current.data) && current.data.length
                    ? { data: current.data, bandHistory: current.bandHistory ?? [], loadedAt: Date.now() }
                    : null)

            let swapped = targetEntry
            if (!swapped?.data?.length && sourceEntry?.data?.length) {
                swapped = {
                    data: invertForexRows(sourceEntry.data),
                    bandHistory: invertForexRows(sourceEntry.bandHistory ?? []),
                    loadedAt: sourceEntry.loadedAt ?? Date.now()
                }
                rememberHistory('forex', symbol, resolvedTimespan, swapped.data, swapped.bandHistory)
            }

            if (swapped?.data?.length) {
                // Invalidate any in-flight load so a late response cannot
                // overwrite this direction (the latest click always wins).
                const token = nextRequestToken(seriesId)
                patch(prev => {
                    const predictions = { ...prev.predictions }
                    delete predictions[seriesId]
                    return {
                        timespan: resolvedTimespan,
                        predictions,
                        series: prev.series.map(s => s.id === seriesId ? {
                            ...s,
                            symbol,
                            assetClass: 'forex',
                            data: swapped.data,
                            bandHistory: swapped.bandHistory ?? [],
                            status: 'ready',
                            error: null,
                            message: null
                        } : s),
                        searchedHistory: { ...prev.searchedHistory, [key]: true }
                    }
                })
                if (Date.now() - swapped.loadedAt >= FOREX_FRESH_MS) {
                    refreshForexHistory(seriesId, symbol, resolvedTimespan, token)
                }
                return { ok: true, id: seriesId, data: swapped.data, timespan: resolvedTimespan, local: true }
            }
        }

        const token = nextRequestToken(seriesId)
        beginSeriesLoad(seriesId, symbol, assetClass, resolvedTimespan)

        try {
            await sendSearch(symbol, assetClass, resolvedTimespan)
            const data = await fetchHistory(symbol, assetClass, resolvedTimespan)
            if (!isCurrentToken(seriesId, token)) return { ok: false, stale: true }
            rememberHistory(assetClass, symbol, resolvedTimespan, data)
            applySeriesHistory(seriesId, data, key)
            finishHistoryFetch(seriesId, token, symbol, assetClass, resolvedTimespan, data)
            return { ok: true, id: seriesId, data, timespan: resolvedTimespan }
        } catch (err) {
            if (!isCurrentToken(seriesId, token)) return { ok: false, stale: true }
            failSeriesLoad(seriesId, err)
            return { ok: false, error: err?.message ?? 'Failed to load data' }
        }
    }, [state.timespan, state.series, isDuplicateSeries, finishHistoryFetch, rememberHistory, refreshForexHistory])

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
        selectedRange: null,
        predictions: {},
        series: prev.series.map(s => {
            if (!s.symbol || !s.assetClass) return s
            const key = chartKey(s.assetClass, s.symbol, timespan)
            return {
                ...s,
                bandHistory: [],
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
                rememberHistory(slot.assetClass, slot.symbol, timespan, data)
                applySeriesHistory(slot.id, data, chartKey(slot.assetClass, slot.symbol, timespan))
                finishHistoryFetch(slot.id, tokens[slot.id], slot.symbol, slot.assetClass, timespan, data)
            } catch (err) {
                if (isCurrentToken(slot.id, tokens[slot.id])) failSeriesLoad(slot.id, err)
            }
        }))
    }, [state.series, finishHistoryFetch, rememberHistory])

    // Stable actions: the chart callback and Reset pill both depend on these
    const setSelectedRange = useCallback((range) => {
        patch({ selectedRange: normalizeRange(range) })
    }, [])

    const clearSelectedRange = useCallback(() => {
        patch({ selectedRange: null })
    }, [])

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
        selectedRange: state.selectedRange,
        setSelectedRange,
        clearSelectedRange,
        setChartMode: (chartMode) => patch({ chartMode }),
        setDrawMovingAverage: (drawMovingAverage) => patch({ drawMovingAverage }),
        setDrawExponentialMovingAverage: (drawExponentialMovingAverage) => patch({ drawExponentialMovingAverage }),
        setDrawBollingerBands: (drawBollingerBands) => patch({ drawBollingerBands: !!drawBollingerBands }),
        setDrawVolatilityBands: (drawVolatilityBands) => patch({ drawVolatilityBands: !!drawVolatilityBands }),
        setTooltipField: (key, value) => patch({
            tooltipFields: { ...state.tooltipFields, [key]: !!value }
        }),
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
