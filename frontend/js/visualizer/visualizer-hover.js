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
    const n = Number(value)
    if (!Number.isFinite(n)) return '—'
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })
}

export function formatVolume(value) {
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

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

function candleRows(candle, chartMode) {
    if (chartMode === 'line') {
        return row('Price', formatPrice(candle?.close)) +
            row('Volume', formatVolume(candle?.volume))
    }
    return row('Open', formatPrice(candle?.open)) +
        row('High', formatPrice(candle?.high)) +
        row('Low', formatPrice(candle?.low)) +
        row('Close', formatPrice(candle?.close)) +
        row('Volume', formatVolume(candle?.volume))
}

// Single series keeps the original markup and row order exactly.
function buildSingleSeriesContent(renderer, idx, dateLabel, chartMode) {
    return row('Time', dateLabel) + candleRows(renderer?.aligned?.[idx], chartMode)
}

function buildSeriesBlock(renderer, idx, chart) {
    const color = renderer.colors?.line
    let html = `<div style="border-left: 2px solid ${color}; padding-left: 6px; margin-top: 6px;">`
    html += `<div><strong>Symbol:</strong> <span style="color:${color}">${escapeHtml(renderer.symbol)}</span></div>`
    html += candleRows(renderer.aligned?.[idx], chart.chartMode)

    if (chart.showMovingAverage) {
        html += indicatorRow('MA', renderer.currentMaPoints, idx)
    }
    if (chart.showExponentialMovingAverage) {
        html += indicatorRow('EMA', renderer.currentEmaPoints, idx)
    }
    html += predictionRow(renderer, idx)

    return html + '</div>'
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
    const renderers = visibleRenderers(chart)

    if (renderers.length === 1) {
        return buildSingleSeriesContent(renderers[0], idx, dateLabel, chart.chartMode)
    }

    return row('Time', dateLabel) +
        renderers.map(renderer => buildSeriesBlock(renderer, idx, chart)).join('')
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

        const candle = renderer.aligned?.[idx]
        if (chart.chartMode === 'line' && candle && Number.isFinite(candle.close)) {
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
    const dates = chart.unionDates ?? []
    if (!dates.length) return

    const [x, y] = d3.pointer(event, chart.hoverRect.node())
    const idx = Math.max(0, Math.min(dates.length - 1, Math.round(chart.xScale.invert(x))))
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

function handleMouseLeave(chart) {
    chart.hoverLine.attr('opacity', 0)
    hideHoverDots(chart)
    chart.tooltip.style('opacity', 0)

    if (chart.hoveredLine !== null) {
        chart.hoveredLine = null
        applyLineOpacities(chart)
    }
}

// Bind mousemove/mouseleave handlers: union snapping, crosshair, per-series dots,
// line proximity detection, and combined tooltip display.
export function bindHover(chart) {
    chart.hoverRect
        .on('mousemove', (event) => handleMouseMove(chart, event))
        .on('mouseleave', () => handleMouseLeave(chart))
}
