import { drawBandPaths } from './visualizer-bands'

/** Anchor canonical fan values at the last usable OHLC close, not a union offset. */
export function fanPoints(renderer, chart) {
    const cached = renderer.bandData
    const fan = chart.showVolatilityBands ? cached?.volatility?.fan : null
    if (!fan || !renderer.native.length) return []
    let last = null
    for (let i = cached.bars.length - 1; i >= 0; i--) {
        const bar = cached.bars[i]
        if ([bar.open, bar.high, bar.low, bar.close].every(value => Number.isFinite(value) && value > 0)) {
            last = bar
            break
        }
    }
    const start = last ? chart.unionIndexByTime.get(last.date.getTime()) : null
    if (start == null) return []
    return [{ x: start, lower: last.close, upper: last.close, basis: last.close },
        ...fan.upper.map((upper, i) => ({ x: start + i + 1, upper, lower: fan.lower[i], basis: last.close }))]
}

/** Reuse band geometry for the frozen-volatility future tail. */
export function drawFan(renderer, chart) {
    drawBandPaths(renderer.bands.fan, renderer.bandPoints?.fan ?? [], chart.xScale, renderer.yScale)
}
