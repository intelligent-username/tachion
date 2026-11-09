// D3.js Chart Visualization (30m OHLCV candlesticks) - composite series orchestrator.
// Implementation details live in the visualizer-* helper modules; this file
// wires them together and exposes the public TChart API.
import * as d3 from 'd3'
import { prepareCandles, filterCandlesByRange, normalizeRange } from './visualizer/visualizer-data'
import { CHART_MARGIN, SERIES_AXIS_MARGIN_RIGHT, initChartSvg } from './visualizer/visualizer-layers'
import { buildXTicks, drawAxes } from './visualizer/visualizer-axes'
import { drawLineMode, drawCandlestickMode, drawMovingAverages, clearMainGraph } from './visualizer/visualizer-render'
import { applyLineOpacities, bindHover } from './visualizer/visualizer-hover'
import { animatePrediction as drawPredictionOverlay, predictionPoints, resetPredictionOverlays } from './visualizer/visualizer-prediction'
import { createSeriesRenderer, removeSeriesRenderer } from './visualizer/visualizer-series'
import { resolveSeriesColors } from './visualizer/visualizer-colors'
import { getBandIndicators } from './visualizer/visualizer-indicators'
import { bandPoints, drawBandPaths, drawHistoricalBands, fiveBarReturnRate } from './visualizer/visualizer-bands'
import { bindRangeSelect } from './visualizer/visualizer-range'

const DEFAULT_OPTIONS = {
    timespan: 'max',
    chartMode: 'bars',
    showMovingAverage: false,
    showExponentialMovingAverage: false,
    showBollingerBands: false,
    showVolatilityBands: false,
    range: null,
    tooltipFields: {
        price: true,
        time: true,
        open: true,
        high: true,
        low: true,
        volume: true
    }
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
const Y_DOMAIN_TOP_PADDING = 0.05
const Y_DOMAIN_BOTTOM_PADDING = 0.05
const EMPTY_Y_DOMAIN = [0, 1]
const SERIES_LAYER_KEYS = ['bands', 'candles', 'price', 'indicators', 'prediction']

export class TChart {
    constructor(container, { onStats, onRangeSelect } = {}) {
        this.container = container
        this.initState(onStats, onRangeSelect)

        // Create the SVG structure and pull all element refs onto the instance
        Object.assign(this, initChartSvg(container))
        bindRangeSelect(this)

        this.resizeObserver = new ResizeObserver(() => {
            if (!this.hasSizeChanged()) return
            this.redrawFromCache()
        })
        this.resizeObserver.observe(container)

        this.resize()
    }

    initState(onStats, onRangeSelect) {
        this.margin = { ...CHART_MARGIN }
        this.currentData = []
        this.lastTimespan = DEFAULT_OPTIONS.timespan
        this.showMovingAverage = DEFAULT_OPTIONS.showMovingAverage
        this.showExponentialMovingAverage = DEFAULT_OPTIONS.showExponentialMovingAverage
        this.showBollingerBands = DEFAULT_OPTIONS.showBollingerBands
        this.showVolatilityBands = DEFAULT_OPTIONS.showVolatilityBands
        this.chartMode = DEFAULT_OPTIONS.chartMode
        this.baseOpacities = { ...BASE_OPACITIES }
        this.hoveredLine = null

        this.series = []
        this.unionDates = []
        this.unionIndexByTime = new Map()
        this.xScale = d3.scaleLinear()
        this.appliedPredictions = {}
        this.baseDates = []
        this.currentMaxX = 1
        this._xTickValues = []
        this._xTickLabelMap = new Map()
        this._xTickFormatter = null
        this.selectedRange = null
        this.rangeDrag = null
        this.onStats = onStats ?? null
        this.onRangeSelect = onRangeSelect ?? null
        this.lastOptions = { ...DEFAULT_OPTIONS, tooltipFields: { ...DEFAULT_OPTIONS.tooltipFields } }
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
        this.showBollingerBands = resolved.showBollingerBands
        this.showVolatilityBands = resolved.showVolatilityBands
        this.tooltipFields = resolved.tooltipFields

        const prepared = prepareSeriesDescriptors(descriptors, resolved)
        this.selectedRange = resolved.range
        if (!applyRangeSelection(prepared, this.selectedRange)) {
            this.selectedRange = null
            this.onRangeSelect?.(null)
            applyRangeSelection(prepared, null)
        }
        const union = buildUnionDates(prepared)
        this.unionDates = union.dates
        this.unionIndexByTime = union.indexByTime
        alignPreparedSeries(prepared, this.unionIndexByTime, this.unionDates.length)

        syncRenderers(this, prepared)
        updateAxisState(this)
        drawChart(this)
        return this
    }

    // Re-run the drawing pass over cached series without re-normalizing rows.
    redrawFromCache() {
        drawChart(this)
        return this
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
        this.appliedPredictions = { ...(map ?? {}) }
        drawChart(this)
        return this
    }

    // Backward-compatible single-series prediction entry point.
    animatePrediction(prediction) {
        const renderer = this.series[0]
        if (!renderer) return
        this.applyPredictions({ [renderer.id]: prediction })
    }

    getSeriesData(id) {
        const native = this.series.find(renderer => renderer.id === id)?.fullNative ?? []
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
        for (const renderer of this.series) removeSeriesRenderer(this, renderer)
        this.tooltip?.remove()
        d3.select(this.container).selectAll('*').remove()
        this.series = []
        this.appliedPredictions = {}
        this.currentData = []
        this.unionDates = []
        this.unionIndexByTime.clear()
        this.baseDates = []
        this.selectedRange = null
        this.rangeDrag = null
        this.onRangeSelect = null
        this.onStats = null
    }
}

// Resolve per-render options, falling back to the previous call's values.
function resolveRenderOptions(chart, options) {
    return {
        timespan: options.timespan ?? chart.lastOptions.timespan,
        chartMode: options.chartMode ?? chart.lastOptions.chartMode,
        showMovingAverage: !!(options.showMovingAverage ?? chart.lastOptions.showMovingAverage),
        showExponentialMovingAverage: !!(options.showExponentialMovingAverage ?? chart.lastOptions.showExponentialMovingAverage),
        showBollingerBands: !!(options.showBollingerBands ?? chart.lastOptions.showBollingerBands),
        showVolatilityBands: !!(options.showVolatilityBands ?? chart.lastOptions.showVolatilityBands),
        range: normalizeRange(options.range !== undefined ? options.range : chart.lastOptions.range),
        tooltipFields: options.tooltipFields ?? chart.lastOptions.tooltipFields
    }
}

// Normalize each descriptor's raw rows into native candles independently.
function prepareSeriesDescriptors(descriptors, options) {
    return (descriptors ?? []).map(descriptor => ({
        ...descriptor,
        native: prepareCandles(descriptor.data ?? [], options.timespan),
        bandData: getBandIndicators(descriptor)
    }))
}

// Slice prepared candles to the selected range while retaining the full set
// for prediction snapshots and for restoring the view on Reset.
function applyRangeSelection(prepared, range) {
    let matched = false
    for (const series of prepared) {
        if (!series.fullNative) series.fullNative = series.native
        series.native = range
            ? filterCandlesByRange(series.fullNative, range)
            : series.fullNative
        if (range && series.native.length >= 2) matched = true
    }
    return !range || matched
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
    const existingById = new Map(chart.series.map(renderer => [renderer.id, renderer]))
    // Release all changing position-owned gradients before creating any new
    // renderer; a reorder must not delete a gradient just claimed by its peer.
    prepared.forEach((series, index) => {
        const renderer = existingById.get(series.id)
        if (!renderer || renderer.gradientId === resolveSeriesColors(index, visibleCount).gradientId) return
        removeSeriesRenderer(chart, renderer)
        existingById.delete(series.id)
    })
    chart.series = prepared.map((series, index) => reconcileRenderer(
        chart, series, index, visibleCount, existingById
    ))
    applySeriesZOrder(chart)
}

// Reuse a renderer when its gradient still matches; otherwise rebuild it.
function reconcileRenderer(chart, series, index, total, existingById) {
    const colors = resolveSeriesColors(index, total)
    let renderer = existingById.get(series.id)

    if (!renderer) {
        renderer = createSeriesRenderer(chart, { id: series.id, index, colors })
    }

    renderer.index = index
    renderer.symbol = series.symbol
    renderer.assetClass = series.assetClass
    renderer.hiddenLevel = series.hiddenLevel ?? 0
    renderer.colors = colors
    renderer.native = series.native
    renderer.fullNative = series.fullNative ?? series.native
    renderer.bandData = series.bandData
    renderer.aligned = series.aligned
    renderer.lastUnionIndex = series.lastUnionIndex
    renderer.yScale.range([chart.height, 0])
    return renderer
}

// Keep the scale stable across band toggles by reserving room for both envelopes.
function applyNativeYDomain(renderer, includeOverlays = true) {
    if (!renderer.native.length) {
        renderer.yScale.domain([...EMPTY_Y_DOMAIN])
        return
    }

    let yMin = Infinity
    let yMax = -Infinity
    const include = value => {
        if (!Number.isFinite(value)) return
        yMin = Math.min(yMin, value)
        yMax = Math.max(yMax, value)
    }
    for (const candle of renderer.native) { include(candle.low); include(candle.high) }
    if (includeOverlays) {
        for (const points of [bandPoints(renderer, 'bollinger'), bandPoints(renderer, 'volatility')]) {
            for (const point of points) {
                if (!point) continue
                include(point.lower); include(point.upper)
            }
        }
        for (const point of renderer.predictionPoints) {
            include(point.lower); include(point.upper); include(point.median)
        }
    }
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
        renderer.yScale.domain([...EMPTY_Y_DOMAIN])
        return
    }
    const ySpan = yMax > yMin ? yMax - yMin : Math.max(Math.abs(yMax) * 0.01, 1e-9)
    renderer.yScale.domain([yMin - ySpan * Y_DOMAIN_BOTTOM_PADDING,
        yMax + ySpan * Y_DOMAIN_TOP_PADDING])
}

// Keep series groups stacked in array order inside every layer.
function applySeriesZOrder(chart) {
    for (const key of SERIES_LAYER_KEYS) {
        for (const renderer of chart.series) {
            renderer.groups[key].raise()
        }
    }
}

// Refresh historical tick labels only when the union dates change.
function updateAxisState(chart) {
    chart.currentData = chart.series[0]?.native ?? []
    chart.baseDates = chart.unionDates
    const ticks = buildXTicks(chart.unionDates)
    chart._xTickValues = ticks.tickValues
    chart._xTickLabelMap = ticks.labelMap
    chart._xTickFormatter = ticks.xTickFormatter
}

// History and model forecasts share the same index-to-pixel mapping.
function resolveMaxExtendedX(chart) {
    let maxX = Math.max(1, chart.unionDates.length - 1)
    for (const renderer of chart.series) {
        const endpoint = renderer.predictionPoints?.[renderer.predictionPoints.length - 1]?.x
        if (Number.isFinite(endpoint)) maxX = Math.max(maxX, endpoint)
    }
    return maxX
}

// Every public update enters here; no redraw path calls another public update.
function drawChart(chart) {
    // Use fullNative so a forecast survives a zoom whose range excludes that
    // series; it is hidden while zoomed and must return on Reset.
    const populated = new Set(chart.series
        .filter(renderer => renderer.native.length || renderer.fullNative?.length)
        .map(renderer => renderer.id))
    chart.appliedPredictions = Object.fromEntries(Object.entries(chart.appliedPredictions)
        .filter(([id, prediction]) => populated.has(id) && prediction?.predictions?.length))
    chart.resize()
    if (!chart.unionDates.length) { clearEmptyChart(chart); return }

    const rangeActive = !!chart.selectedRange
    for (const renderer of chart.series) {
        const eligible = renderer.native.length && renderer.assetClass !== 'interest'
        renderer.bandPoints = {
            bollinger: eligible && chart.showBollingerBands ? bandPoints(renderer, 'bollinger') : [],
            volatility: eligible && chart.showVolatilityBands ? bandPoints(renderer, 'volatility') : []
        }
        renderer.predictionPoints = rangeActive
            ? []
            : predictionPoints(renderer, chart.appliedPredictions[renderer.id])
        // Optional envelopes respect their toggles while zoomed, so the scale
        // must reserve room for them; forecasts stay hidden in range mode.
        applyNativeYDomain(renderer, true)
    }
    chart.currentMaxX = resolveMaxExtendedX(chart)
    chart.xScale.domain([0, chart.currentMaxX])
    drawAxes(chart, { tickValues: chart._xTickValues, labelMap: chart._xTickLabelMap })
    drawPreparedSeries(chart)
    chart.hoveredLine = null
    chart.hoverLine.attr('opacity', 0)
    chart.tooltip.style('opacity', 0)
    bindHover(chart)
    chart.updateLineOpacities()
    chart.onStats?.(computeSeriesStats(chart))
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
    chart.hoverRect.on('mousemove', null).on('mouseleave', null)
    chart.currentMaxX = 1
    chart.xScale.domain([0, 1])
    chart.onStats?.([])
}

// Draw the layers a renderer's visibility level leaves enabled.
function drawRendererLayers(chart, renderer) {
    drawHistoricalBands(renderer, chart)
    if ((renderer.hiddenLevel ?? 0) >= 1) {
        clearMainGraph(renderer)
    } else if (chart.chartMode === 'line') {
        drawLineMode(renderer, chart)
    } else {
        drawCandlestickMode(renderer, chart)
    }
    drawMovingAverages(renderer, chart)
}

// Draw all populated renderers with their prepared, domain-aligned geometry.
function drawPreparedSeries(chart) {
    for (const renderer of chart.series) {
        if (!renderer.native.length) {
            clearEmptyRenderer(renderer)
            continue
        }

        drawRendererLayers(chart, renderer)
        drawPredictionOverlay(renderer, chart.appliedPredictions[renderer.id], chart, renderer.predictionPoints)
    }
}

// Hide a renderer whose series has no native candles.
function clearEmptyRenderer(renderer) {
    for (const paths of Object.values(renderer.bands)) {
        drawBandPaths(paths, [], null, null)
    }
    renderer.bandPoints = null
    renderer.predictionPoints = []
    clearMainGraph(renderer)
    renderer.indicators.maLine.datum([]).attr('d', null).attr('opacity', 0)
    renderer.indicators.emaLine.datum([]).attr('d', null).attr('opacity', 0)
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
                pctChange: first.close ? ((last.close - first.close) / first.close) * 100 : null,
                ...overlayStats(renderer, chart)
            }
        })
}

// Flat presentation fields preserve Graph's shallow stats comparison contract.
function overlayStats(renderer, chart) {
    const eligible = renderer.assetClass !== 'interest'
    const showClassic = eligible && chart.showBollingerBands
    const showVolatility = eligible && chart.showVolatilityBands

    return {
        classicLabel: showClassic ? 'Bollinger Bands' : '',
        classicStatus: '',
        volatilityLabel: showVolatility ? 'Calibrated Volume Bands' : '',
        volatilityStatus: '',
        classicReturn: showClassic ? returnText(fiveBarReturnRate(renderer, 'bollinger')) : '',
        volatilityReturn: showVolatility ? returnText(fiveBarReturnRate(renderer, 'volatility')) : ''
    }
}

function returnText({ exits, percentage }) {
    return exits ? `${percentage.toFixed(0)}% were in the estimated range within 5 bars (${exits} exits)` : 'Not enough completed exits'
}
