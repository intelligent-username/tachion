// D3.js Chart Visualization (30m OHLCV candlesticks) - composite series orchestrator.
// Implementation details live in the visualizer-* helper modules; this file
// wires them together and exposes the public TChart API.
import * as d3 from 'd3'
import { prepareCandles } from './visualizer/visualizer-data'
import { CHART_MARGIN, SERIES_AXIS_MARGIN_RIGHT, initChartSvg } from './visualizer/visualizer-layers'
import { buildXTicks, drawAxes, drawStyledXAxis } from './visualizer/visualizer-axes'
import { drawLineMode, drawCandlestickMode, drawMovingAverages } from './visualizer/visualizer-render'
import { applyLineOpacities, bindHover } from './visualizer/visualizer-hover'
import { animatePrediction as drawPredictionOverlay, resetPredictionOverlays } from './visualizer/visualizer-prediction'
import { createSeriesRenderer, removeSeriesRenderer } from './visualizer/visualizer-series'
import { resolveSeriesColors } from './visualizer/visualizer-colors'

const DEFAULT_OPTIONS = {
    timespan: 'max',
    chartMode: 'bars',
    showMovingAverage: false,
    showExponentialMovingAverage: false
}

const BASE_OPACITIES = {
    ma: 0.55,
    ema: 0.55,
    prediction: 0.85,
    price: 0.95
}

const LEGACY_SERIES_ID = 'series-legacy'
const MIN_FULL_WIDTH = 180
const MIN_FULL_HEIGHT = 200
const MIN_PLOT_SIZE = 80
const SIZE_EPSILON_PX = 0.5
const Y_DOMAIN_PADDING = 0.08
const EMPTY_Y_DOMAIN = [0, 1]
const SERIES_LAYER_KEYS = ['candles', 'price', 'indicators', 'prediction']

export class TChart {
    constructor(container, { onStats } = {}) {
        this.container = container
        this.initState(onStats)

        // Create the SVG structure and pull all element refs onto the instance
        Object.assign(this, initChartSvg(container))

        this.resizeObserver = new ResizeObserver(() => {
            if (!this.hasSizeChanged()) return
            this.resize()
            this.redrawFromCache()
        })
        this.resizeObserver.observe(container)

        this.resize()
    }

    initState(onStats) {
        this.margin = { ...CHART_MARGIN }
        this.currentData = []
        this.lastTimespan = DEFAULT_OPTIONS.timespan
        this.showMovingAverage = DEFAULT_OPTIONS.showMovingAverage
        this.showExponentialMovingAverage = DEFAULT_OPTIONS.showExponentialMovingAverage
        this.chartMode = DEFAULT_OPTIONS.chartMode
        this.baseOpacities = { ...BASE_OPACITIES }
        this.hoveredLine = null

        this.series = []
        this.unionDates = []
        this.unionIndexByTime = new Map()
        this.xScale = d3.scaleLinear()
        this.predictionXScale = d3.scaleLinear()
        this.appliedPredictions = {}
        this.baseDates = []
        this.currentMaxX = 1
        this._xTickValues = []
        this._xTickLabelMap = new Map()
        this._xTickFormatter = null
        this.onStats = onStats ?? null
        this.lastOptions = { ...DEFAULT_OPTIONS }
        this.lastWidth = 0
        this.lastHeight = 0
    }

    hasSizeChanged() {
        const rect = this.container.getBoundingClientRect()
        return Math.abs(rect.width - this.lastWidth) >= SIZE_EPSILON_PX ||
            Math.abs(rect.height - this.lastHeight) >= SIZE_EPSILON_PX
    }

    updateLineOpacities() {
        applyLineOpacities(this)
    }

    resize() {
        const rect = this.container.getBoundingClientRect()
        const fullWidth = Math.max(MIN_FULL_WIDTH, rect.width)
        const fullHeight = Math.max(MIN_FULL_HEIGHT, rect.height)

        this.width = Math.max(MIN_PLOT_SIZE, fullWidth - this.margin.left - this.margin.right)
        this.height = Math.max(MIN_PLOT_SIZE, fullHeight - this.margin.top - this.margin.bottom)

        this.rootSvg.attr('viewBox', `0 0 ${fullWidth} ${fullHeight}`)

        this.svg.attr('transform', `translate(${this.margin.left},${this.margin.top})`)
        this.xScale.range([0, this.width])
        this.predictionXScale.range([0, this.width])
        for (const renderer of this.series) {
            renderer.yScale.range([this.height, 0])
        }
        this.xAxis.attr('transform', `translate(0,${this.height})`)
        this.rightYAxis.attr('transform', `translate(${this.width},0)`)
        this.hoverRect
            .attr('x', 0)
            .attr('y', 0)
            .attr('width', this.width)
            .attr('height', this.height)
        this.hoverLine.attr('y2', this.height)

        this.lastWidth = rect.width
        this.lastHeight = rect.height
    }

    // Render one or more prepared series on a shared union x-axis.
    // renderSeries([{ id, symbol, assetClass, data }], options) returns this.
    renderSeries(descriptors = [], options = {}) {
        const resolved = resolveRenderOptions(this, options)
        this.lastOptions = resolved
        this.lastTimespan = resolved.timespan
        this.chartMode = resolved.chartMode
        this.showMovingAverage = resolved.showMovingAverage
        this.showExponentialMovingAverage = resolved.showExponentialMovingAverage

        const prepared = prepareSeriesDescriptors(descriptors, resolved.timespan)
        const union = buildUnionDates(prepared)
        this.unionDates = union.dates
        this.unionIndexByTime = union.indexByTime
        alignPreparedSeries(prepared, this.unionIndexByTime, this.unionDates.length)

        syncRenderers(this, prepared)
        const ticks = updateAxisState(this)

        if (this.unionDates.length === 0) {
            clearEmptyChart(this)
            return this
        }

        drawAxes(this, ticks)
        drawPreparedSeries(this)

        // The data pass resets prediction overlays; predictions re-apply when the map changes.
        this.appliedPredictions = {}
        this.predictionXScale = this.xScale.copy()
        return this
    }

    // Re-run the drawing pass over cached series without re-normalizing rows.
    redrawFromCache() {
        if (!this.unionDates.length) return

        const ticks = {
            xMax: this.currentMaxX,
            tickValues: this._xTickValues,
            labelMap: this._xTickLabelMap,
            xTickFormatter: this._xTickFormatter
        }
        drawAxes(this, ticks)

        for (const renderer of this.series) {
            if (!renderer.native.length) continue
            if (this.chartMode === 'line') {
                drawLineMode(renderer, this)
            } else {
                drawCandlestickMode(renderer, this)
            }
            drawMovingAverages(renderer, this)
        }

        bindHover(this)
        this.updateLineOpacities()

        if (Object.keys(this.appliedPredictions ?? {}).length > 0) {
            this.applyPredictions(this.appliedPredictions)
        }
    }

    // Backward-compatible single-series entry point.
    renderHistory(data, timespan = 'max', showMovingAverage = false, chartMode = 'bars', showExponentialMovingAverage = false) {
        return this.renderSeries([{
            id: LEGACY_SERIES_ID,
            symbol: '',
            assetClass: '',
            data
        }], { timespan, chartMode, showMovingAverage, showExponentialMovingAverage })
    }

    // Prediction overlays per series: draws median line, bounds, and band on each
    // series' own yScale, extending the x-axis to the furthest forecast.
    // applyPredictions({ [seriesId]: { predictions: [{ median, upper, lower }] } }) returns this.
    applyPredictions(map) {
        const entries = Object.entries(map ?? {})
        this.appliedPredictions = map ?? {}
        clearUnpredictedRenderers(this, new Set(entries.map(([id]) => id)))

        if (entries.length === 0) {
            this.predictionXScale = this.xScale.copy()
            // An empty chart must stay axis-free: the data pass already cleared it.
            if (this.unionDates.length === 0) {
                this.xAxis.selectAll('*').remove()
                this.updateLineOpacities()
                return this
            }
            drawPredictionAxis(this)
            this.updateLineOpacities()
            return this
        }

        this.predictionXScale = this.xScale.copy().domain([0, resolveMaxExtendedX(this, entries)])
        drawPredictionAxis(this)

        for (const [id, prediction] of entries) {
            const renderer = this.series.find(series => series.id === id)
            if (!renderer) continue
            if (!prediction?.predictions?.length) renderer.currentPredictionPoints = null
            drawPredictionOverlay(renderer, prediction, this, this.predictionXScale)
        }

        this.updateLineOpacities()
        return this
    }

    // Backward-compatible single-series prediction entry point.
    animatePrediction(prediction) {
        const renderer = this.series[0]
        if (!renderer) return
        this.applyPredictions({ [renderer.id]: prediction })
    }

    getSeriesData(id) {
        const native = this.series.find(renderer => renderer.id === id)?.native ?? []
        return native.map(candle => {
            const copy = { ...candle }
            delete copy._i
            return copy
        })
    }

    getSeriesSnapshot(id) {
        const renderer = this.series.find(series => series.id === id)
        return {
            symbol: renderer?.symbol ?? null,
            timespan: this.lastTimespan,
            data: this.getSeriesData(id)
        }
    }

    destroy() {
        this.resizeObserver?.disconnect()
        this.tooltip?.remove()
        d3.select(this.container).selectAll('*').remove()
        this.series = []
    }
}

// Resolve per-render options, falling back to the previous call's values.
function resolveRenderOptions(chart, options) {
    return {
        timespan: options.timespan ?? chart.lastOptions.timespan,
        chartMode: options.chartMode ?? chart.lastOptions.chartMode,
        showMovingAverage: !!(options.showMovingAverage ?? chart.lastOptions.showMovingAverage),
        showExponentialMovingAverage: !!(options.showExponentialMovingAverage ?? chart.lastOptions.showExponentialMovingAverage)
    }
}

// Normalize each descriptor's raw rows into native candles independently.
function prepareSeriesDescriptors(descriptors, timespan) {
    return (descriptors ?? []).map(descriptor => ({
        ...descriptor,
        native: prepareCandles(descriptor.data ?? [], timespan)
    }))
}

// Collect every timestamp across all series into sorted union dates.
function buildUnionDates(prepared) {
    const times = []
    const seen = new Set()

    for (const series of prepared) {
        for (const candle of series.native) {
            const time = candle.date.getTime()
            if (seen.has(time)) continue
            seen.add(time)
            times.push(time)
        }
    }

    times.sort((a, b) => a - b)
    return {
        dates: times.map(time => new Date(time)),
        indexByTime: new Map(times.map((time, index) => [time, index]))
    }
}

// Assign union indices and place each native candle into its aligned slot.
function alignPreparedSeries(prepared, indexByTime, unionLength) {
    for (const series of prepared) {
        const aligned = new Array(unionLength).fill(null)

        for (const candle of series.native) {
            const index = indexByTime.get(candle.date.getTime())
            if (index == null) continue
            candle._i = index
            aligned[index] = candle
        }

        series.aligned = aligned
        series.lastUnionIndex = series.native.length
            ? series.native[series.native.length - 1]._i
            : 0
    }
}

// Remove stale renderers, reserve the right axis margin, then reconcile.
function syncRenderers(chart, prepared) {
    const nextIds = new Set(prepared.map(series => series.id))
    chart.series = chart.series.filter(renderer => {
        if (nextIds.has(renderer.id)) return true
        removeSeriesRenderer(chart, renderer)
        return false
    })

    const visibleCount = prepared.filter(series => series.native.length > 0).length
    chart.margin = {
        ...CHART_MARGIN,
        right: visibleCount >= 2 ? SERIES_AXIS_MARGIN_RIGHT : CHART_MARGIN.right
    }
    chart.resize()

    const existingById = new Map(chart.series.map(renderer => [renderer.id, renderer]))
    chart.series = prepared.map((series, index) => reconcileRenderer(
        chart, series, index, visibleCount, existingById
    ))
    applySeriesZOrder(chart)
}

// Reuse a renderer when its gradient still matches; otherwise rebuild it.
function reconcileRenderer(chart, series, index, total, existingById) {
    const colors = resolveSeriesColors(index, total)
    let renderer = existingById.get(series.id)

    if (renderer && renderer.gradientId !== colors.gradientId) {
        removeSeriesRenderer(chart, renderer)
        renderer = null
    }
    if (!renderer) {
        renderer = createSeriesRenderer(chart, { id: series.id, index, colors })
    }

    renderer.index = index
    renderer.symbol = series.symbol
    renderer.assetClass = series.assetClass
    renderer.colors = colors
    renderer.native = series.native
    renderer.aligned = series.aligned
    renderer.lastUnionIndex = series.lastUnionIndex
    renderer.yScale.range([chart.height, 0])
    applyNativeYDomain(renderer)
    return renderer
}

// Pad the native low/high span by 8%, matching the single-series chart.
function applyNativeYDomain(renderer) {
    if (!renderer.native.length) {
        renderer.yScale.domain([...EMPTY_Y_DOMAIN])
        return
    }

    const yMin = d3.min(renderer.native, candle => candle.low)
    const yMax = d3.max(renderer.native, candle => candle.high)
    const ySpan = Math.max(1e-9, yMax - yMin)
    const yPad = ySpan * Y_DOMAIN_PADDING

    renderer.yScale.domain([yMin - yPad, yMax + yPad])
}

// Keep series groups stacked in array order inside every layer.
function applySeriesZOrder(chart) {
    for (const key of SERIES_LAYER_KEYS) {
        for (const renderer of chart.series) {
            renderer.groups[key].raise()
        }
    }
}

// Refresh cached x-axis state from the union dates and return its ticks.
function updateAxisState(chart) {
    chart.currentData = chart.series[0]?.native ?? []
    chart.baseDates = chart.unionDates
    chart.currentMaxX = Math.max(1, chart.unionDates.length - 1)
    chart.xScale.domain([0, chart.currentMaxX])

    const ticks = buildXTicks(chart.unionDates)
    chart._xTickValues = ticks.tickValues
    chart._xTickLabelMap = ticks.labelMap
    chart._xTickFormatter = ticks.xTickFormatter
    return ticks
}

// Hide overlays for renderers that are absent from the predictions map.
function clearUnpredictedRenderers(chart, predictedIds) {
    for (const renderer of chart.series) {
        if (predictedIds.has(renderer.id)) continue
        resetPredictionOverlays(renderer)
        renderer.currentPredictionPoints = null
    }
}

// Furthest x index across all forecast series, never below the historical max.
function resolveMaxExtendedX(chart, entries) {
    return Math.max(
        chart.currentMaxX,
        ...entries.map(([id, prediction]) => {
            const renderer = chart.series.find(series => series.id === id)
            return renderer ? renderer.lastUnionIndex + (prediction?.predictions?.length ?? 0) : 0
        })
    )
}

// Redraw the x-axis against the current prediction scale.
function drawPredictionAxis(chart) {
    drawStyledXAxis(
        chart,
        chart.predictionXScale,
        resolvePredictionTickValues(chart),
        (v) => formatPredictionTick(chart, v)
    )
}

// Tick positions for the prediction-extended x-axis; fall back to a small range.
function resolvePredictionTickValues(chart) {
    if (chart._xTickValues.length) return chart._xTickValues
    return d3.range(0, Math.min(chart.baseDates.length, 8))
}

// Label lookup for extended-axis ticks, preferring the cached union labels.
function formatPredictionTick(chart, value) {
    const index = Math.round(value)
    const date = chart.baseDates[index]
    if (!date) return ''

    const cached = chart._xTickLabelMap.get(index)
    if (cached != null) return cached

    const formatted = chart._xTickFormatter?.(date)
    if (formatted) return formatted
    return d3.timeFormat('%b %d')(date) || ''
}

// Clear axes, grid, and every series group when no series has dates.
function clearEmptyChart(chart) {
    chart.gridLayer.selectAll('*').remove()
    chart.xAxis.selectAll('*').remove()
    chart.leftYAxis.selectAll('*').remove()
    chart.rightYAxis.selectAll('*').remove()
    chart.rightYAxis.style('display', 'none')

    for (const renderer of chart.series) {
        clearEmptyRenderer(renderer)
    }

    chart.hoveredLine = null
    chart.hoverLine.attr('opacity', 0)
    chart.tooltip.style('opacity', 0)
    chart.appliedPredictions = {}
    chart.predictionXScale = chart.xScale.copy()
    chart.onStats?.([])
}

// Draw every populated renderer, then reset stale prediction overlays.
function drawPreparedSeries(chart) {
    for (const renderer of chart.series) {
        if (!renderer.native.length) {
            clearEmptyRenderer(renderer)
            continue
        }

        if (chart.chartMode === 'line') {
            drawLineMode(renderer, chart)
        } else {
            drawCandlestickMode(renderer, chart)
        }
        drawMovingAverages(renderer, chart)
    }

    for (const renderer of chart.series) {
        resetPredictionOverlays(renderer)
        renderer.currentPredictionPoints = null
    }

    chart.hoveredLine = null
    bindHover(chart)
    chart.updateLineOpacities()
    chart.onStats?.(computeSeriesStats(chart))
}

// Hide a renderer whose series has no native candles.
function clearEmptyRenderer(renderer) {
    renderer.groups.candles.selectAll('*').remove()
    renderer.price.area.attr('d', null).attr('opacity', 0)
    renderer.price.line.attr('d', null).attr('opacity', 0)
    renderer.price.dot.attr('opacity', 0)
    renderer.indicators.maLine.attr('d', null).attr('opacity', 0)
    renderer.indicators.emaLine.attr('d', null).attr('opacity', 0)
    renderer.prediction.line.attr('d', null)
    renderer.prediction.band.attr('d', null)
    renderer.prediction.upper.attr('d', null)
    renderer.prediction.lower.attr('d', null)
    renderer.currentMaPoints = null
    renderer.currentEmaPoints = null
    renderer.currentPredictionPoints = null
    resetPredictionOverlays(renderer)
}

// Per-series visible-range stats consumed by the legend.
function computeSeriesStats(chart) {
    return chart.series
        .filter(renderer => renderer.native.length > 0)
        .map(renderer => {
            const first = renderer.native[0]
            const last = renderer.native[renderer.native.length - 1]
            return {
                id: renderer.id,
                symbol: renderer.symbol,
                color: renderer.colors.line,
                lastClose: last.close,
                pctChange: first.close ? ((last.close - first.close) / first.close) * 100 : null
            }
        })
}
