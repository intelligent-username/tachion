// Canonical band math is cached independently of prepared/visible candle arrays.
import { BAND_LIMIT, getCachedBandIndicators } from '../indicators/band-cache.js'
import { VOLBANDS_CFG } from '../indicators/constants.js'
import { parseDateLike } from './visualizer-data'

function strictNumber(value) {
    return value == null || value === '' ? null : Number(value)
}

/** Validate deliveries by content; never repair invalid OHLC for band math. */
export function getBandIndicators(descriptor, options) {
    const source = descriptor.data
    if (!Array.isArray(source) || !source.length || descriptor.assetClass === 'interest') return null
    if (!options.showBollingerBands && !options.showVolatilityBands) return null
    const byTime = new Map()
    for (const row of source) {
        if (!row || typeof row !== 'object') continue
        const date = parseDateLike(row.timestamp ?? row.datetime ?? row.date ?? row.time ?? row.t)
        if (!date || !Number.isFinite(date.getTime())) continue
        // Deterministic last-delivery-wins for duplicate timestamps.
        byTime.set(date.getTime(), { date: new Date(date.getTime()),
            open: strictNumber(row.open ?? row.o), high: strictNumber(row.high ?? row.h),
            low: strictNumber(row.low ?? row.l), close: strictNumber(row.close ?? row.c) })
    }
    const bars = Array.from(byTime.values()).sort((a, b) => a.date - b.date).slice(-BAND_LIMIT)
    return getCachedBandIndicators(bars, { assetClass: descriptor.assetClass, symbol: descriptor.symbol,
        resolution: descriptor.resolution ?? descriptor.interval ?? '30m' })
}

/** Plain historical coverage/status copy; no statistical promises or UI math. */
export function bandStatus(cached) {
    const result = cached?.volatility
    if (!result) return ''
    const { status, calibratedBars, realizedCoverage, isProvisional, usableBars, coverageBars } = result.stats
    if (usableBars < result.meta.minimumBars) return `Need at least ${result.meta.minimumBars} usable bars for bands.`
    if (isProvisional || status === 'calibrating') {
        const narrow = status === 'degenerate' ? ' Observed motion is too small to measure.' : ''
        return `Provisional estimate — ${calibratedBars}/${VOLBANDS_CFG.quantileWindow} calibration residuals; no established coverage.${narrow}`
    }
    if (status === 'degenerate') return 'Band too narrow to measure (degenerate).'
    if (realizedCoverage == null) return 'Calibrating — awaiting next-bar coverage.'
    return `Band captured the price ${(realizedCoverage * 100).toFixed(1)}% of the time in the last ${coverageBars} evaluated bars.`
}

// Simple moving average with a truncated window at the start of the series
export function computeAdaptiveMovingAverage(values, windowSize) {
    if (!values.length) return []
    const out = new Array(values.length)
    let runningSum = 0

    for (let i = 0; i < values.length; i++) {
        runningSum += values[i]
        const start = Math.max(0, i - windowSize + 1)
        if (start > 0) {
            runningSum -= values[start - 1]
        }
        const span = i - start + 1
        out[i] = span > 0 ? (runningSum / span) : values[i]
    }

    return out
}

// Exponential moving average, seeded with the initial price
export function computeExponentialMovingAverage(values, period = 20) {
    if (!values.length) return []
    const out = new Array(values.length)
    const multiplier = 2 / (period + 1)

    // Seed with initial price
    let prevEma = values[0]
    out[0] = prevEma

    for (let i = 1; i < values.length; i++) {
        prevEma = (values[i] - prevEma) * multiplier + prevEma
        out[i] = prevEma
    }

    return out
}
