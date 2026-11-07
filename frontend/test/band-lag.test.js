import { describe, expect, it } from 'vitest'
import { computeBollinger } from '../js/indicators/bollinger.js'
import { computeVolBands } from '../js/indicators/volbands.js'
import { bandPoints } from '../js/visualizer/visualizer-bands.js'

function points(bars, kind) {
    const dated = bars.map((bar, i) => ({ ...bar, date: new Date(i * 1800000), _i: i }))
    const result = kind === 'bollinger' ? computeBollinger(dated) : computeVolBands(dated, { assetClass: 'equities' })
    return bandPoints({ aligned: dated, bandData: { [kind]: result,
        indexByTime: new Map(dated.map((bar, i) => [bar.date.getTime(), i])) } }, kind)
}

describe.each(['bollinger', 'volatility'])('%s displayed bands', kind => {
    it('uses no data from the current or preceding two bars', () => {
        const bars = Array.from({ length: 30 }, (_, i) => ({ open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i }))
        const altered = bars.map((bar, i) => i >= 27 ? { open: 400, high: 450, low: 350, close: 420 } : bar)
        const original = points(bars, kind)
        const changed = points(altered, kind)
        expect(original[29].lower).toBeTypeOf('number')
        expect(changed[29].lower).toBe(original[29].lower)
        expect(changed[29].upper).toBe(original[29].upper)
        expect(original.slice(0, 3)).toEqual([null, null, null])
    })
})
