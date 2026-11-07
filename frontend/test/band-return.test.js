import { describe, expect, it } from 'vitest'
import { fiveBarReturnRate } from '../js/visualizer/visualizer-bands.js'

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
    it('excludes follow-up windows with missing band or close data', () => {
        const result = fiveBarReturnRate(renderer([5, 11, 5, null, 5, 5, 5]), 'bollinger')
        expect(result).toEqual({ exits: 0, returns: 0, percentage: null })
    })
})
