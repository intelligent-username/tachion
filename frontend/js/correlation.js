import {
    clampCandlesByTimespan,
    filterCandlesByRange,
    normalizeRange,
    parseDateLike
} from './visualizer/visualizer-data'

export const DEFAULT_CORRELATION_OPTIONS = Object.freeze({
    barMs: 30 * 60 * 1000,
    movementBars: 1,
    responseBars: 2,
    minAMove: 0.001,
    minFollowRatio: 0.2,
    minSamples: 20
})

const TOLERANCE = 1e-12

function validOptions(options) {
    return ['barMs', 'movementBars', 'responseBars', 'minSamples']
        .every(key => Number.isSafeInteger(options[key]) && options[key] > 0) &&
        ['minAMove', 'minFollowRatio']
            .every(key => Number.isFinite(options[key]) && options[key] > 0)
}

function prepareCloses(series, timespan, range) {
    const byTime = new Map()
    for (const row of series?.data ?? []) {
        if (!row) continue
        const date = parseDateLike(row.timestamp ?? row.datetime ?? row.date ?? row.time ?? row.t)
        const rawClose = row.close ?? row.c ?? row.value
        if (!date || !['number', 'string'].includes(typeof rawClose) ||
            (typeof rawClose === 'string' && !rawClose.trim())) continue
        const close = Number(rawClose)
        if (!Number.isFinite(close) || close <= 0) continue
        const time = date.getTime()
        const previous = byTime.get(time)
        // A conflict stays invalid even if a later duplicate matches one price.
        if (previous === null) continue
        byTime.set(time, previous && previous.close !== close ? null : { date, close })
    }
    const candles = [...byTime.values()].filter(Boolean).sort((a, b) => a.date - b.date)
    return filterCandlesByRange(clampCandlesByTimespan(candles, timespan), range)
}

export function preparePairHistory(seriesA, seriesB, timespan = 'max', selectedRange = null, barMs = DEFAULT_CORRELATION_OPTIONS.barMs) {
    const range = normalizeRange(selectedRange)
    const a = prepareCloses(seriesA, timespan, range)
    const bByTime = new Map(prepareCloses(seriesB, timespan, range)
        .map(candle => [candle.date.getTime(), candle.close]))
    const runs = []
    let run = []
    for (const candle of a) {
        const time = candle.date.getTime()
        if (!bByTime.has(time)) continue
        if (run.length && time - run[run.length - 1].time !== barMs) {
            runs.push(run)
            run = []
        }
        run.push({ time, a: candle.close, b: bByTime.get(time) })
    }
    if (run.length) runs.push(run)
    return runs
}

export function buildPairObservations(runs, overrides = {}) {
    const options = { ...DEFAULT_CORRELATION_OPTIONS, ...overrides }
    const simultaneous = []
    const delayed = []
    if (!validOptions(options)) return { simultaneous, delayed }
    const { movementBars: m, responseBars: h, minAMove } = options
    for (const run of runs) {
        for (let t = m; t < run.length; t++) {
            const a = run[t].a / run[t - m].a - 1
            const same = run[t].b / run[t - m].b - 1
            if (!Number.isFinite(a) || !Number.isFinite(same) ||
                a === 0 || Math.abs(a) + TOLERANCE < minAMove) continue
            simultaneous.push({ a, b: same })
            if (t + h < run.length) {
                const later = run[t + h].b / run[t].b - 1
                if (Number.isFinite(later)) delayed.push({ a, b: later })
            }
        }
    }
    return { simultaneous, delayed }
}

function isFollow({ a, b }, minFollowRatio) {
    return Math.sign(a) === Math.sign(b) &&
        Math.abs(b) + TOLERANCE >= minFollowRatio * Math.abs(a)
}

function followRate(observations, options) {
    const n = observations.length
    const hits = observations.filter(row => isFollow(row, options.minFollowRatio)).length
    return {
        n,
        hits,
        value: n >= options.minSamples ? hits / n : null,
        reason: n >= options.minSamples ? null : 'insufficient'
    }
}

function relativeSize(observations, minSamples) {
    const ratios = observations.map(({ a, b }) => b / a).sort((a, b) => a - b)
    const n = ratios.length
    if (n < minSamples) return { n, value: null, reason: 'insufficient' }
    if (!ratios.every(Number.isFinite)) return { n, value: null, reason: 'nonfinite' }
    const middle = Math.floor(n / 2)
    const value = n % 2 ? ratios[middle] : ratios[middle - 1] / 2 + ratios[middle] / 2
    return { n, value, reason: null }
}

function coMovement(observations, minSamples) {
    const n = observations.length
    if (n < Math.max(2, minSamples)) return { n, value: null, reason: 'insufficient' }
    const meanA = observations.reduce((sum, row) => sum + row.a / n, 0)
    const meanB = observations.reduce((sum, row) => sum + row.b / n, 0)
    let varianceA = 0
    let varianceB = 0
    let covariance = 0
    for (const { a, b } of observations) {
        const centeredA = a - meanA
        const centeredB = b - meanB
        varianceA += centeredA * centeredA
        varianceB += centeredB * centeredB
        covariance += centeredA * centeredB
    }
    if (varianceA <= n * TOLERANCE ** 2 || varianceB <= n * TOLERANCE ** 2) {
        return { n, value: null, reason: 'constant' }
    }
    const value = covariance / Math.sqrt(varianceA) / Math.sqrt(varianceB)
    return Number.isFinite(value)
        ? { n, value: Math.max(-1, Math.min(1, value)), reason: null }
        : { n, value: null, reason: 'nonfinite' }
}

export function summarizeObservations({ simultaneous, delayed }, overrides = {}) {
    const options = { ...DEFAULT_CORRELATION_OPTIONS, ...overrides }
    return {
        together: followRate(simultaneous, options),
        up: followRate(delayed.filter(row => row.a > 0), options),
        down: followRate(delayed.filter(row => row.a < 0), options),
        combined: followRate(delayed, options),
        size: relativeSize(delayed, options.minSamples),
        correlation: coMovement(simultaneous, options.minSamples)
    }
}

export function analyzePair({ series = [], timespan = 'max', selectedRange = null, options: overrides = {} } = {}) {
    const options = { ...DEFAULT_CORRELATION_OPTIONS, ...overrides }
    const [a, b] = series
    const result = { a: a?.symbol, b: b?.symbol, options, metrics: null }
    if (!a?.symbol || !b?.symbol) return { ...result, status: 'awaiting-pair' }
    if ([a, b].some(stock => stock.assetClass !== 'equities')) return { ...result, status: 'unsupported' }
    if ([a, b].some(stock => stock.status === 'loading')) return { ...result, status: 'loading' }
    if ([a, b].some(stock => stock.status === 'error')) return { ...result, status: 'error' }
    if (!validOptions(options)) return { ...result, status: 'invalid-options' }
    const runs = preparePairHistory(a, b, timespan, selectedRange, options.barMs)
    const observations = buildPairObservations(runs, options)
    const metrics = summarizeObservations(observations, options)
    return {
        ...result,
        metrics,
        status: Object.values(metrics).some(metric => metric.value !== null) ? 'ready' : 'insufficient'
    }
}
