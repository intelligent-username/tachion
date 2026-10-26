// Prediction overlay: median line, upper/lower bounds, and shaded band.
// Expects: { predictions: [{ timestamp, upper, lower, median }, ...] }
// where predictions.length === Math.floor(Math.log(n)), n = currentData.length
import * as d3 from 'd3'
import { toNumber } from './visualizer-data'
import { xyLine, xyArea } from './visualizer-d3'
import { drawStyledXAxis } from './visualizer-axes'

// Hide the prediction overlay elements (used when clearing or redrawing)
export function resetPredictionOverlays(chart) {
    chart.predictionLine.attr('opacity', 0)
    chart.predictionBand.attr('opacity', 0)
    chart.predictionUpper.attr('opacity', 0)
    chart.predictionLower.attr('opacity', 0)
}

// Draw the prediction overlay anchored at the last real candle, extending the
// x axis to make room for the forecast points.
export function animatePrediction(chart, prediction) {
    if (!chart.currentData.length) return

    const pts = prediction?.predictions ?? []
    if (!pts.length) {
        resetPredictionOverlays(chart)
        return
    }

    const last = chart.currentData[chart.currentData.length - 1]
    const startX = Math.max(0, chart.currentData.length - 1)

    // Build indexed path data for each series, anchored at the last real candle
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

    // Extend xScale to make room for prediction points
    const extendedMaxX = Math.max(chart.currentMaxX, startX + pts.length)
    const xOverlayScale = chart.xScale.copy().domain([0, extendedMaxX])

    // Re-draw x axis with same tick logic
    const tickValues = Array.isArray(chart._xTickValues) && chart._xTickValues.length
        ? chart._xTickValues
        : d3.range(0, Math.min(chart.baseDates.length, 8)).map(i => i)

    const tickFormat = (v) => {
        const i = Math.round(v)
        if (i < 0 || i >= chart.baseDates.length) return ''
        if (chart._xTickLabelMap && chart._xTickLabelMap.has(i)) return chart._xTickLabelMap.get(i)
        const dt = chart.baseDates[i]
        return chart._xTickFormatter ? chart._xTickFormatter(dt) : (dt ? d3.timeFormat('%b %d')(dt) : '')
    }
    drawStyledXAxis(chart, xOverlayScale, tickValues, tickFormat)

    // Line and band generators over the overlay scale
    const lineFn = xyLine(xOverlayScale, chart.yScale)
    const bandArea = xyArea(xOverlayScale, chart.yScale, (d, i) => chart.yScale(lowerPath[i].y))

    chart.hasPrediction = true
    chart.currentPredictionPoints = medianPath
    chart.predictionBand
        .datum(upperPath)
        .attr('d', bandArea)
        .attr('opacity', 1)

    // Median line (prominent, dashed)
    chart.predictionLine
        .datum(medianPath)
        .attr('d', lineFn)

    // Upper bound line (subtle, dashed)
    chart.predictionUpper
        .datum(upperPath)
        .attr('d', lineFn)
        .attr('opacity', 1)

    // Lower bound line (subtle, dashed)
    chart.predictionLower
        .datum(lowerPath)
        .attr('d', lineFn)
        .attr('opacity', 1)

    chart.updateLineOpacities()
}
