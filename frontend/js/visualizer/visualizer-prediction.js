// Prediction overlay per series: median line, upper/lower bounds, and shaded band.
// Expects: { predictions: [{ timestamp, upper, lower, median }, ...] }
import * as d3 from 'd3'
import { toNumber } from './visualizer-data'

// Hide one series' prediction overlay elements
export function resetPredictionOverlays(renderer) {
    for (const path of Object.values(renderer.prediction)) {
        path.datum([]).attr('d', null).attr('opacity', 0)
    }
    renderer.currentPredictionPoints = null
}

/** Normalize forecast geometry once for the shared domain/drawing pass. */
export function predictionPoints(renderer, prediction) {
    const rows = prediction?.predictions
    if (!renderer.native.length || !Array.isArray(rows) || !rows.length) return []
    const last = renderer.native[renderer.native.length - 1]
    const start = renderer.lastUnionIndex
    const number = value => value == null || value === '' ? null : toNumber(value)
    return [{ x: start, median: last.close, upper: last.close, lower: last.close },
        ...rows.map((point, index) => ({ x: start + index + 1,
            median: number(point?.median), upper: number(point?.upper), lower: number(point?.lower) }))]
}

// Draw one series' prediction overlay anchored at its last native candle.
// animatePrediction(renderer, { predictions: [{ median: 10, upper: 11, lower: 9 }] }, chart)
// extends the median from renderer.native's last close at renderer.lastUnionIndex.
export function animatePrediction(renderer, prediction, chart, points = predictionPoints(renderer, prediction)) {
    if (!points.length) {
        resetPredictionOverlays(renderer)
        return
    }
    const x = point => chart.xScale(point.x)
    const bandArea = d3.area()
        .defined(point => Number.isFinite(point.upper) && Number.isFinite(point.lower))
        .x(x).y0(point => renderer.yScale(point.lower)).y1(point => renderer.yScale(point.upper))
    renderer.currentPredictionPoints = points.map(point => ({ x: point.x, y: point.median }))
    renderer.prediction.band
        .datum(points)
        .attr('d', bandArea)
        .attr('opacity', 1)
    for (const [part, field] of [['line', 'median'], ['upper', 'upper'], ['lower', 'lower']]) {
        const line = d3.line().defined(point => Number.isFinite(point[field]))
            .x(x).y(point => renderer.yScale(point[field]))
        renderer.prediction[part].datum(points).attr('d', line).attr('opacity', 1)
    }
}
