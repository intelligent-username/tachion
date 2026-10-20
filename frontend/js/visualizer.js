// D3.js Chart Visualization (30m OHLCV candlesticks)
import * as d3 from 'd3'

function parseDateLike(input) {
    if (input == null) return null
    const d = input instanceof Date ? input : new Date(input)
    return Number.isNaN(d.getTime()) ? null : d
}

function toNumber(value) {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
}

function normalizeCandle(row, previousClose = null) {
    const date = parseDateLike(
        row.timestamp ?? row.datetime ?? row.date ?? row.time ?? row.t
    )
    if (!date) return null

    const open = toNumber(row.open ?? row.o)
    const high = toNumber(row.high ?? row.h)
    const low = toNumber(row.low ?? row.l)
    const close = toNumber(row.close ?? row.c ?? row.value)
    const volume = toNumber(row.volume ?? row.v ?? 0) ?? 0

    const fallback = close ?? previousClose
    if (fallback == null) return null

    const safeOpen = open ?? previousClose ?? fallback
    const safeClose = close ?? safeOpen
    const safeHigh = high ?? Math.max(safeOpen, safeClose)
    const safeLow = low ?? Math.min(safeOpen, safeClose)

    return {
        date,
        open: safeOpen,
        high: Math.max(safeHigh, safeOpen, safeClose),
        low: Math.min(safeLow, safeOpen, safeClose),
        close: safeClose,
        volume
    }
}

function clampCandlesByTimespan(candles, timespan) {
    if (!candles.length || !timespan || timespan === 'max') return candles

    const sorted = [...candles].sort((a, b) => a.date - b.date)
    const end = sorted[sorted.length - 1].date
    let start = null

    if (timespan === 'ytd') {
        start = new Date(end.getFullYear(), 0, 1)
    } else {
        const hourMatch = String(timespan).match(/^(\d+)h$/i)
        const dayMatch = String(timespan).match(/^(\d+)d$/)
        const monthMatch = String(timespan).match(/^(\d+)m$/i)
        const yearMatch = String(timespan).match(/^(\d+)y$/i)

        if (hourMatch) {
            start = new Date(end)
            start.setHours(start.getHours() - Number(hourMatch[1]))
        } else if (dayMatch) {
            start = new Date(end)
            start.setDate(start.getDate() - Number(dayMatch[1]))
        } else if (monthMatch) {
            start = new Date(end)
            start.setMonth(start.getMonth() - Number(monthMatch[1]))
        } else if (yearMatch) {
            start = new Date(end)
            start.setFullYear(start.getFullYear() - Number(yearMatch[1]))
        }
    }

    if (!start) return sorted

    const clamped = sorted.filter(d => d.date >= start && d.date <= end)
    return clamped.length > 1 ? clamped : sorted.slice(-2)
}

function clampRowsByTimespan(rows, timespan) {
    if (!rows?.length || !timespan || timespan === 'max') return rows ?? []

    // Find a usable end time from the back of the array.
    let end = null
    for (let i = rows.length - 1; i >= 0; i--) {
        const dt = parseDateLike(rows[i]?.timestamp ?? rows[i]?.datetime ?? rows[i]?.date ?? rows[i]?.time ?? rows[i]?.t)
        if (dt) { end = dt; break }
    }
    if (!end) return rows

    let start = null
    if (timespan === 'ytd') {
        start = new Date(end.getFullYear(), 0, 1)
    } else {
        const hourMatch = String(timespan).match(/^(\d+)h$/i)
        const dayMatch = String(timespan).match(/^(\d+)d$/)
        const monthMatch = String(timespan).match(/^(\d+)m$/i)
        const yearMatch = String(timespan).match(/^(\d+)y$/i)

        if (hourMatch) {
            start = new Date(end)
            start.setHours(start.getHours() - Number(hourMatch[1]))
        } else if (dayMatch) {
            start = new Date(end)
            start.setDate(start.getDate() - Number(dayMatch[1]))
        } else if (monthMatch) {
            start = new Date(end)
            start.setMonth(start.getMonth() - Number(monthMatch[1]))
        } else if (yearMatch) {
            start = new Date(end)
            start.setFullYear(start.getFullYear() - Number(yearMatch[1]))
        }
    }

    if (!start) return rows

    const clamped = rows.filter(r => {
        const dt = parseDateLike(r?.timestamp ?? r?.datetime ?? r?.date ?? r?.time ?? r?.t)
        return dt && dt >= start && dt <= end
    })

    return clamped.length > 1 ? clamped : rows.slice(-2)
}

function computeAdaptiveMovingAverage(values, windowSize) {
    if (!values.length) return []
    const out = new Array(values.length)
    let runningSum = 0

    for (let i = 0; i < values.length; i++) {
        runningSum += values[i]
        const start = Math.max(0, i - windowSize + 1)
        if (start > 0) {
            runningSum -= values[start - 1]
        }
        const span = i - start + 1
        out[i] = span > 0 ? (runningSum / span) : values[i]
    }

    return out
}

function computeExponentialMovingAverage(values, period = 20) {
    if (!values.length) return []
    const out = new Array(values.length)
    const multiplier = 2 / (period + 1)
    
    // Seed with initial price
    let prevEma = values[0]
    out[0] = prevEma

    for (let i = 1; i < values.length; i++) {
        prevEma = (values[i] - prevEma) * multiplier + prevEma
        out[i] = prevEma
    }

    return out
}

export class TChart {
    constructor(container) {
        this.container = container
        this.margin = { top: 18, right: 18, bottom: 26, left: 54 }
        this.currentData = []
        this.lastTimespan = 'max'
        this.showMovingAverage = false
        this.chartMode = 'bars' // 'bars' | 'line'
        this.upColor = '#27ae60'
        this.downColor = '#e74c3c'

        // Clear any existing content
        d3.select(container).selectAll('*').remove()

        // Create responsive SVG that fills the chart container
        this.rootSvg = d3.select(container)
            .append('svg')
            .attr('class', 'tick-chart-svg')
            .attr('width', '100%')
            .attr('height', '100%')
            .attr('preserveAspectRatio', 'none')

        // Gradient definitions for stock price area chart
        this.defs = this.rootSvg.append('defs')
        
        // Neutral gradient for stock price area chart
        const neutralGrad = this.defs.append('linearGradient')
            .attr('id', 'price-area-gradient-neutral')
            .attr('x1', '0%').attr('y1', '0%')
            .attr('x2', '0%').attr('y2', '100%')
        neutralGrad.append('stop').attr('offset', '0%').attr('stop-color', 'rgba(238, 238, 238, 0.95)').attr('stop-opacity', 0.22)
        neutralGrad.append('stop').attr('offset', '80%').attr('stop-color', 'rgba(238, 238, 238, 0.95)').attr('stop-opacity', 0.04)
        neutralGrad.append('stop').attr('offset', '100%').attr('stop-color', 'rgba(238, 238, 238, 0.95)').attr('stop-opacity', 0)

        this.svg = this.rootSvg.append('g')
            .attr('transform', `translate(${this.margin.left},${this.margin.top})`)

        // Initialize scales
        // xScale is index-based (not wall-clock continuous) to avoid weekend/closed-market gaps.
        this.xScale = d3.scaleLinear()
        this.yScale = d3.scaleLinear()
        this.xLabelFormat = d3.timeFormat('%b %d')
        this.baseDates = []
        this.currentMaxX = 1
        this.indexedCandles = []

        this.gridLayer = this.svg.append('g').attr('class', 'grid-layer')
        this.candleLayer = this.svg.append('g').attr('class', 'candle-layer')
        this.priceAreaLayer = this.svg.append('g').attr('class', 'price-area-layer')
        this.overlayLayer = this.svg.append('g').attr('class', 'overlay-layer')

        // Stock Price Mode Line and Area paths
        this.priceArea = this.priceAreaLayer.append('path')
            .attr('class', 'stock-price-area')
            .attr('fill', 'url(#price-area-gradient-up)')
            .attr('opacity', 0)

        this.priceLine = this.priceAreaLayer.append('path')
            .attr('class', 'stock-price-line')
            .attr('fill', 'none')
            .attr('stroke', '#27ae60')
            .attr('stroke-width', 2.2)
            .attr('stroke-linejoin', 'round')
            .attr('stroke-linecap', 'round')
            .attr('opacity', 0)

        this.priceHoverDot = this.priceAreaLayer.append('circle')
            .attr('class', 'stock-price-dot')
            .attr('r', 5)
            .attr('fill', '#27ae60')
            .attr('stroke', '#ffffff')
            .attr('stroke-width', 2)
            .attr('opacity', 0)

        this.xAxis = this.overlayLayer.append('g')
            .attr('class', 'x-axis')

        this.yAxis = this.overlayLayer.append('g')
            .attr('class', 'y-axis')

        this.predictionLine = this.overlayLayer.append('path')
            .attr('class', 'prediction-line')
            .attr('fill', 'none')
            .attr('stroke', 'rgba(114, 137, 218, 0.95)')
            .attr('stroke-width', 1.5)
            .attr('stroke-dasharray', '3,3')
            .attr('opacity', 0)

        this.predictionBand = this.overlayLayer.append('path')
            .attr('class', 'prediction-band')
            .attr('fill', 'rgba(67, 78, 117, 0.1)')
            .attr('stroke', 'none')
            .attr('opacity', 0)

        this.predictionUpper = this.overlayLayer.append('path')
            .attr('class', 'prediction-upper')
            .attr('fill', 'none')
            .attr('stroke', 'rgba(37, 119, 115, 0.45)')
            .attr('stroke-width', 1)
            .attr('stroke-dasharray', '2,2')
            .attr('opacity', 0)

        this.predictionLower = this.overlayLayer.append('path')
            .attr('class', 'prediction-lower')
            .attr('fill', 'none')
            .attr('stroke', 'rgba(146, 81, 28, 0.45)')
            .attr('stroke-width', 1)
            .attr('stroke-dasharray', '2,2')
            .attr('opacity', 0)

        this.movingAverageLine = this.overlayLayer.append('path')
            .attr('class', 'moving-average-line')
            .attr('fill', 'none')
            .attr('stroke', 'rgba(241, 196, 15, 0.95)')
            .attr('stroke-width', 1.8)
            .attr('opacity', 0)

        this.exponentialMovingAverageLine = this.overlayLayer.append('path')
            .attr('class', 'exponential-moving-average-line')
            .attr('fill', 'none')
            .attr('stroke', 'rgba(0, 210, 255, 0.95)')
            .attr('stroke-width', 1.8)
            .attr('opacity', 0)

        this.hoverLine = this.overlayLayer.append('line')
            .attr('class', 'hover-line')
            .attr('stroke', 'rgba(255,255,255,0.3)')
            .attr('stroke-width', 1)
            .attr('y1', 0)
            .attr('opacity', 0)

        this.hoverRect = this.overlayLayer.append('rect')
            .attr('class', 'hover-capture')
            .attr('fill', 'transparent')
            .style('pointer-events', 'all')

        this.tooltip = d3.select(container)
            .append('div')
            .attr('class', 'chart-tooltip')
            .style('opacity', 0)

        this.resizeObserver = new ResizeObserver(() => {
            this.resize()
            if (this.currentData.length) {
                this.drawCandles(this.currentData)
            }
        })
        this.resizeObserver.observe(container)

        this.resize()
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
            this.predictionLine.attr('opacity', 0)
            this.predictionBand.attr('opacity', 0)
            this.predictionUpper.attr('opacity', 0)
            this.predictionLower.attr('opacity', 0)
            return
        }

        const indexedCandles = candles.map((d, i) => ({ ...d, _i: i }))
        this.indexedCandles = indexedCandles
        const xMax = Math.max(1, indexedCandles.length - 1)
        this.currentMaxX = xMax
        this.baseDates = indexedCandles.map(d => d.date)

        const spanMs = this.baseDates.length > 1
            ? this.baseDates[this.baseDates.length - 1] - this.baseDates[0]
            : 0
        const DAY = 24 * 60 * 60 * 1000
        const showTime = spanMs <= 14 * DAY
        const mayShowYear = spanMs > 7 * DAY

        const latestYear = this.baseDates.length
            ? this.baseDates[this.baseDates.length - 1].getFullYear()
            : new Date().getFullYear()

        this._xTickFormatter = (dt) => {
            if (!dt) return ''
            const crossesYear = mayShowYear && dt.getFullYear() !== latestYear
            if (showTime) {
                return crossesYear
                    ? d3.timeFormat('%b %d %Y %H:%M')(dt)
                    : d3.timeFormat('%b %d %H:%M')(dt)
            }
            return crossesYear
                ? d3.timeFormat('%b %d %Y')(dt)
                : d3.timeFormat('%b %d')(dt)
        }

        const lows = candles.map(d => d.low)
        const highs = candles.map(d => d.high)
        const yMin = d3.min(lows)
        const yMax = d3.max(highs)
        const ySpan = Math.max(1e-9, yMax - yMin)
        const yPad = ySpan * 0.08

        this.xScale.domain([0, xMax])
        this.yScale.domain([yMin - yPad, yMax + yPad])

        // Use explicit integer tick positions to avoid repeated labels caused by
        // multiple tick values rounding to the same candle index.
        const desiredTicks = Math.min(8, indexedCandles.length)
        let tickValues = []
        if (desiredTicks <= 1) {
            tickValues = [0]
        } else {
            const step = xMax / (desiredTicks - 1)
            for (let j = 0; j < desiredTicks; j++) {
                tickValues.push(Math.round(j * step))
            }
        }
        tickValues.push(0, xMax)
        tickValues = [...new Set(tickValues
            .map(v => Math.max(0, Math.min(xMax, v)))
        )].sort((a, b) => a - b)

        const fmtDay = d3.timeFormat('%b %d')
        const fmtDayYear = d3.timeFormat('%b %d %Y')
        const fmtTime = d3.timeFormat('%b %d %H:%M')
        const fmtTimeYear = d3.timeFormat('%b %d %Y %H:%M')
        const fmtIso = d3.timeFormat('%Y-%m-%d %H:%M')

        const labelMap = new Map()
        const usedLabels = new Set()
        let prevTickYear = null

        for (const i of tickValues) {
            const dt = this.baseDates[i]
            if (!dt) {
                labelMap.set(i, '')
                continue
            }

            const dtYear = dt.getFullYear()
            const yearBoundary = prevTickYear != null && dtYear !== prevTickYear
            const includeYear = mayShowYear && (dtYear !== latestYear || yearBoundary)

            let label = showTime
                ? (includeYear ? fmtTimeYear(dt) : fmtTime(dt))
                : (includeYear ? fmtDayYear(dt) : fmtDay(dt))

            // If formatting would duplicate an existing label, promote to a more specific
            // format (add time/year) to guarantee uniqueness.
            if (usedLabels.has(label)) {
                label = fmtTimeYear(dt)
            }
            if (usedLabels.has(label)) {
                label = fmtIso(dt)
            }

            usedLabels.add(label)
            labelMap.set(i, label)
            prevTickYear = dtYear
        }

        this._xTickValues = tickValues
        this._xTickLabelMap = labelMap

        const xAxis = d3.axisBottom(this.xScale)
            .tickValues(tickValues)
            .tickFormat((v) => labelMap.get(Math.round(v)) ?? '')
        const yAxis = d3.axisLeft(this.yScale).ticks(6)

        this.xAxis.call(xAxis)
        this.yAxis.call(yAxis)

        // Prevent edge tick labels from getting clipped by the chart bounds.
        this.xAxis.selectAll('.tick text')
            .attr('text-anchor', (d) => {
                const px = this.xScale(d)
                if (px > this.width - 8) return 'end'
                if (px < 8) return 'start'
                return 'middle'
            })
            .attr('dx', (d) => {
                const px = this.xScale(d)
                if (px > this.width - 8) return '-0.4em'
                if (px < 8) return '0.4em'
                return '0'
            })

        this.xAxis.selectAll('path,line').attr('stroke', 'rgba(255,255,255,0.2)')
        this.yAxis.selectAll('path,line').attr('stroke', 'rgba(255,255,255,0.2)')
        this.xAxis.selectAll('text').attr('fill', 'rgba(238,238,238,0.75)').style('font-size', '10px')
        this.yAxis.selectAll('text').attr('fill', 'rgba(238,238,238,0.75)').style('font-size', '10px')

        const yGrid = d3.axisLeft(this.yScale).ticks(6).tickSize(-this.width).tickFormat('')
        this.gridLayer.call(yGrid)
        this.gridLayer.selectAll('line').attr('stroke', 'rgba(255,255,255,0.08)')
        this.gridLayer.selectAll('path').attr('stroke', 'transparent')

        const isLineMode = this.chartMode === 'line'

        if (isLineMode) {
            // Fade out candlestick elements smoothly
            this.candleLayer.selectAll('g.candle')
                .transition()
                .duration(260)
                .ease(d3.easeCubicOut)
                .attr('opacity', 0)
                .remove()

            // Draw with a sleek neutral color and gradient
            const neutralColor = 'rgba(238, 238, 238, 0.9)'
            const gradId = 'url(#price-area-gradient-neutral)'

            const lineGenerator = d3.line()
                .x(d => this.xScale(d._i))
                .y(d => this.yScale(d.close))
                .curve(indexedCandles.length > 80 ? d3.curveMonotoneX : d3.curveCatmullRom.alpha(0.5))

            const areaGenerator = d3.area()
                .x(d => this.xScale(d._i))
                .y0(this.height)
                .y1(d => this.yScale(d.close))
                .curve(indexedCandles.length > 80 ? d3.curveMonotoneX : d3.curveCatmullRom.alpha(0.5))

            this.priceArea
                .datum(indexedCandles)
                .attr('d', areaGenerator)
                .attr('fill', gradId)
                .transition()
                .duration(280)
                .ease(d3.easeCubicOut)
                .attr('opacity', 1)

            this.priceLine
                .datum(indexedCandles)
                .attr('d', lineGenerator)
                .attr('stroke', neutralColor)
                .transition()
                .duration(280)
                .ease(d3.easeCubicOut)
                .attr('opacity', 1)

            this.priceHoverDot
                .attr('fill', neutralColor)
                .attr('opacity', 0)
        } else {
            // Fade out price line & area smoothly
            this.priceArea.transition().duration(240).ease(d3.easeCubicOut).attr('opacity', 0)
            this.priceLine.transition().duration(240).ease(d3.easeCubicOut).attr('opacity', 0)
            this.priceHoverDot.attr('opacity', 0)

            const minSpacingPx = indexedCandles.length > 1
                ? this.width / (indexedCandles.length - 1)
                : this.width
            const bodyWidth = Math.max(2, Math.min(14, (minSpacingPx || this.width) * 0.7))

            const candle = this.candleLayer
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
                .attr('x1', d => this.xScale(d._i))
                .attr('x2', d => this.xScale(d._i))
                .attr('y1', d => this.yScale(d.high))
                .attr('y2', d => this.yScale(d.low))
                .attr('stroke-width', 1)
                .attr('stroke', d => (d.close >= d.open ? this.upColor : this.downColor))

            merged.select('rect.body')
                .attr('x', d => this.xScale(d._i) - bodyWidth / 2)
                .attr('width', bodyWidth)
                .attr('y', d => this.yScale(Math.max(d.open, d.close)))
                .attr('height', d => Math.max(1, Math.abs(this.yScale(d.open) - this.yScale(d.close))))
                .attr('fill', d => (d.close >= d.open ? this.upColor : this.downColor))

            merged.transition()
                .duration(280)
                .ease(d3.easeCubicOut)
                .attr('opacity', 0.95)
        }

        if (this.showMovingAverage && indexedCandles.length > 0) {
            const maWindow = 30
            const closes = indexedCandles.map(d => d.close)
            const maValues = computeAdaptiveMovingAverage(closes, maWindow)
            const maPoints = indexedCandles.map((d, i) => ({ x: d._i, y: maValues[i] }))

            const maLine = d3.line()
                .x(d => this.xScale(d.x))
                .y(d => this.yScale(d.y))

            this.movingAverageLine
                .datum(maPoints)
                .attr('d', maLine)
                .attr('opacity', 1)
        } else {
            this.movingAverageLine.attr('opacity', 0)
        }

        if (this.showExponentialMovingAverage && indexedCandles.length > 0) {
            const emaPeriod = 20
            const closes = indexedCandles.map(d => d.close)
            const emaValues = computeExponentialMovingAverage(closes, emaPeriod)
            const emaPoints = indexedCandles.map((d, i) => ({ x: d._i, y: emaValues[i] }))

            const emaLine = d3.line()
                .x(d => this.xScale(d.x))
                .y(d => this.yScale(d.y))

            this.exponentialMovingAverageLine
                .datum(emaPoints)
                .attr('d', emaLine)
                .attr('opacity', 1)
        } else {
            this.exponentialMovingAverageLine.attr('opacity', 0)
        }

        this.predictionLine.attr('opacity', 0)
        this.predictionBand.attr('opacity', 0)
        this.predictionUpper.attr('opacity', 0)
        this.predictionLower.attr('opacity', 0)
        this._bindHover()
    }

    _formatPrice(value) {
        const n = Number(value)
        if (!Number.isFinite(n)) return '—'
        return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })
    }

    _formatVolume(value) {
        const n = Number(value)
        if (!Number.isFinite(n)) return '—'
        return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
    }

    _bindHover() {
        this.hoverRect
            .on('mousemove', (event) => {
                if (!this.indexedCandles.length) return

                const [x] = d3.pointer(event, this.hoverRect.node())
                const idx = Math.max(0, Math.min(this.indexedCandles.length - 1, Math.round(this.xScale.invert(x))))
                const d = this.indexedCandles[idx]
                if (!d) return

                const cx = this.xScale(d._i)
                const cy = this.yScale(d.close)

                this.hoverLine
                    .attr('x1', cx)
                    .attr('x2', cx)
                    .attr('opacity', 1)

                if (this.chartMode === 'line') {
                    this.priceHoverDot
                        .attr('cx', cx)
                        .attr('cy', cy)
                        .attr('opacity', 1)
                } else {
                    this.priceHoverDot.attr('opacity', 0)
                }

                const dateLabel = d3.timeFormat('%Y-%m-%d %H:%M')(d.date)
                
                let tooltipContent = ''
                if (this.chartMode === 'line') {
                    tooltipContent = 
                        `<div><strong>Time:</strong> ${dateLabel}</div>` +
                        `<div><strong>Price:</strong> ${this._formatPrice(d.close)}</div>` +
                        `<div><strong>Volume:</strong> ${this._formatVolume(d.volume)}</div>`
                } else {
                    tooltipContent = 
                        `<div><strong>Time:</strong> ${dateLabel}</div>` +
                        `<div><strong>Open:</strong> ${this._formatPrice(d.open)}</div>` +
                        `<div><strong>High:</strong> ${this._formatPrice(d.high)}</div>` +
                        `<div><strong>Low:</strong> ${this._formatPrice(d.low)}</div>` +
                        `<div><strong>Close:</strong> ${this._formatPrice(d.close)}</div>` +
                        `<div><strong>Volume:</strong> ${this._formatVolume(d.volume)}</div>`
                }

                this.tooltip
                    .html(tooltipContent)
                    .style('opacity', 1)

                const rect = this.container.getBoundingClientRect()
                const tipNode = this.tooltip.node()
                const tipWidth = tipNode?.offsetWidth ?? 150
                const tipHeight = tipNode?.offsetHeight ?? 70

                const left = Math.min(
                    Math.max(8, cx + this.margin.left + 12),
                    rect.width - tipWidth - 8
                )
                const targetY = this.chartMode === 'line' ? cy : this.yScale(d.high)
                const top = Math.min(
                    Math.max(8, targetY + this.margin.top - tipHeight - 10),
                    rect.height - tipHeight - 8
                )

                this.tooltip
                    .style('left', `${left}px`)
                    .style('top', `${top}px`)
            })
            .on('mouseleave', () => {
                this.hoverLine.attr('opacity', 0)
                this.priceHoverDot.attr('opacity', 0)
                this.tooltip.style('opacity', 0)
            })
    }

    // Prediction overlay: draws median line, upper/lower bounds, and shaded band.
    // Expects: { predictions: [{ timestamp, upper, lower, median }, ...] }
    // where predictions.length === Math.floor(Math.log(n)), n = currentData.length
    animatePrediction(prediction) {
        if (!this.currentData.length) return

        const pts = prediction?.predictions ?? []
        if (!pts.length) {
            this.predictionLine.attr('opacity', 0)
            this.predictionBand.attr('opacity', 0)
            this.predictionUpper.attr('opacity', 0)
            this.predictionLower.attr('opacity', 0)
            return
        }

        const last = this.currentData[this.currentData.length - 1]
        const startX = Math.max(0, this.currentData.length - 1)

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
        const extendedMaxX = Math.max(this.currentMaxX, startX + pts.length)
        const xOverlayScale = this.xScale.copy().domain([0, extendedMaxX])

        // Re-draw x axis with same tick logic
        const tickValues = Array.isArray(this._xTickValues) && this._xTickValues.length
            ? this._xTickValues
            : d3.range(0, Math.min(this.baseDates.length, 8)).map(i => i)

        const xAxis = d3.axisBottom(xOverlayScale)
            .tickValues(tickValues)
            .tickFormat((v) => {
                const i = Math.round(v)
                if (i < 0 || i >= this.baseDates.length) return ''
                if (this._xTickLabelMap && this._xTickLabelMap.has(i)) return this._xTickLabelMap.get(i)
                const dt = this.baseDates[i]
                return this._xTickFormatter ? this._xTickFormatter(dt) : (dt ? d3.timeFormat('%b %d')(dt) : '')
            })
        this.xAxis.call(xAxis)
        this.xAxis.selectAll('.tick text')
            .attr('text-anchor', (d) => {
                const px = xOverlayScale(d)
                if (px > this.width - 8) return 'end'
                if (px < 8) return 'start'
                return 'middle'
            })
            .attr('dx', (d) => {
                const px = xOverlayScale(d)
                if (px > this.width - 8) return '-0.4em'
                if (px < 8) return '0.4em'
                return '0'
            })
        this.xAxis.selectAll('path,line').attr('stroke', 'rgba(255,255,255,0.2)')
        this.xAxis.selectAll('text').attr('fill', 'rgba(238,238,238,0.75)').style('font-size', '10px')

        // Line generators
        const lineFn = d3.line()
            .x(d => xOverlayScale(d.x))
            .y(d => this.yScale(d.y))

        // Shaded band between upper and lower bounds
        const bandArea = d3.area()
            .x(d => xOverlayScale(d.x))
            .y0((d, i) => this.yScale(lowerPath[i].y))
            .y1(d => this.yScale(d.y))

        this.predictionBand
            .datum(upperPath)
            .attr('d', bandArea)
            .attr('opacity', 1)

        // Median line (prominent, dashed)
        this.predictionLine
            .datum(medianPath)
            .attr('d', lineFn)
            .attr('opacity', 1)

        // Upper bound line (subtle, dashed)
        this.predictionUpper
            .datum(upperPath)
            .attr('d', lineFn)
            .attr('opacity', 1)

        // Lower bound line (subtle, dashed)
        this.predictionLower
            .datum(lowerPath)
            .attr('d', lineFn)
            .attr('opacity', 1)
    }
}
