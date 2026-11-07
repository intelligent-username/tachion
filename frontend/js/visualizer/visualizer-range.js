// Drag-to-select date range: pointer handling and selection overlay.
import * as d3 from 'd3'
import { formatPrice, hideHoverReadout } from './visualizer-hover'

const MIN_DRAG_PX = 6
const DAY_MS = 24 * 60 * 60 * 1000
const SHOW_TIME_SPAN_MS = 14 * DAY_MS
const READOUT_MARGIN_PX = 48

// Map a plot pixel to the nearest union date index, clamped to the data.
export function indexAtX(chart, px) {
    const dates = chart.unionDates ?? []
    if (!dates.length) return 0
    const x = Math.max(0, Math.min(chart.width, px))
    const slot = Math.round(chart.xScale.invert(x))
    return Math.max(0, Math.min(dates.length - 1, slot))
}

// Bind range selection on the existing full-plot capture rect. Namespaced
// events keep the hover module's mousemove/mouseleave handlers intact.
export function bindRangeSelect(chart) {
    const node = chart.hoverRect.node()
    if (!node) return
    chart.hoverRect
        .on('pointerdown.range', event => startDrag(chart, event))
        .on('pointermove.range', event => moveDrag(chart, event))
        .on('pointerup.range', event => finishDrag(chart, event))
        .on('pointercancel.range', () => cancelDrag(chart))
        .on('contextmenu.range', event => event.preventDefault())
}

function startDrag(chart, event) {
    if (chart.rangeDrag) return
    if ((event.button !== 0 && event.button !== 2) || !chart.unionDates?.length) return
    const [rawX] = d3.pointer(event, chart.hoverRect.node())
    const x = clampX(chart, rawX)
    event.preventDefault()
    chart.rangeDrag = { startX: x, currentX: x, pointerId: event.pointerId }
    chart.hoverRect.node().setPointerCapture?.(event.pointerId)
    hideHoverReadout(chart)
    drawRangeOverlay(chart)
}

function moveDrag(chart, event) {
    if (!chart.rangeDrag || event.pointerId !== chart.rangeDrag.pointerId) return
    event.preventDefault()
    const [rawX] = d3.pointer(event, chart.hoverRect.node())
    chart.rangeDrag.currentX = clampX(chart, rawX)
    drawRangeOverlay(chart)
}

function finishDrag(chart, event) {
    const drag = chart.rangeDrag
    if (!drag || event.pointerId !== drag.pointerId) return
    chart.rangeDrag = null
    releaseCapture(chart, drag.pointerId)
    hideRangeOverlay(chart)

    const left = Math.min(drag.startX, drag.currentX)
    const right = Math.max(drag.startX, drag.currentX)
    if (right - left < MIN_DRAG_PX) return

    const startIdx = indexAtX(chart, left)
    const endIdx = indexAtX(chart, right)
    if (endIdx - startIdx < 1) return

    chart.onRangeSelect?.({
        start: chart.unionDates[startIdx].getTime(),
        end: chart.unionDates[endIdx].getTime()
    })
}

function cancelDrag(chart) {
    const drag = chart.rangeDrag
    chart.rangeDrag = null
    if (drag) releaseCapture(chart, drag.pointerId)
    hideRangeOverlay(chart)
}

function releaseCapture(chart, pointerId) {
    const node = chart.hoverRect?.node?.()
    if (node?.hasPointerCapture?.(pointerId)) node.releasePointerCapture(pointerId)
}

function clampX(chart, x) {
    return Math.max(0, Math.min(chart.width, x))
}

export function drawRangeOverlay(chart) {
    const drag = chart.rangeDrag
    const dates = chart.unionDates ?? []
    if (!drag || !dates.length) {
        hideRangeOverlay(chart)
        return
    }

    const left = Math.min(drag.startX, drag.currentX)
    const right = Math.max(drag.startX, drag.currentX)
    const startIdx = indexAtX(chart, drag.startX)
    const currentIdx = indexAtX(chart, drag.currentX)
    const startDate = dates[startIdx]
    const currentDate = dates[currentIdx]
    const spanMs = Math.abs(currentDate.getTime() - startDate.getTime())
    const startX = chart.xScale(startIdx)
    const currentX = chart.xScale(currentIdx)

    chart.rangeRect
        .attr('x', left)
        .attr('y', 0)
        .attr('width', Math.max(0, right - left))
        .attr('height', chart.height)
        .attr('opacity', 1)

    chart.rangeStartEdge
        .attr('x1', left).attr('x2', left)
        .attr('y1', 0).attr('y2', chart.height)
        .attr('opacity', 1)
    chart.rangeEndEdge
        .attr('x1', right).attr('x2', right)
        .attr('y1', 0).attr('y2', chart.height)
        .attr('opacity', 1)

    const startAnchorStart = startX < chart.width / 2
    chart.rangeStartLabel
        .attr('x', startAnchorStart ? Math.max(4, startX + 4) : startX - 4)
        .attr('y', chart.height - 6)
        .attr('text-anchor', startAnchorStart ? 'start' : 'end')
        .text(formatRangeDate(startDate.getTime(), spanMs))
        .attr('opacity', 1)

    const readoutX = Math.max(READOUT_MARGIN_PX, Math.min(chart.width - READOUT_MARGIN_PX, currentX))
    const lines = [
        { text: formatRangeDate(currentDate.getTime(), spanMs), color: null },
        ...priceLines(chart, currentIdx)
    ]
    chart.rangeCurrentLabel
        .attr('x', readoutX)
        .attr('y', 14)
        .attr('text-anchor', 'middle')
        .attr('opacity', 1)
        .selectAll('tspan')
        .data(lines)
        .join('tspan')
        .attr('x', readoutX)
        .attr('dy', (line, index) => (index === 0 ? 0 : 14))
        .attr('fill', line => line.color)
        .text(line => line.text)
}

export function hideRangeOverlay(chart) {
    chart.rangeRect?.attr('opacity', 0)
    chart.rangeStartEdge?.attr('opacity', 0)
    chart.rangeEndEdge?.attr('opacity', 0)
    chart.rangeStartLabel?.attr('opacity', 0)
    chart.rangeCurrentLabel?.attr('opacity', 0)
}

function priceLines(chart, idx) {
    return (chart.series ?? [])
        .filter(renderer => renderer.native?.length)
        .map(renderer => {
            const candle = renderer.aligned?.[idx]
            if (!candle || !Number.isFinite(candle.close)) return null
            const symbol = renderer.symbol ? `${renderer.symbol} ` : ''
            return {
                text: `${symbol}${formatPrice(candle.close)}`,
                color: renderer.colors?.line ?? null
            }
        })
        .filter(Boolean)
}

function formatRangeDate(ms, spanMs) {
    if (!Number.isFinite(ms)) return ''
    const fmt = spanMs <= SHOW_TIME_SPAN_MS ? '%b %d %Y %H:%M' : '%b %d %Y'
    return d3.timeFormat(fmt)(new Date(ms))
}
