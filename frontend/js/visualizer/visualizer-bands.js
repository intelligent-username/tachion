// One geometry primitive for both historical envelopes and the forward fan.
import * as d3 from 'd3'

export const BAND_COLORS = { bollinger: '#4393c3', volatility: '#d6604d' }

/** Create passive band paths below the candle layer. */
export function createBandPaths(group, kind, dash = null) {
    const paths = {}
    for (const part of ['fill', 'upper', 'lower', 'basis']) {
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
    for (const part of ['upper', 'lower', 'basis']) {
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
        return { x: candle._i, lower: result.lower[index], upper: result.upper[index],
            basis: (result.middle ?? result.basis)[index],
            percentB: result.percentB?.[index] ?? null, bandwidth: result.bandwidth?.[index] ?? null }
    })
}

/** Toggle both envelopes independently; disabled paths release their data. */
export function drawHistoricalBands(renderer, chart) {
    for (const kind of ['bollinger', 'volatility']) {
        drawBandPaths(renderer.bands[kind], renderer.bandPoints?.[kind] ?? [], chart.xScale, renderer.yScale)
    }
}
