// Data series rendering: candlesticks, line/area price mode, MA/EMA overlays
import * as d3 from 'd3'
import { computeAdaptiveMovingAverage, computeExponentialMovingAverage } from './visualizer-indicators'
import { xyLine, indexLine, indexArea } from './visualizer-d3'

// Line/area mode: smooth close-price line with a gradient area fill underneath.
// Fades out candlestick elements smoothly first.
export function drawLineMode(chart, indexedCandles) {
    chart.candleLayer.selectAll('g.candle')
        .transition()
        .duration(260)
        .ease(d3.easeCubicOut)
        .attr('opacity', 0)
        .remove()

    // Draw with a sleek neutral color and gradient
    const neutralColor = 'rgba(238, 238, 238, 0.9)'
    const gradId = 'url(#price-area-gradient-neutral)'

    chart.priceArea
        .datum(indexedCandles)
        .attr('d', indexArea(chart.xScale, chart.yScale, chart.height, indexedCandles.length))
        .attr('fill', gradId)
        .transition()
        .duration(280)
        .ease(d3.easeCubicOut)
        .attr('opacity', 1)

    chart.priceLine
        .datum(indexedCandles)
        .attr('d', indexLine(chart.xScale, chart.yScale, indexedCandles.length))
        .attr('stroke', neutralColor)
        .transition()
        .duration(280)
        .ease(d3.easeCubicOut)
        .attr('opacity', 1)

    chart.priceHoverDot
        .attr('fill', neutralColor)
        .attr('opacity', 0)
}

// Candlestick mode: green/red wick + body per candle, fading out line mode first
export function drawCandlestickMode(chart, indexedCandles) {
    // Fade out price line & area smoothly
    chart.priceArea.transition().duration(240).ease(d3.easeCubicOut).attr('opacity', 0)
    chart.priceLine.transition().duration(240).ease(d3.easeCubicOut).attr('opacity', 0)
    chart.priceHoverDot.attr('opacity', 0)

    const minSpacingPx = indexedCandles.length > 1
        ? chart.width / (indexedCandles.length - 1)
        : chart.width
    const bodyWidth = Math.max(2, Math.min(14, (minSpacingPx || chart.width) * 0.7))

    const candle = chart.candleLayer
        .selectAll('g.candle')
        .data(indexedCandles, d => `${d.date.toISOString()}:${d._i}`)

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
        .attr('y1', d => chart.yScale(d.high))
        .attr('y2', d => chart.yScale(d.low))
        .attr('stroke-width', 1)
        .attr('stroke', d => (d.close >= d.open ? chart.upColor : chart.downColor))

    merged.select('rect.body')
        .attr('x', d => chart.xScale(d._i) - bodyWidth / 2)
        .attr('width', bodyWidth)
        .attr('y', d => chart.yScale(Math.max(d.open, d.close)))
        .attr('height', d => Math.max(1, Math.abs(chart.yScale(d.open) - chart.yScale(d.close))))
        .attr('fill', d => (d.close >= d.open ? chart.upColor : chart.downColor))

    merged.transition()
        .duration(280)
        .ease(d3.easeCubicOut)
        .attr('opacity', 0.95)
}

// Optional SMA and EMA overlay lines over the current candles
export function drawMovingAverages(chart, indexedCandles) {
    const overlayLine = xyLine(chart.xScale, chart.yScale)

    if (chart.showMovingAverage && indexedCandles.length > 0) {
        const maWindow = 30
        const closes = indexedCandles.map(d => d.close)
        const maValues = computeAdaptiveMovingAverage(closes, maWindow)
        const maPoints = indexedCandles.map((d, i) => ({ x: d._i, y: maValues[i] }))
        chart.currentMaPoints = maPoints

        chart.movingAverageLine
            .datum(maPoints)
            .attr('d', overlayLine)
            .attr('opacity', chart.baseOpacities.ma)
    } else {
        chart.currentMaPoints = null
        chart.movingAverageLine.attr('opacity', 0)
    }

    if (chart.showExponentialMovingAverage && indexedCandles.length > 0) {
        const emaPeriod = 20
        const closes = indexedCandles.map(d => d.close)
        const emaValues = computeExponentialMovingAverage(closes, emaPeriod)
        const emaPoints = indexedCandles.map((d, i) => ({ x: d._i, y: emaValues[i] }))
        chart.currentEmaPoints = emaPoints

        chart.exponentialMovingAverageLine
            .datum(emaPoints)
            .attr('d', overlayLine)
            .attr('opacity', chart.baseOpacities.ema)
    } else {
        chart.currentEmaPoints = null
        chart.exponentialMovingAverageLine.attr('opacity', 0)
    }
}
