import { describe, expect, it } from 'vitest'
import { filterCandlesByRange, normalizeRange } from '../js/visualizer/visualizer-data.js'
import { indexAtX } from '../js/visualizer/visualizer-range.js'

describe('normalizeRange', () => {
    it('sorts a reversed range ascending', () => {
        expect(normalizeRange({ start: 20, end: 10 })).toEqual({ start: 10, end: 20 })
    })

    it('returns null for missing or non-finite input', () => {
        expect(normalizeRange(null)).toBeNull()
        expect(normalizeRange({ start: NaN, end: 10 })).toBeNull()
        expect(normalizeRange({ start: 10, end: Infinity })).toBeNull()
        expect(normalizeRange({ start: 'nope', end: 10 })).toBeNull()
    })
})

describe('filterCandlesByRange', () => {
    const day = 24 * 60 * 60 * 1000
    const candles = Array.from({ length: 5 }, (_, i) => ({ date: new Date(i * day), close: i }))

    it('keeps inclusive boundary candles', () => {
        const result = filterCandlesByRange(candles, { start: 1 * day, end: 3 * day })
        expect(result.map(candle => candle.close)).toEqual([1, 2, 3])
    })

    it('does not mutate the input array', () => {
        const before = candles.slice()
        filterCandlesByRange(candles, { start: 1 * day, end: 3 * day })
        expect(candles).toEqual(before)
        expect(candles).toHaveLength(5)
    })

    it('passes candles through when no range is active', () => {
        expect(filterCandlesByRange(candles, null)).toBe(candles)
    })
})

describe('indexAtX', () => {
    const unionDates = Array.from({ length: 5 }, (_, i) => new Date(i * 1000))
    const chart = { width: 100, unionDates, xScale: { invert: x => x / 50 } }

    it('maps a pixel to the nearest union index', () => {
        expect(indexAtX(chart, 50)).toBe(1)
        expect(indexAtX(chart, 101)).toBe(2)
    })

    it('clamps below zero and above the last index', () => {
        expect(indexAtX(chart, -25)).toBe(0)
        const overshoot = { width: 100, unionDates, xScale: { invert: x => x } }
        expect(indexAtX(overshoot, 1000)).toBe(unionDates.length - 1)
    })

    it('returns 0 when there are no dates', () => {
        expect(indexAtX({ width: 100, unionDates: [], xScale: { invert: () => 2 } }, 40)).toBe(0)
    })
})
