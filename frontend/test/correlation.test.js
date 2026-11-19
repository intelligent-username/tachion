import { describe, expect, it } from 'vitest'
import {
    analyzePair,
    buildPairObservations,
    DEFAULT_CORRELATION_OPTIONS,
    preparePairHistory,
    summarizeObservations
} from '../js/correlation'

const START = Date.parse('2026-01-05T14:30:00Z')
const BAR = DEFAULT_CORRELATION_OPTIONS.barMs

function stock(symbol, returns, initial = 100) {
    let close = initial
    const data = [{ timestamp: START, close }]
    returns.forEach((value, i) => {
        close *= 1 + value
        data.push({ timestamp: START + (i + 1) * BAR, close })
    })
    return { symbol, assetClass: 'equities', status: 'ready', data }
}

function analyze(aReturns, bReturns, options = {}) {
    return analyzePair({
        series: [stock('AAA', aReturns), stock('BBB', bReturns)],
        options: { minSamples: 1, ...options }
    })
}

function summarize(simultaneous, delayed = simultaneous, options = {}) {
    return summarizeObservations({ simultaneous, delayed }, { minSamples: 1, ...options })
}

describe('proportional follow statistics', () => {
    it.each([
        [0.02, 0.001, 0],
        [0.02, 0.004, 1],
        [-0.05, -0.01, 1],
        [-0.02, -0.0039, 0],
        [0.02, -0.004, 0],
        [0.02, 0, 0]
    ])('A=%s, B=%s has %s hits', (a, b, hits) => {
        expect(analyze([a], [b]).metrics.together.hits).toBe(hits)
    })

    it('excludes only tiny A moves, preserving cutoff equality', () => {
        const result = analyze([0.00099, 0.001, -0.001, 0.00101], [0.1, 0, 0, 0])
        expect(result.metrics.together).toMatchObject({ n: 3, hits: 0, value: 0 })
    })

    it('does not count incomplete future windows as misses', () => {
        const result = analyze([0.02, 0.02, 0.02], [0, 0.002, 0.002])
        expect(result.metrics.together.n).toBe(3)
        expect(result.metrics.combined).toMatchObject({ n: 1, hits: 1, value: 1 })
    })

    it('distinguishes a delayed follower from a simultaneous follower', () => {
        const result = analyze([0.02, -0.02, 0.02, -0.02], [0, 0.01, -0.01, 0.01], { responseBars: 1 })
        expect(result.metrics.together.hits).toBe(0)
        expect(result.metrics.combined).toMatchObject({ n: 3, hits: 3, value: 1 })
    })

    it('requires the endpoint response, not an intrawindow touch', () => {
        const result = analyze([0.02, 0, 0], [0, 0.01, 100.1 / 101 - 1])
        expect(result.metrics.combined).toMatchObject({ n: 1, hits: 0 })
    })

    it('supports independent movement and response periods', () => {
        const series = [stock('AAA', [0.01, 0.01, 0.01, 0.01]), stock('BBB', [0, 0.01, 0.02, 0.03])]
        const runs = preparePairHistory(...series)
        const result = buildPairObservations(runs, { movementBars: 2, responseBars: 1 })
        expect(result.simultaneous).toHaveLength(3)
        expect(result.delayed).toHaveLength(2)
        expect(result.delayed[0].a).toBeCloseTo(0.0201)
        expect(result.delayed[0].b).toBeCloseTo(0.02)
    })

    it('pools counts rather than averaging directional percentages', () => {
        const result = summarize([
            { a: 0.02, b: 0.01 }, { a: 0.02, b: 0 },
            { a: 0.02, b: 0 }, { a: -0.02, b: -0.01 }
        ])
        expect(result.up.value).toBeCloseTo(1 / 3)
        expect(result.down.value).toBe(1)
        expect(result.combined).toMatchObject({ n: 4, hits: 2, value: 0.5 })
    })

    it('includes misses and opposite responses in the signed median', () => {
        const rows = [-1, 0, 0.1, 0.5].map(ratio => ({ a: 0.02, b: 0.02 * ratio }))
        expect(summarize(rows).size.value).toBeCloseTo(0.05)
        expect(summarize(rows.slice(0, 3)).size.value).toBe(0)
        expect(summarize(rows.slice(0, 1)).size.value).toBe(-1)
    })

    it('enforces sample floors independently and preserves a valid zero rate', () => {
        const rows = [{ a: 0.01, b: 0 }, { a: 0.02, b: 0 }, { a: -0.01, b: 0 }]
        const result = summarize(rows, rows, { minSamples: 2 })
        expect(result.combined.value).toBe(0)
        expect(result.up.value).toBe(0)
        expect(result.down).toMatchObject({ n: 1, value: null, reason: 'insufficient' })
    })

    it('changes directional thresholds and size when A and B reverse', () => {
        const series = [stock('AAA', [0.02, 0.02, 0.02]), stock('BBB', [0.001, 0.001, 0.001])]
        const normal = analyzePair({ series, options: { minSamples: 1 } })
        const reversed = analyzePair({ series: [...series].reverse(), options: { minSamples: 1 } })
        expect(normal.metrics.together.value).toBe(0)
        expect(reversed.metrics.together.value).toBe(1)
        expect(reversed.metrics.size.value).toBeGreaterThan(normal.metrics.size.value)
    })
})

describe('return correlation', () => {
    it.each([1, -1])('handles a perfectly %s related return series', direction => {
        const result = summarize([0.01, 0.02, -0.01, -0.02].map(a => ({ a, b: direction * a })))
        expect(result.correlation.value).toBeCloseTo(direction)
    })

    it('does not correlate price levels', () => {
        const result = summarize([
            { a: 0.01, b: 0.01 }, { a: 0.01, b: -0.01 },
            { a: -0.01, b: 0.01 }, { a: -0.01, b: -0.01 }
        ])
        expect(result.correlation.value).toBeCloseTo(0)
    })

    it('makes constant returns unavailable without suppressing other metrics', () => {
        const result = analyze(Array(25).fill(0.01), Array(25).fill(0.01))
        expect(result.metrics.correlation).toMatchObject({ value: null, reason: 'constant' })
        expect(result.metrics.together.value).toBe(1)
        expect(result.metrics.size.value).not.toBeNull()
    })

    it('does not emit NaN for flat or single-sample histories', () => {
        expect(analyze([0, 0], [0, 0]).status).toBe('insufficient')
        expect(analyze([0.01], [0.01]).metrics.correlation.value).toBeNull()
    })
})

describe('paired history integrity', () => {
    it('sorts and intersects timestamps rather than zipping array indices', () => {
        const a = stock('AAA', [0.01, 0.02, 0.03])
        const b = stock('BBB', [0.01, 0.02, 0.03])
        b.data = [b.data[3], b.data[1], b.data[0]]
        const runs = preparePairHistory(a, b)
        expect(runs.map(run => run.map(row => row.time))).toEqual([
            [START, START + BAR], [START + BAR * 3]
        ])
    })

    it.each([BAR * 2, BAR * 1.5, BAR * 24, BAR * 144])('does not cross a gap of %s ms', gap => {
        const a = stock('AAA', [0.01, 0.01, 0.01])
        const b = stock('BBB', [0.01, 0.01, 0.01])
        for (const item of [a, b]) {
            item.data[2].timestamp = START + BAR + gap
            item.data[3].timestamp = START + BAR * 2 + gap
        }
        const observations = buildPairObservations(preparePairHistory(a, b))
        expect(observations.simultaneous).toHaveLength(2)
        expect(observations.delayed).toHaveLength(0)
    })

    it('collapses exact duplicates and removes conflicting timestamp prices permanently', () => {
        const a = stock('AAA', [0.01, 0.02, 0.03])
        const b = stock('BBB', [0.01, 0.02, 0.03])
        a.data.push({ ...a.data[1] })
        expect(preparePairHistory(a, b)[0]).toHaveLength(4)
        a.data.push({ ...a.data[1], close: 999 }, { ...a.data[1] })
        expect(preparePairHistory(a, b).flat().map(row => row.time))
            .toEqual([START, START + BAR * 2, START + BAR * 3])
    })

    it.each([null, '', ' ', undefined, NaN, Infinity, 0, -1, true])('rejects close=%s without filling prices', close => {
        const a = stock('AAA', [0.01, 0.01])
        const b = stock('BBB', [0.01, 0.01])
        a.data[1].close = close
        expect(preparePairHistory(a, b).flat()).toHaveLength(2)
        expect(buildPairObservations(preparePairHistory(a, b)).simultaneous).toHaveLength(0)
    })

    it('supports the chart timestamp/close aliases and rejects invalid dates', () => {
        const a = { data: [{ t: START, c: '100' }, { datetime: START + BAR, value: 101 }, { date: 'invalid', close: 1 }] }
        const b = { data: [{ time: START, close: 50 }, { date: new Date(START + BAR), close: 51 }] }
        expect(preparePairHistory(a, b)[0]).toHaveLength(2)
    })

    it('keeps all observation endpoints inside the inclusive range', () => {
        const series = [stock('AAA', Array(8).fill(0.01)), stock('BBB', Array(8).fill(0.01))]
        const result = analyzePair({
            series, selectedRange: { start: START + BAR * 2, end: START + BAR * 5 },
            options: { minSamples: 1 }
        })
        expect(result.metrics.together.n).toBe(3)
        expect(result.metrics.combined.n).toBe(1)
        expect(analyzePair({
            series, selectedRange: { start: START, end: START }, options: { minSamples: 1 }
        }).status).toBe('insufficient')
    })

    it('respects both timespan and range, including reversed range drags', () => {
        const series = [stock('AAA', Array(8).fill(0.01)), stock('BBB', Array(8).fill(0.01))]
        const result = analyzePair({
            series, timespan: '1h',
            selectedRange: { start: START + BAR * 8, end: START + BAR * 5 },
            options: { minSamples: 1 }
        })
        expect(result.metrics.together.n).toBe(2)
        expect(result.metrics.combined.n).toBe(0)
    })

    it('handles unequal and disjoint histories without mutating inputs', () => {
        const series = [stock('AAA', [0.01, 0.02]), stock('BBB', [0.01])]
        const before = JSON.stringify(series)
        expect(analyzePair({ series, options: { minSamples: 1 } }).metrics.together.n).toBe(1)
        expect(JSON.stringify(series)).toBe(before)
        series[1].data = series[1].data.map(row => ({ ...row, timestamp: row.timestamp + BAR * 20 }))
        expect(analyzePair({ series }).status).toBe('insufficient')
    })
})

describe('analysis statuses and defaults', () => {
    it('requires two populated ordered stock slots', () => {
        expect(analyzePair().status).toBe('awaiting-pair')
        expect(analyzePair({ series: [stock('AAA', []), { symbol: null }] }).status).toBe('awaiting-pair')
    })

    it.each([
        ['forex', 'ready', 'unsupported'],
        ['equities', 'loading', 'loading'],
        ['equities', 'error', 'error']
    ])('handles %s/%s as %s', (assetClass, status, expected) => {
        const series = [stock('AAA', [0.01]), { ...stock('BBB', [0.01]), assetClass, status }]
        expect(analyzePair({ series }).status).toBe(expected)
        expect(analyzePair({ series }).metrics).toBeNull()
    })

    it.each([
        { movementBars: 0 }, { responseBars: 1.5 }, { minSamples: -1 },
        { barMs: Infinity }, { minAMove: NaN }, { minFollowRatio: '0.2' }
    ])('safely rejects invalid options %j', options => {
        expect(analyze([0.01], [0.01], options).status).toBe('invalid-options')
    })

    it('uses the agreed defaults without requiring settings', () => {
        expect(DEFAULT_CORRELATION_OPTIONS).toMatchObject({
            movementBars: 1, responseBars: 2, minAMove: 0.001, minFollowRatio: 0.2, minSamples: 20
        })
    })
})
