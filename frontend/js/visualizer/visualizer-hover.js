// Hover interactivity: line highlighting, crosshair, tooltip content/positioning
import * as d3 from 'd3'

const HOVER_DISTANCE_PX = 14
const DIM_OPACITY = 0.15
const HOVERED_STROKE_WIDTH = 2.5
const SINGLE_SERIES_PRICE_HOVER_WIDTH = 3.0
const LINE_STROKE_WIDTHS = { price: 2.2, ma: 1.8, ema: 1.8, prediction: 1.8 }

// Renderers with candles. An empty slot must not count as a second series.
function visibleRenderers(chart) {
    return (chart.series ?? []).filter(renderer => (renderer.native?.length ?? 0) > 0)
}

export function formatPrice(value) {
    if (value == null || value === '') return '—'
    const n = Number(value)
    if (!Number.isFinite(n)) return '—'
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })
}

export function formatVolume(value) {
    if (value == null || value === '') return '—'
    const n = Number(value)
    if (!Number.isFinite(n)) return '—'
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

// Dim non-hovered lines and emphasize the hovered series/kind (ma/ema/prediction/price)
export function applyLineOpacities(chart) {
    for (const renderer of chart.series ?? []) {
        applyPriceOpacity(chart, renderer)
        applyIndicatorOpacity(chart, renderer, 'ma', chart.showMovingAverage, renderer.indicators?.maLine)
        applyIndicatorOpacity(chart, renderer, 'ema', chart.showExponentialMovingAverage, renderer.indicators?.emaLine)
        applyPredictionOpacity(chart, renderer)
    }
}

function applyPriceOpacity(chart, renderer) {
    if (chart.chartMode !== 'line' || !renderer.price) return
    if ((renderer.hiddenLevel ?? 0) >= 1) {
        renderer.price.line.attr('opacity', 0)
        renderer.price.area.attr('opacity', 0)
        return
    }

    const target = resolveEmphasis(chart, renderer, 'price')
    renderer.price.line
        .attr('opacity', target.opacity)
        .attr('stroke-width', target.width)
    renderer.price.area.attr('opacity', target.opacity)
}

function applyIndicatorOpacity(chart, renderer, kind, enabled, line) {
    if (!enabled || !line) return

    const target = resolveEmphasis(chart, renderer, kind)
    line
        .attr('opacity', target.opacity)
        .attr('stroke-width', target.width)
}

function applyPredictionOpacity(chart, renderer) {
    if (!renderer.prediction || !renderer.currentPredictionPoints?.length) return

    const target = resolveEmphasis(chart, renderer, 'prediction')
    const boundsOpacity = resolveBoundsOpacity(chart, target.opacity)
    renderer.prediction.line
        .attr('opacity', target.opacity)
        .attr('stroke-width', target.width)
    renderer.prediction.band.attr('opacity', boundsOpacity)
    renderer.prediction.upper.attr('opacity', boundsOpacity)
    renderer.prediction.lower.attr('opacity', boundsOpacity)
}

// Resolve opacity and stroke width for one overlay against the hovered series+kind.
function resolveEmphasis(chart, renderer, kind) {
    const hovered = chart.hoveredLine
    const isWinner = !!hovered && hovered.seriesId === renderer.id && hovered.kind === kind
    const isSameKindOther = !!hovered && hovered.kind === kind && hovered.seriesId !== renderer.id

    if (isWinner) {
        return { opacity: 1, width: winnerWidth(chart, kind) }
    }
    if (isSameKindOther) {
        return { opacity: DIM_OPACITY, width: LINE_STROKE_WIDTHS[kind] }
    }
    return {
        opacity: singleSeriesRestOpacity(chart, kind),
        width: LINE_STROKE_WIDTHS[kind]
    }
}

// A single series dims every non-hovered overlay, matching the pre-multi-series chart.
function singleSeriesRestOpacity(chart, kind) {
    if (visibleRenderers(chart).length === 1 && chart.hoveredLine !== null) return DIM_OPACITY
    return chart.baseOpacities[kind]
}

function winnerWidth(chart, kind) {
    if (kind === 'price' && visibleRenderers(chart).length === 1) {
        return SINGLE_SERIES_PRICE_HOVER_WIDTH
    }
    return HOVERED_STROKE_WIDTH
}

// Prediction bounds keep full opacity at rest in single-series mode.
function resolveBoundsOpacity(chart, targetOpacity) {
    if (visibleRenderers(chart).length === 1 && chart.hoveredLine === null) return 1
    return targetOpacity
}

function row(label, value) {
    return `<div><strong>${label}:</strong> ${value}</div>`
}

// Tooltip row toggles come from the settings gear; default to all-on
const DEFAULT_TOOLTIP_FIELDS = { price: true, time: true, open: true, high: true, low: true, volume: true }

function tooltipField(chart, key) {
    const value = chart.tooltipFields?.[key]
    return value ?? DEFAULT_TOOLTIP_FIELDS[key]
}

// Price is the headline metric: bigger font, shown before time
function priceRow(value) {
    return `<div class="chart-tooltip-price"><strong>Price:</strong> ${formatPrice(value)}</div>`
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

// Returns [price html, remaining rows html]; each row gated by the settings toggles
function candleRows(candle, chart) {
    const price = tooltipField(chart, 'price') ? priceRow(candle?.close) : ''
    let rest = ''
    if (tooltipField(chart, 'open')) rest += row('Open', formatPrice(candle?.open))
    if (tooltipField(chart, 'high')) rest += row('High', formatPrice(candle?.high))
    if (tooltipField(chart, 'low')) rest += row('Low', formatPrice(candle?.low))
    if (tooltipField(chart, 'volume')) rest += row('Volume', formatVolume(candle?.volume))
    return [price, rest]
}

// Order: Price (larger first line), Time, remaining checked rows
function buildSingleSeriesContent(renderer, idx, dateLabel, chart) {
    const [price, rest] = candleRows(renderer?.aligned?.[idx], chart)
    const time = tooltipField(chart, 'time') ? row('Time', dateLabel) : ''
    return price + time + rest + bandRows(renderer, idx, chart)
}

function buildSeriesBlock(renderer, idx, chart) {
    const color = renderer.colors?.line
    const [price, rest] = candleRows(renderer.aligned?.[idx], chart)
    let html = `<div style="border-left: 2px solid ${color}; padding-left: 6px; margin-top: 6px;">`
    html += `<div><strong>Symbol:</strong> <span style="color:${color}">${escapeHtml(renderer.symbol)}</span></div>`
    html += price + rest

    if (chart.showMovingAverage) {
        html += indicatorRow('MA', renderer.currentMaPoints, idx)
    }
    if (chart.showExponentialMovingAverage) {
        html += indicatorRow('EMA', renderer.currentEmaPoints, idx)
    }
    html += predictionRow(renderer, idx)
    html += bandRows(renderer, idx, chart)

    return html + '</div>'
}

// One readout for price hover in either series mode; never fill missing slots
// from a neighboring candle or coerce a null warmup value to zero.
function bandRows(renderer, idx, chart) {
    if (!renderer || renderer.assetClass === 'interest') return ''
    const mapped = renderer.bandPoints
    let html = ''
    if (chart.showBollingerBands) {
        const point = mapped?.bollinger?.[idx]
        html += row(point?.provisional ? 'BB lower / upper (provisional)' : 'BB lower / upper',
            [point?.lower, point?.upper].map(formatPrice).join(' / '))
        html += row('%B', Number.isFinite(point?.percentB) ? point.percentB.toFixed(3) : '—')
        if (point?.provisional && Number.isFinite(point.lower) && Number.isFinite(point.upper)) {
            html += '<div class="chart-tooltip-band-status">Hovered Classic bounds use a shortened rolling window.</div>'
        }
    }
    if (chart.showVolatilityBands) {
        const point = mapped?.volatility?.[idx]
        html += row(point?.provisional ? 'Vol Bands lower / upper (provisional)' : 'Vol Bands lower / upper',
            [point?.lower, point?.upper].map(formatPrice).join(' / '))
        if (point?.provisional && Number.isFinite(point.lower) && Number.isFinite(point.upper)) {
            html += '<div class="chart-tooltip-band-status">Hovered Vol Bands are uncalibrated; coverage is not established.</div>'
        }
    }
    return html
}

function indicatorRow(label, points, idx) {
    return row(label, formatPrice(findPointY(points, idx)))
}

function predictionRow(renderer, idx) {
    if (idx !== renderer.lastUnionIndex) return ''

    const points = renderer.currentPredictionPoints
    if (!points || points.length < 2) return ''

    return row('Prediction', formatPrice(points[1]?.y ?? undefined))
}

function findPointY(points, idx) {
    const point = points?.find(p => p && p.x === idx)
    return Number.isFinite(point?.y) ? point.y : undefined
}

// Build combined tooltip HTML for the hovered union index. Empty slots are
// skipped so a single populated slot keeps the original single-series markup.
function buildTooltipContent(chart, idx, dateLabel) {
    if (chart.selectedRange) return buildRangeTooltipContent(chart, idx, dateLabel)

    const renderers = visibleRenderers(chart)

    if (renderers.length === 1) {
        return buildSingleSeriesContent(renderers[0], idx, dateLabel, chart)
    }

    return (tooltipField(chart, 'time') ? row('Time', dateLabel) : '') +
        renderers.map(renderer => buildSeriesBlock(renderer, idx, chart)).join('')
}

// Zoomed views show only the date and closing price(s), matching the
// price-graph-only presentation of range mode.
function buildRangeTooltipContent(chart, idx, dateLabel) {
    const renderers = visibleRenderers(chart)

    if (renderers.length === 1) {
        return priceRow(renderers[0].aligned?.[idx]?.close) + row('Time', dateLabel)
    }

    return row('Time', dateLabel) + renderers.map(renderer => {
        const color = renderer.colors?.line ?? 'transparent'
        return `<div style="border-left: 2px solid ${color}; padding-left: 6px; margin-top: 6px;">` +
            `<div><strong>${escapeHtml(renderer.symbol)}:</strong> ${formatPrice(renderer.aligned?.[idx]?.close)}</div></div>`
    }).join('')
}

// Position the tooltip near the cursor/candle without overflowing the container
function positionTooltip(chart, cx, targetY) {
    const rect = chart.container.getBoundingClientRect()
    const tipNode = chart.tooltip.node()
    const tipWidth = tipNode?.offsetWidth ?? 150
    const tipHeight = tipNode?.offsetHeight ?? 70

    const left = Math.min(
        Math.max(8, cx + chart.margin.left + 12),
        rect.width - tipWidth - 8
    )
    const top = Math.min(
        Math.max(8, targetY + chart.margin.top - tipHeight - 10),
        rect.height - tipHeight - 8
    )

    chart.tooltip
        .style('left', `${left}px`)
        .style('top', `${top}px`)
}

// Collect hoverable overlays for one union index, each with its own yScale pixel position.
function collectCandidates(chart, idx) {
    const candidates = []

    for (const renderer of chart.series ?? []) {
        if (!renderer?.native?.length) continue
        const mainHidden = (renderer.hiddenLevel ?? 0) >= 1

        const candle = renderer.aligned?.[idx]
        if (!mainHidden && chart.chartMode === 'line' && candle && Number.isFinite(candle.close)) {
            candidates.push({ seriesId: renderer.id, kind: 'price', y: renderer.yScale(candle.close) })
        }
        if (chart.showMovingAverage) {
            candidates.push(...indicatorCandidates(renderer, 'ma', renderer.currentMaPoints, idx))
        }
        if (chart.showExponentialMovingAverage) {
            candidates.push(...indicatorCandidates(renderer, 'ema', renderer.currentEmaPoints, idx))
        }
        if (renderer.currentPredictionPoints?.length) {
            candidates.push(...indicatorCandidates(renderer, 'prediction', renderer.currentPredictionPoints, idx))
        }
    }

    return candidates
}

function indicatorCandidates(renderer, kind, points, idx) {
    const value = findPointY(points, idx)
    if (value === undefined) return []

    return [{ seriesId: renderer.id, kind, y: renderer.yScale(value) }]
}

function findClosestTarget(chart, idx, pointerY) {
    let closest = null
    let minDistance = HOVER_DISTANCE_PX

    for (const candidate of collectCandidates(chart, idx)) {
        const distance = Math.abs(pointerY - candidate.y)
        if (Number.isFinite(distance) && distance < minDistance) {
            minDistance = distance
            closest = { seriesId: candidate.seriesId, kind: candidate.kind }
        }
    }

    return closest
}

function sameHoverTarget(a, b) {
    if (a === b) return true
    if (!a || !b) return false
    return a.seriesId === b.seriesId && a.kind === b.kind
}

function updateHoveredLine(chart, idx, pointerY) {
    const target = findClosestTarget(chart, idx, pointerY)
    if (sameHoverTarget(chart.hoveredLine, target)) return

    chart.hoveredLine = target
    applyLineOpacities(chart)
}

function updateHoverDots(chart, idx) {
    for (const renderer of chart.series ?? []) {
        const dot = renderer.price?.dot
        if (!dot) continue
        if ((renderer.hiddenLevel ?? 0) >= 1) {
            dot.attr('opacity', 0)
            continue
        }

        const candle = chart.chartMode === 'line' ? renderer.aligned?.[idx] : null
        if (!candle || !Number.isFinite(candle.close)) {
            dot.attr('opacity', 0)
            continue
        }

        dot.attr('cx', chart.xScale(idx))
            .attr('cy', renderer.yScale(candle.close))
            .attr('opacity', 1)
        if (renderer.colors?.line) dot.attr('fill', renderer.colors.line)
    }
}

function hideHoverDots(chart) {
    for (const renderer of chart.series ?? []) {
        renderer.price?.dot?.attr('opacity', 0)
    }
}

// Use the tallest visible candle row to anchor the tooltip above both series.
function tooltipAnchorY(chart, idx) {
    let anchor = null

    for (const renderer of chart.series ?? []) {
        const candle = renderer.aligned?.[idx]
        if (!candle) continue

        const value = chart.chartMode === 'line' ? candle.close : candle.high
        const y = renderer.yScale(value)
        if (Number.isFinite(y)) anchor = anchor === null ? y : Math.min(anchor, y)
    }

    return anchor ?? chart.height / 2
}

function handleMouseMove(chart, event) {
    if (chart.rangeDrag) return
    const dates = chart.unionDates ?? []
    if (!dates.length) return

    const [x, y] = d3.pointer(event, chart.hoverRect.node())
    if (chart.cursorMode === 'crosshair') {
        handleCrosshairMove(chart, x, y)
        return
    }
    const slot = chart.xScale.invert(x)
    if (slot < 0 || slot > dates.length - 1) {
        handleMouseLeave(chart)
        return
    }
    const idx = Math.round(slot)
    const cx = chart.xScale(idx)

    updateHoveredLine(chart, idx, y)
    chart.hoverLine
        .attr('x1', cx)
        .attr('x2', cx)
        .attr('opacity', 1)
    updateHoverDots(chart, idx)

    const dateLabel = d3.timeFormat('%Y-%m-%d %H:%M')(dates[idx])
    chart.tooltip
        .html(buildTooltipContent(chart, idx, dateLabel))
        .style('opacity', 1)

    positionTooltip(chart, cx, tooltipAnchorY(chart, idx))
}

// The x axis is an index scale, so interpolate between adjacent dates rather
// than treating it as a continuous wall-clock scale across market closures.
function dateAtSlot(dates, slot) {
    if (dates.length === 1) return dates[0]
    const i = Math.max(0, Math.min(dates.length - 2, Math.floor(slot)))
    return new Date(+dates[i] + (slot - i) * (dates[i + 1] - dates[i]))
}

function closestSnap(chart, x, y) {
    const matrix = chart.svg.node().getScreenCTM?.()
    if (!matrix) return null
    const { a, b, c, d } = matrix
    const determinant = a * d - b * c
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null
    // Maximum local x displacement of a six-pixel screen-space circle.
    const radiusX = 6 * Math.hypot(c, d) / Math.abs(determinant)
    const limits = [chart.xScale.invert(x - radiusX), chart.xScale.invert(x + radiusX)]
    const start = Math.max(0, Math.ceil(Math.min(...limits)))
    const end = Math.min(chart.unionDates.length - 1, Math.floor(Math.max(...limits)))
    let best = null
    let distance = 6
    for (const renderer of chart.series) {
        if (!renderer.native?.length || renderer.hiddenLevel >= 1) continue
        for (let i = start; i <= end; i++) {
            const close = renderer.aligned?.[i]?.close
            if (!Number.isFinite(close)) continue
            const px = chart.xScale(i), py = renderer.yScale(close)
            const dx = px - x, dy = py - y
            const dist = Math.hypot(a * dx + c * dy, b * dx + d * dy)
            if (dist <= distance && (!best || dist < distance)) {
                best = { x: px, y: py }
                distance = dist
            }
        }
    }
    return best
}

// Read the stock at the vertical crosshair, never at the pointer's y.
function intersectionPrice(chart, renderer, slot) {
    if (slot < 0 || slot > chart.unionDates.length - 1) return null
    if (chart.chartMode !== 'line') {
        const close = renderer.aligned?.[Math.round(slot)]?.close
        return Number.isFinite(close) ? close : null
    }
    const left = renderer.aligned?.[Math.floor(slot)]?.close
    const right = renderer.aligned?.[Math.ceil(slot)]?.close
    // Missing candles break the rendered line; don't bridge those gaps.
    if (!Number.isFinite(left) || !Number.isFinite(right)) return null
    if (Number.isInteger(slot)) return left

    const path = renderer.price?.line?.node()
    if (path?.getTotalLength && path?.getPointAtLength) {
        // Match the actual monotone curve, rather than a straight approximation.
        const x = chart.xScale(slot)
        let start = 0, end = path.getTotalLength()
        for (let i = 0; i < 20; i++) {
            const middle = (start + end) / 2
            if (path.getPointAtLength(middle).x < x) start = middle
            else end = middle
        }
        return renderer.yScale.invert(path.getPointAtLength((start + end) / 2).y)
    }
    return left + (right - left) * (slot - Math.floor(slot))
}

function handleCrosshairMove(chart, x, y) {
    const dates = chart.unionDates
    const snapped = closestSnap(chart, x, y)
    const cx = snapped?.x ?? x, cy = snapped?.y ?? y
    const slot = chart.xScale.invert(x)
    const idx = Math.max(0, Math.min(dates.length - 1, Math.round(slot)))
    const historical = slot >= 0 && slot <= dates.length - 1
    const target = historical ? findClosestTarget(chart, idx, y) : null
    const candleHover = historical && chart.chartMode === 'bars' && chart.series.some(renderer => {
        const candle = renderer.aligned?.[idx]
        if (!candle || renderer.hiddenLevel >= 1) return false
        const halfWidth = Math.max(3, Math.abs(chart.xScale(1) - chart.xScale(0)) / 2)
        return Math.abs(x - chart.xScale(idx)) <= halfWidth &&
            y >= renderer.yScale(candle.high) - 3 && y <= renderer.yScale(candle.low) + 3
    })
    hideHoverReadout(chart)
    chart.crosshairLayer.attr('opacity', 1)
    chart.crosshairVertical.attr('x1', cx).attr('x2', cx)
    chart.crosshairHorizontal.attr('y1', cy).attr('y2', cy)
    if (target || candleHover) {
        updateHoveredLine(chart, idx, y)
        updateHoverDots(chart, idx)
        chart.tooltip.html(buildTooltipContent(chart, idx, d3.timeFormat('%Y-%m-%d %H:%M')(dates[idx])))
            .style('opacity', 1)
        positionTooltip(chart, chart.xScale(idx), tooltipAnchorY(chart, idx))
        chart.crosshairDate.attr('opacity', 0)
        chart.crosshairPrices.selectAll('*').remove()
        return
    }
    const date = dateAtSlot(dates, chart.xScale.invert(cx))
    chart.crosshairDate.attr('opacity', 1).attr('x', cx).attr('y', chart.height + 14)
        .attr('text-anchor', cx < 90 ? 'start' : cx > chart.width - 90 ? 'end' : 'middle')
        .text(d3.timeFormat('%Y-%m-%d %H:%M')(date))
    const intersections = visibleRenderers(chart)
        .filter(renderer => (renderer.hiddenLevel ?? 0) < 1)
        .map(renderer => ({
            renderer,
            price: intersectionPrice(chart, renderer, chart.xScale.invert(cx))
        }))
        .filter(point => point.price !== null)
    // Keep markers on the curves; only move the readouts when they collide.
    const ordered = [...intersections].sort((a, b) => a.renderer.yScale(a.price) - b.renderer.yScale(b.price))
    const labelGap = 19
    for (let i = 0; i < ordered.length; i++) {
        const desired = Math.max(12, Math.min(chart.height - 5, ordered[i].renderer.yScale(ordered[i].price) - 8))
        ordered[i].labelY = i ? Math.max(desired, ordered[i - 1].labelY + labelGap) : desired
    }
    for (let i = ordered.length - 1; i >= 0; i--) {
        const limit = i === ordered.length - 1 ? chart.height - 5 : ordered[i + 1].labelY - labelGap
        ordered[i].labelY = Math.min(ordered[i].labelY, limit)
    }
    const backgrounds = chart.crosshairPrices.selectAll('rect').data(intersections, point => point.renderer.id).join('rect')
        .attr('class', 'crosshair-price-background')
        .attr('rx', 4)
    backgrounds.lower()
    chart.crosshairPrices.selectAll('circle').data(intersections, point => point.renderer.id).join('circle')
        .attr('class', 'crosshair-intersection-dot')
        .attr('cx', cx)
        .attr('cy', ({ renderer, price }) => renderer.yScale(price))
        .attr('r', 3.5)
        .attr('fill', ({ renderer }) => renderer.colors?.line ?? 'var(--readout-text)')
    chart.crosshairPrices.selectAll('text').data(intersections, point => point.renderer.id).join('text')
        .attr('class', 'crosshair-label crosshair-price')
        .attr('x', cx + 9)
        .attr('y', point => point.labelY)
        .attr('text-anchor', 'start')
        .text(({ renderer, price }) => `${renderer.symbol || renderer.id}: ${formatPrice(price)}`)
        .each(function (point) {
            // Keep the readout beside its point, flipping left near the edge.
            const labelWidth = this.getComputedTextLength?.() || this.textContent.length * 6
            if (cx + 9 + labelWidth > chart.width) {
                d3.select(this).attr('x', cx - 9).attr('text-anchor', 'end')
            }
            const label = d3.select(this)
            const x = +label.attr('x')
            const y = +label.attr('y')
            backgrounds.filter(background => background.renderer.id === point.renderer.id)
                .attr('x', x - (label.attr('text-anchor') === 'end' ? labelWidth : 0) - 5)
                .attr('y', y - 12)
                .attr('width', labelWidth + 10)
                .attr('height', 17)
        })
}

export function hideHoverReadout(chart) {
    chart.hoverLine?.attr('opacity', 0)
    chart.crosshairLayer?.attr('opacity', 0)
    hideHoverDots(chart)
    chart.tooltip?.style('opacity', 0)

    if (chart.hoveredLine !== null) {
        chart.hoveredLine = null
        applyLineOpacities(chart)
    }
}

function handleMouseLeave(chart) {
    if (chart.rangeDrag) return
    hideHoverReadout(chart)
}

// Bind mousemove/mouseleave handlers: union snapping, crosshair, per-series dots,
// line proximity detection, and combined tooltip display.
export function bindHover(chart) {
    chart.hoverRect
        .on('mousemove', (event) => handleMouseMove(chart, event))
        .on('mouseleave', () => handleMouseLeave(chart))
}
