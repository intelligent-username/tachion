// D3.js Chart Visualization (30m OHLCV candlesticks) - orchestrator.
// Implementation details live in the visualizer-* helper modules; this file
// wires them together and exposes the public TChart API.
import * as d3 from 'd3'
import { clampCandlesByTimespan, clampRowsByTimespan, normalizeCandle } from './visualizer/visualizer-data'
import { CHART_MARGIN, initChartSvg } from './visualizer/visualizer-layers'
import { buildXTicks, drawAxes } from './visualizer/visualizer-axes'
import { drawLineMode, drawCandlestickMode, drawMovingAverages } from './visualizer/visualizer-render'
import { applyLineOpacities, bindHover } from './visualizer/visualizer-hover'
import { animatePrediction as drawPredictionOverlay, resetPredictionOverlays } from './visualizer/visualizer-prediction'

export class TChart {
    constructor(container) {
        this.container = container
        this.margin = CHART_MARGIN
        this.currentData = []
        this.lastTimespan = 'max'
        this.showMovingAverage = false
        this.showExponentialMovingAverage = false
        this.chartMode = 'bars' // 'bars' | 'line'
        this.upColor = '#27ae60'
        this.downColor = '#e74c3c'

        // Create the SVG structure and pull all element refs onto the instance
        Object.assign(this, initChartSvg(container))

        // Initialize scales
        this.xScale = d3.scaleLinear()
        this.yScale = d3.scaleLinear()
        this.xLabelFormat = d3.timeFormat('%b %d')
        this.baseDates = []
        this.currentMaxX = 1
        this.indexedCandles = []

        this.hoveredLine = null
        this.baseOpacities = {
            ma: 0.55,
            ema: 0.55,
            prediction: 0.85,
            price: 0.95
        }

        this.hasPrediction = false
        this.currentPredictionPoints = null
        this.currentMaPoints = null
        this.currentEmaPoints = null

        this.resizeObserver = new ResizeObserver(() => {
            this.resize()
            if (this.currentData.length) {
                this.drawCandles(this.currentData)
            }
        })
        this.resizeObserver.observe(container)

        this.resize()
    }

    updateLineOpacities() {
        applyLineOpacities(this)
    }

    resize() {
        const rect = this.container.getBoundingClientRect()
        const fullWidth = Math.max(180, rect.width)
        const fullHeight = Math.max(200, rect.height)

        this.width = Math.max(80, fullWidth - this.margin.left - this.margin.right)
        this.height = Math.max(80, fullHeight - this.margin.top - this.margin.bottom)

        this.rootSvg.attr('viewBox', `0 0 ${fullWidth} ${fullHeight}`)

        this.svg.attr('transform', `translate(${this.margin.left},${this.margin.top})`)
        this.xScale.range([0, this.width])
        this.yScale.range([this.height, 0])
        this.xAxis.attr('transform', `translate(0,${this.height})`)
        this.hoverRect
            .attr('x', 0)
            .attr('y', 0)
            .attr('width', this.width)
            .attr('height', this.height)
        this.hoverLine.attr('y2', this.height)
    }

    // Render historical candles from backend OHLCV (30m expected)
    renderHistory(data, timespan = 'max', showMovingAverage = false, chartMode = 'bars', showExponentialMovingAverage = false) {
        const rawRows = clampRowsByTimespan(data ?? [], timespan)
        let previousClose = null
        const normalized = rawRows
            .map(row => {
                const candle = normalizeCandle(row, previousClose)
                if (candle) previousClose = candle.close
                return candle
            })
            .filter(Boolean)
            .sort((a, b) => a.date - b.date)

        this.lastTimespan = timespan
        this.showMovingAverage = !!showMovingAverage
        this.showExponentialMovingAverage = !!showExponentialMovingAverage
        this.chartMode = chartMode
        this.currentData = clampCandlesByTimespan(normalized, timespan)
        this.drawCandles(this.currentData)
    }

    setChartMode(mode) {
        if (mode === this.chartMode) return
        this.chartMode = mode
        if (this.currentData.length) {
            this.drawCandles(this.currentData)
        }
    }

    drawCandles(candles) {
        if (!candles.length) {
            this.candleLayer.selectAll('*').remove()
            this.gridLayer.selectAll('*').remove()
            this.xAxis.selectAll('*').remove()
            this.yAxis.selectAll('*').remove()
            resetPredictionOverlays(this)
            return
        }

        const indexedCandles = candles.map((d, i) => ({ ...d, _i: i }))
        this.indexedCandles = indexedCandles
        const xMax = Math.max(1, indexedCandles.length - 1)
        this.currentMaxX = xMax
        this.baseDates = indexedCandles.map(d => d.date)

        const ticks = buildXTicks(this.baseDates)
        this._xTickValues = ticks.tickValues
        this._xTickLabelMap = ticks.labelMap
        this._xTickFormatter = ticks.xTickFormatter

        this.xScale.domain([0, ticks.xMax])

        const lows = candles.map(d => d.low)
        const highs = candles.map(d => d.high)
        const yMin = d3.min(lows)
        const yMax = d3.max(highs)
        const ySpan = Math.max(1e-9, yMax - yMin)
        const yPad = ySpan * 0.08

        this.yScale.domain([yMin - yPad, yMax + yPad])

        drawAxes(this, ticks)

        if (this.chartMode === 'line') {
            drawLineMode(this, indexedCandles)
        } else {
            drawCandlestickMode(this, indexedCandles)
        }

        drawMovingAverages(this, indexedCandles)

        this.hasPrediction = false
        this.currentPredictionPoints = null
        resetPredictionOverlays(this)
        this.hoveredLine = null
        this.updateLineOpacities()
        bindHover(this)
    }

    // Prediction overlay: draws median line, upper/lower bounds, and shaded band
    animatePrediction(prediction) {
        drawPredictionOverlay(this, prediction)
    }
}
