// Canonical band math is cached independently of prepared/visible candle arrays.
import { computeBollinger } from '../indicators/bollinger.js'
import { computeVolBands } from '../indicators/volbands.js'
import { VOLBANDS_CFG } from '../indicators/constants.js'
import { parseDateLike } from './visualizer-data'

const BAND_LIMIT = 60000
const bandCache = new WeakMap()

function strictNumber(value) {
    return value == null || value === '' ? null : Number(value)
}

/** Reuse full-delivery math across timespan, geometry and visibility changes. */
export function getBandIndicators(descriptor, options) {
    const source = descriptor.data
    if (!Array.isArray(source) || !source.length || descriptor.assetClass === 'interest') return null
    if (!options.showBollingerBands && !options.showVolatilityBands) return null
    let assets = bandCache.get(source)
    if (!assets) { assets = new Map(); bandCache.set(source, assets) }
    const key = `${descriptor.assetClass}|${descriptor.symbol}`
    let cached = assets.get(key)
    if (!cached) {
        // Do not use prepareCandles: its display fallbacks repair invalid OHLC.
        const bars = source.map(row => {
            const date = parseDateLike(row.timestamp ?? row.datetime ?? row.date ?? row.time ?? row.t)
            return { date, open: strictNumber(row.open ?? row.o), high: strictNumber(row.high ?? row.h),
                low: strictNumber(row.low ?? row.l), close: strictNumber(row.close ?? row.c) }
        }).filter(bar => bar.date).sort((a, b) => a.date - b.date).slice(-BAND_LIMIT)
        cached = { bars, indexByTime: new Map(bars.map((bar, i) => [bar.date.getTime(), i])),
            bollinger: null, volatility: null }
        assets.set(key, cached)
    }
    if (options.showBollingerBands && !cached.bollinger) cached.bollinger = computeBollinger(cached.bars)
    if (options.showVolatilityBands && !cached.volatility) {
        cached.volatility = computeVolBands(cached.bars, { assetClass: descriptor.assetClass })
        // Each emitted interval is evaluated by the canonical computation. Count
        // once with the cached result, not on each presentation/resize pass.
        cached.coverageBars = Math.min(VOLBANDS_CFG.quantileWindow,
            cached.volatility.upper.reduce((count, value) => count + (Number.isFinite(value) ? 1 : 0), 0))
    }
    return cached
}

/** Plain historical coverage/status copy; no statistical promises or UI math. */
export function bandStatus(cached) {
    const result = cached?.volatility
    if (!result) return ''
    const { status, calibratedBars, realizedCoverage } = result.stats
    if (status === 'degenerate') return 'Band too narrow to measure (degenerate).'
    if (status === 'calibrating') return `Calibrating — ${Math.max(0, VOLBANDS_CFG.quantileWindow - calibratedBars)} more usable bars.`
    if (realizedCoverage == null) return 'Calibrating — awaiting next-bar coverage.'
    return `Band captured the price ${(realizedCoverage * 100).toFixed(1)}% of the time in the last ${cached.coverageBars} evaluated bars.`
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
