// Geometry primitives for historical envelopes.
import * as d3 from 'd3'

// Both displayed envelopes use information at least three native bars old.
export const BAND_LAG_BARS = 3
export const BAND_COLORS = { bollinger: '#4393c3', volatility: '#d6604d' }

/** Create passive band paths below the candle layer. */
export function createBandPaths(group, kind, dash = null) {
    const paths = {}
    for (const part of ['fill', 'upper', 'lower']) {
        paths[part] = group.append('path').attr('class', `${kind}-${part}`)
            .attr('fill', part === 'fill' ? BAND_COLORS[kind] : 'none')
            .attr('fill-opacity', kind === 'bollinger' ? 0.07 : 0.08)
            .attr('stroke', part === 'fill' ? 'none' : BAND_COLORS[kind])
            .attr('stroke-opacity', 0.55).attr('stroke-width', 1)
            .attr('stroke-dasharray', kind === 'volatility' ? (dash ? '8,3,2,3' : '4,3') : dash)
    }
    return paths
}

/** Draw only finite precomputed values, preserving native warmup/union gaps. */
export function drawBandPaths(paths, points, xScale, yScale) {
    if (!points.length) {
        for (const path of Object.values(paths)) path.datum([]).attr('d', null)
        return
    }
    const valid = point => point && Number.isFinite(point.lower) && Number.isFinite(point.upper)
    const area = d3.area().defined(valid).x(point => xScale(point.x))
        .y0(point => yScale(point.lower)).y1(point => yScale(point.upper))
    paths.fill.datum(points).attr('d', area)
    for (const part of ['upper', 'lower']) {
        const line = d3.line().defined(point => valid(point) && Number.isFinite(point[part]))
            .x(point => xScale(point.x)).y(point => yScale(point[part]))
        paths[part].datum(points).attr('d', line)
    }
}

/** Map canonical outputs onto visible union slots without recomputing math. */
export function bandPoints(renderer, kind) {
    const cached = renderer.bandData
    const result = cached?.[kind]
    if (!result) return []
    return renderer.aligned.map(candle => {
        if (!candle) return null
        const index = cached.indexByTime.get(candle.date.getTime())
        if (index == null) return null
        // Volatility intervals also validate their own bar, so shift the whole
        // result to keep every input at least three native bars behind.
        const sourceIndex = index - BAND_LAG_BARS
        if (sourceIndex < 0) return null
        const lower = result.lower[sourceIndex]
        const upper = result.upper[sourceIndex]
        const percentB = kind === 'bollinger' && Number.isFinite(candle.close)
            && Number.isFinite(lower) && Number.isFinite(upper)
            ? (upper === lower ? 0.5 : (candle.close - lower) / (upper - lower)) : null
        return { x: candle._i, lower, upper, percentB, provisional: result.provisional[sourceIndex] }
    })
}

/** Toggle both envelopes independently; disabled paths release their data. */
export function drawHistoricalBands(renderer, chart) {
    for (const kind of ['bollinger', 'volatility']) {
        drawBandPaths(renderer.bands[kind], renderer.bandPoints?.[kind] ?? [], chart.xScale, renderer.yScale)
    }
}

/** Count each exit once, using only completed five-bar follow-up windows. */
export function fiveBarReturnRate(renderer, kind) {
    const points = renderer.bandPoints?.[kind] ?? []
    const bars = renderer.native.map(candle => {
        const index = renderer.bandData?.indexByTime.get(candle.date.getTime())
        const close = index == null ? null : renderer.bandData.bars[index]?.close
        const point = points[candle._i]
        if (!Number.isFinite(close) || !Number.isFinite(point?.lower) || !Number.isFinite(point?.upper)) return null
        return close >= point.lower && close <= point.upper
    })
    let exits = 0
    let returns = 0
    for (let i = 1; i < bars.length; i++) {
        if (bars[i - 1] !== true || bars[i] !== false) continue
        const followup = bars.slice(i + 1, i + 6)
        if (followup.length < 5 || followup.some(value => value === null)) continue
        exits++
        if (followup.includes(true)) returns++
    }
    return { exits, returns, percentage: exits ? 100 * returns / exits : null }
}
