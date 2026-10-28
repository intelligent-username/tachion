// X/Y axis and grid rendering: tick positioning, unique date labels, styling
import * as d3 from 'd3'

const fmtDay = d3.timeFormat('%b %d')
const fmtDayYear = d3.timeFormat('%b %d %Y')
const fmtTime = d3.timeFormat('%b %d %H:%M')
const fmtTimeYear = d3.timeFormat('%b %d %Y %H:%M')
const fmtIso = d3.timeFormat('%Y-%m-%d %H:%M')

const AXIS_TICK_COUNT = 6
const AXIS_STROKE = 'rgba(255,255,255,0.2)'
const GRID_STROKE = 'rgba(255,255,255,0.08)'
const NEUTRAL_TEXT_FILL = 'rgba(238,238,238,0.75)'

// Build index-based tick positions and unique date labels for the x axis.
// The x axis is index-based (not wall-clock continuous) to avoid
// weekend/closed-market gaps.
export function buildXTicks(baseDates) {
    const xMax = Math.max(1, baseDates.length - 1)

    const spanMs = baseDates.length > 1
        ? baseDates[baseDates.length - 1] - baseDates[0]
        : 0
    const DAY = 24 * 60 * 60 * 1000
    const showTime = spanMs <= 14 * DAY
    const mayShowYear = spanMs > 7 * DAY

    const latestYear = baseDates.length
        ? baseDates[baseDates.length - 1].getFullYear()
        : new Date().getFullYear()

    const xTickFormatter = (dt) => {
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

    // Use explicit integer tick positions to avoid repeated labels caused by
    // multiple tick values rounding to the same candle index.
    const desiredTicks = Math.min(8, baseDates.length)
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

    const labelMap = new Map()
    const usedLabels = new Set()
    let prevTickYear = null

    for (const i of tickValues) {
        const dt = baseDates[i]
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

        // If formatting would duplicate an existing label, promote to a more
        // specific format (add time/year) to guarantee uniqueness.
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

    return { xMax, tickValues, labelMap, xTickFormatter }
}

// Anchor tick labels so edge ticks don't get clipped by the chart bounds
export function applyXAxisLabelAnchoring(axisSelection, scale, width) {
    axisSelection.selectAll('.tick text')
        .attr('text-anchor', (d) => {
            const px = scale(d)
            if (px > width - 8) return 'end'
            if (px < 8) return 'start'
            return 'middle'
        })
        .attr('dx', (d) => {
            const px = scale(d)
            if (px > width - 8) return '-0.4em'
            if (px < 8) return '0.4em'
            return '0'
        })
}

export function applyAxisStrokeAndTextStyling(axisSelection, textFill = NEUTRAL_TEXT_FILL) {
    axisSelection.selectAll('path,line').attr('stroke', AXIS_STROKE)
    axisSelection.selectAll('text').attr('fill', textFill).style('font-size', '10px')
}

// Draw the x axis and the left/right y axes. The left axis owns the gridlines;
// the right axis only appears when a second series has data.
export function drawAxes(chart, { tickValues, labelMap }) {
    drawStyledXAxis(
        chart,
        chart.xScale,
        tickValues,
        (v) => labelMap.get(Math.round(v)) ?? ''
    )

    const visible = (chart.series ?? []).filter(s => s.native && s.native.length > 0)

    if (visible.length === 0) {
        chart.leftYAxis.selectAll('*').remove()
        chart.rightYAxis.selectAll('*').remove()
        chart.rightYAxis.style('display', 'none')
        chart.gridLayer.selectAll('*').remove()
        return
    }

    drawLeftAxis(chart, visible, visible.length >= 2)
    drawGridLines(chart, visible[0].yScale)

    if (visible.length >= 2) {
        drawRightAxis(chart, visible[1])
    } else {
        chart.rightYAxis.selectAll('*').remove()
        chart.rightYAxis.style('display', 'none')
    }
}

// Left axis labels stay neutral with one series; with two they take series 1's
// identity color.
function drawLeftAxis(chart, visible, tinted) {
    chart.leftYAxis.call(d3.axisLeft(visible[0].yScale).ticks(AXIS_TICK_COUNT))
    applyAxisStrokeAndTextStyling(
        chart.leftYAxis,
        tinted ? visible[0].colors?.axis : NEUTRAL_TEXT_FILL
    )
}

// Gridlines come only from the left scale and are never tinted.
function drawGridLines(chart, yScale) {
    const yGrid = d3.axisLeft(yScale)
        .ticks(AXIS_TICK_COUNT)
        .tickSize(-chart.width)
        .tickFormat('')
    chart.gridLayer.call(yGrid)
    chart.gridLayer.selectAll('line').attr('stroke', GRID_STROKE)
    chart.gridLayer.selectAll('path').attr('stroke', 'transparent')
}

// Right axis for the second visible series, offset to the plot's right edge.
function drawRightAxis(chart, series) {
    chart.rightYAxis
        .attr('transform', `translate(${chart.width},0)`)
        .style('display', 'block')
    chart.rightYAxis.call(d3.axisRight(series.yScale).ticks(AXIS_TICK_COUNT))
    applyAxisStrokeAndTextStyling(chart.rightYAxis, series.colors?.axis)
}

// Composed x axis draw: bottom axis, edge label anchoring, shared styling.
// Used by both the historical axes and the prediction overlay's extended axis.
export function drawStyledXAxis(chart, scale, tickValues, tickFormat) {
    const axis = d3.axisBottom(scale)
        .tickValues(tickValues)
        .tickFormat(tickFormat)
    chart.xAxis.call(axis)
    applyXAxisLabelAnchoring(chart.xAxis, scale, chart.width)
    applyAxisStrokeAndTextStyling(chart.xAxis)
}
