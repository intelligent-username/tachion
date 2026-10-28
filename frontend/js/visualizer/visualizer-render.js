// Data series rendering: candlesticks, line/area price mode, MA/EMA overlays
import * as d3 from 'd3'
import { computeAdaptiveMovingAverage, computeExponentialMovingAverage } from './visualizer-indicators'
import { xyLine, indexLineGapped, indexAreaGapped } from './visualizer-d3'

const MA_WINDOW = 30
const EMA_PERIOD = 20

// Line/area mode: smooth close-price line with a gradient area fill underneath.
// Fades out the renderer's candlesticks first; union gaps break the path.
export function drawLineMode(renderer, chart) {
    renderer.groups.candles.selectAll('g.candle')
        .transition()
        .duration(260)
        .ease(d3.easeCubicOut)
        .attr('opacity', 0)
        .remove()

    renderer.price.area
        .datum(renderer.aligned)
        .attr('d', indexAreaGapped(chart.xScale, renderer.yScale, chart.height, renderer.native.length))
        .attr('fill', `url(#${renderer.gradientId})`)
        .transition()
        .duration(280)
        .ease(d3.easeCubicOut)
        .attr('opacity', 1)

    renderer.price.line
        .datum(renderer.aligned)
        .attr('d', indexLineGapped(chart.xScale, renderer.yScale, renderer.native.length))
        .attr('stroke', renderer.colors.line)
        .transition()
        .duration(280)
        .ease(d3.easeCubicOut)
        .attr('opacity', 1)

    renderer.price.dot.attr('opacity', 0)
}

// Hide the main price layer: candles, line, area, and dot.
export function clearMainGraph(renderer) {
    renderer.groups.candles.selectAll('*').remove()
    renderer.price.area.attr('d', null).attr('opacity', 0)
    renderer.price.line.attr('d', null).attr('opacity', 0)
    renderer.price.dot.attr('opacity', 0)
}

// Candlestick mode: per-series wick + body per native candle, fading out line mode first
export function drawCandlestickMode(renderer, chart) {
    // Fade out price line & area smoothly
    renderer.price.area.transition().duration(240).ease(d3.easeCubicOut).attr('opacity', 0)
    renderer.price.line.transition().duration(240).ease(d3.easeCubicOut).attr('opacity', 0)
    renderer.price.dot.attr('opacity', 0)

    const minSpacingPx = chart.width / Math.max(1, chart.unionDates.length - 1)
    const bodyWidth = Math.max(2, Math.min(14, minSpacingPx * 0.7))

    const candle = renderer.groups.candles
        .selectAll('g.candle')
        .data(renderer.native, d => `${d.date.toISOString()}:${d._i}`)

    candle.exit()
        .transition()
        .duration(200)
        .attr('opacity', 0)
        .remove()

    const candleEnter = candle.enter()
        .append('g')
        .attr('class', 'candle')
        .attr('opacity', 0)

    candleEnter.append('line').attr('class', 'wick')
    candleEnter.append('rect').attr('class', 'body')

    const merged = candleEnter.merge(candle)

    merged.select('line.wick')
        .attr('x1', d => chart.xScale(d._i))
        .attr('x2', d => chart.xScale(d._i))
        .attr('y1', d => renderer.yScale(d.high))
        .attr('y2', d => renderer.yScale(d.low))
        .attr('stroke-width', 1)
        .attr('stroke', d => (d.close >= d.open ? renderer.colors.up : renderer.colors.down))

    merged.select('rect.body')
        .attr('x', d => chart.xScale(d._i) - bodyWidth / 2)
        .attr('width', bodyWidth)
        .attr('y', d => renderer.yScale(Math.max(d.open, d.close)))
        .attr('height', d => Math.max(1, Math.abs(renderer.yScale(d.open) - renderer.yScale(d.close))))
        .attr('fill', d => (d.close >= d.open ? renderer.colors.up : renderer.colors.down))

    merged.transition()
        .duration(280)
        .ease(d3.easeCubicOut)
        .attr('opacity', 0.95)
}

// Optional SMA and EMA overlay lines over the current candles.
// Computed on native closes before union alignment, then mapped to union indices.
export function drawMovingAverages(renderer, chart) {
    const overlayLine = xyLine(chart.xScale, renderer.yScale)
    const native = renderer.native
    const closes = native.map(d => d.close)

    if (chart.showMovingAverage && native.length > 0) {
        const maValues = computeAdaptiveMovingAverage(closes, MA_WINDOW)
        const maPoints = native.map((d, i) => ({ x: d._i, y: maValues[i] }))
        renderer.currentMaPoints = maPoints

        renderer.indicators.maLine
            .datum(maPoints)
            .attr('d', overlayLine)
            .attr('opacity', chart.baseOpacities.ma)
    } else {
        renderer.currentMaPoints = null
        renderer.indicators.maLine.attr('opacity', 0)
    }

    if (chart.showExponentialMovingAverage && native.length > 0) {
        const emaValues = computeExponentialMovingAverage(closes, EMA_PERIOD)
        const emaPoints = native.map((d, i) => ({ x: d._i, y: emaValues[i] }))
        renderer.currentEmaPoints = emaPoints

        renderer.indicators.emaLine
            .datum(emaPoints)
            .attr('d', overlayLine)
            .attr('opacity', chart.baseOpacities.ema)
    } else {
        renderer.currentEmaPoints = null
        renderer.indicators.emaLine.attr('opacity', 0)
    }
}
