import { describe, expect, it } from 'vitest'
import { bandPoints, fiveBarReturnRate } from '../js/visualizer/visualizer-bands.js'
import { getCachedBandIndicators } from '../js/indicators/band-cache.js'

function renderer(closes) {
    const bars = closes.map((close, i) => ({ close, date: new Date(i * 1800000), _i: i }))
    return { native: bars, bandData: { bars, indexByTime: new Map(bars.map((bar, i) => [bar.date.getTime(), i])) },
        bandPoints: { bollinger: bars.map(() => ({ lower: 0, upper: 10 })) } }
}

describe('five-bar returns', () => {
    it('counts each exit once and excludes unfinished follow-up windows', () => {
        const result = fiveBarReturnRate(renderer([5, 11, 12, 5, 5, 5, 5, 11, 11, 11, 11, 11, 11, 5, 11]), 'bollinger')
        expect(result).toEqual({ exits: 2, returns: 1, percentage: 50 })
    })
    it('counts exits in a cached range whose canonical indices start before the view', () => {
        const series = renderer([5, 11, 12, 5, 5, 5, 5])
        series.bandData.indexByTime = new Map(series.native.map((bar, i) => [bar.date.getTime(), i + 500]))
        expect(fiveBarReturnRate(series, 'bollinger')).toEqual({ exits: 1, returns: 1, percentage: 100 })
    })
    it('calculates a visible range from a real cached history', () => {
        const bars = Array.from({ length: 120 }, (_, i) => {
            const close = i % 12 === 0 ? 150 : 100 + (i % 3)
            return { date: new Date(i * 1800000), open: close, high: close + 1, low: close - 1, close }
        })
        const context = { assetClass: 'equities', symbol: 'CACHE_TEST', resolution: '30m' }
        getCachedBandIndicators(bars, context)
        const view = bars.slice(60)
        const cached = getCachedBandIndicators(view, context)
        const native = view.map((bar, i) => ({ ...bar, _i: i }))
        const series = { native, aligned: native, bandData: cached }
        series.bandPoints = Object.fromEntries(['bollinger', 'volatility'].map(kind => [kind, bandPoints(series, kind)]))
        for (const kind of ['bollinger', 'volatility']) {
            const result = fiveBarReturnRate(series, kind)
            expect(result.exits).toBeGreaterThan(0)
            expect(result.percentage).toBe(100)
        }
    })
    it('excludes follow-up windows with missing band or close data', () => {
        const result = fiveBarReturnRate(renderer([5, 11, 5, null, 5, 5, 5]), 'bollinger')
        expect(result).toEqual({ exits: 0, returns: 0, percentage: null })
    })
})
