// Per-series SVG element creation/removal: groups, gradient, price, indicators, prediction
import * as d3 from 'd3'
import { MA_COLOR, EMA_COLOR } from './visualizer-colors'

const PRICE_LINE_STROKE_WIDTH = 2.2
const INDICATOR_STROKE_WIDTH = 1.8
const PREDICTION_STROKE_WIDTH = 1.8
const BAND_STROKE_WIDTH = 1

// Appends one scoped group per layer for a single series and creates its elements.
// createSeriesRenderer(root, { id: 'series-1', index: 1, colors }) returns
// { id, index, yScale, groups, candles, price, indicators, prediction, ... }.
export function createSeriesRenderer(root, { id, index, colors }) {
    const candles = root.seriesCandlesLayer.append('g')
        .attr('class', 'series-candles')
        .attr('data-series-id', id)

    const price = root.seriesPriceLayer.append('g')
        .attr('class', 'series-price')
        .attr('data-series-id', id)

    const indicators = root.indicatorLayer.append('g')
        .attr('class', 'series-indicators')
        .attr('data-series-id', id)

    const prediction = root.predictionLayer.append('g')
        .attr('class', 'series-prediction')
        .attr('data-series-id', id)

    const gradientId = createAreaGradient(root.defs, colors)

    const area = price.append('path')
        .attr('class', 'series-price-area')
        .attr('fill', `url(#${gradientId})`)
        .attr('opacity', 0)

    const line = price.append('path')
        .attr('class', 'series-price-line')
        .attr('fill', 'none')
        .attr('stroke', colors.line)
        .attr('stroke-width', PRICE_LINE_STROKE_WIDTH)
        .attr('stroke-linejoin', 'round')
        .attr('stroke-linecap', 'round')
        .attr('opacity', 0)
        .style('cursor', 'pointer')
        .style('transition', 'opacity 0.2s ease, stroke-width 0.2s ease')

    const dot = price.append('circle')
        .attr('class', 'series-price-dot')
        .attr('r', 5)
        .attr('fill', colors.line)
        .attr('stroke', '#ffffff')
        .attr('stroke-width', 2)
        .attr('opacity', 0)

    const maLine = createIndicatorLine(indicators, 'series-ma-line', MA_COLOR)
    const emaLine = createIndicatorLine(indicators, 'series-ema-line', EMA_COLOR)

    if (colors.dash) {
        maLine.attr('stroke-dasharray', colors.dash)
        emaLine.attr('stroke-dasharray', colors.dash)
    }

    const predictionLine = prediction.append('path')
        .attr('class', 'series-prediction-line')
        .attr('fill', 'none')
        .attr('stroke', 'rgba(114, 137, 218, 0.95)')
        .attr('stroke-width', PREDICTION_STROKE_WIDTH)
        .attr('stroke-dasharray', '3,3')
        .attr('opacity', 0)
        .style('cursor', 'pointer')
        .style('transition', 'opacity 0.2s ease, stroke-width 0.2s ease')

    const band = prediction.append('path')
        .attr('class', 'series-prediction-band')
        .attr('fill', 'rgba(67, 78, 117, 0.1)')
        .attr('stroke', 'none')
        .attr('opacity', 0)
        .style('transition', 'opacity 0.2s ease')

    const upper = prediction.append('path')
        .attr('class', 'series-prediction-upper')
        .attr('fill', 'none')
        .attr('stroke', 'rgba(37, 119, 115, 0.45)')
        .attr('stroke-width', BAND_STROKE_WIDTH)
        .attr('stroke-dasharray', '2,2')
        .attr('opacity', 0)
        .style('transition', 'opacity 0.2s ease')

    const lower = prediction.append('path')
        .attr('class', 'series-prediction-lower')
        .attr('fill', 'none')
        .attr('stroke', 'rgba(146, 81, 28, 0.45)')
        .attr('stroke-width', BAND_STROKE_WIDTH)
        .attr('stroke-dasharray', '2,2')
        .attr('opacity', 0)
        .style('transition', 'opacity 0.2s ease')

    return {
        id,
        index,
        yScale: d3.scaleLinear(),
        groups: { candles, price, indicators, prediction },
        candles: {},
        price: { area, line, dot },
        indicators: { maLine, emaLine },
        prediction: { line, band, upper, lower },
        currentMaPoints: null,
        currentEmaPoints: null,
        currentPredictionPoints: null,
        lastUnionIndex: 0,
        gradientId
    }
}

// Removes every group and the area gradient owned by `renderer`.
export function removeSeriesRenderer(root, renderer) {
    renderer.groups.candles.remove()
    renderer.groups.price.remove()
    renderer.groups.indicators.remove()
    renderer.groups.prediction.remove()

    if (renderer.gradientId) {
        root.defs.select(`linearGradient[id="${renderer.gradientId}"]`).remove()
    }
}

// Adds the per-series vertical area gradient with the shared stop profile.
function createAreaGradient(defs, colors) {
    const gradient = defs.append('linearGradient')
        .attr('id', colors.gradientId)
        .attr('x1', '0%').attr('y1', '0%')
        .attr('x2', '0%').attr('y2', '100%')

    gradient.append('stop')
        .attr('offset', '0%')
        .attr('stop-color', colors.gradientFrom)
        .attr('stop-opacity', 0.22)
    gradient.append('stop')
        .attr('offset', '80%')
        .attr('stop-color', colors.gradientTo)
        .attr('stop-opacity', 0.04)
    gradient.append('stop')
        .attr('offset', '100%')
        .attr('stop-color', colors.gradientTo)
        .attr('stop-opacity', 0)

    return colors.gradientId
}

// Creates a dashed-or-solid MA/EMA overlay path inside the indicator group.
function createIndicatorLine(group, className, stroke) {
    return group.append('path')
        .attr('class', className)
        .attr('fill', 'none')
        .attr('stroke', stroke)
        .attr('stroke-width', INDICATOR_STROKE_WIDTH)
        .attr('opacity', 0)
        .style('cursor', 'pointer')
        .style('transition', 'opacity 0.2s ease, stroke-width 0.2s ease')
}
