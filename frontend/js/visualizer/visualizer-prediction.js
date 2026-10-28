// Prediction overlay per series: median line, upper/lower bounds, and shaded band.
// Expects: { predictions: [{ timestamp, upper, lower, median }, ...] }
import { toNumber } from './visualizer-data'
import { xyLine, xyArea } from './visualizer-d3'

// Hide one series' prediction overlay elements
export function resetPredictionOverlays(renderer) {
    renderer.prediction.line.attr('opacity', 0)
    renderer.prediction.band.attr('opacity', 0)
    renderer.prediction.upper.attr('opacity', 0)
    renderer.prediction.lower.attr('opacity', 0)
}

// Draw one series' prediction overlay anchored at its last native candle.
// animatePrediction(renderer, { predictions: [{ median: 10, upper: 11, lower: 9 }] }, chart)
// extends the median from renderer.native's last close at renderer.lastUnionIndex.
export function animatePrediction(renderer, prediction, chart, xScale = chart.xScale) {
    if (!renderer?.native?.length) return

    const pts = prediction?.predictions ?? []
    if (!pts.length) {
        resetPredictionOverlays(renderer)
        return
    }

    const last = renderer.native[renderer.native.length - 1]
    const startX = Number.isFinite(renderer.lastUnionIndex) ? renderer.lastUnionIndex : last._i

    // Build union-indexed path data anchored at the last native candle
    const medianPath = [
        { x: startX, y: last.close },
        ...pts.map((p, i) => ({ x: startX + i + 1, y: toNumber(p.median) }))
    ]
    const upperPath = [
        { x: startX, y: last.close },
        ...pts.map((p, i) => ({ x: startX + i + 1, y: toNumber(p.upper) }))
    ]
    const lowerPath = [
        { x: startX, y: last.close },
        ...pts.map((p, i) => ({ x: startX + i + 1, y: toNumber(p.lower) }))
    ]

    const lineFn = xyLine(xScale, renderer.yScale)
    const bandArea = xyArea(xScale, renderer.yScale, (d, i) => renderer.yScale(lowerPath[i].y))

    renderer.currentPredictionPoints = medianPath
    renderer.prediction.band
        .datum(upperPath)
        .attr('d', bandArea)
        .attr('opacity', 1)

    // Median line (prominent, dashed)
    renderer.prediction.line
        .datum(medianPath)
        .attr('d', lineFn)
        .attr('opacity', 1)

    // Upper bound line (subtle, dashed)
    renderer.prediction.upper
        .datum(upperPath)
        .attr('d', lineFn)
        .attr('opacity', 1)

    // Lower bound line (subtle, dashed)
    renderer.prediction.lower
        .datum(lowerPath)
        .attr('d', lineFn)
        .attr('opacity', 1)

    chart?.updateLineOpacities?.()
}
