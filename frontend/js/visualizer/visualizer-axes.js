// X/Y axis and grid rendering: tick positioning, unique date labels, styling
import * as d3 from 'd3'
import { compositeColor, contrastingAxisColor } from './visualizer-colors'

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
    observeAxisTheme(chart)
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

    const background = chartBackground(chart.container)
    drawLeftAxis(chart, visible, visible.length >= 2, background)
    drawGridLines(chart, visible[0].yScale, tickValues)

    if (visible.length >= 2) {
        drawRightAxis(chart, visible[1], background)
    } else {
        chart.rightYAxis.selectAll('*').remove()
        chart.rightYAxis.style('display', 'none')
    }
}

// Left axis labels stay neutral with one series; with two they take series 1's
// identity color.
function drawLeftAxis(chart, visible, tinted, background) {
    chart.leftYAxis.call(d3.axisLeft(visible[0].yScale).ticks(AXIS_TICK_COUNT))
    applyAxisStrokeAndTextStyling(
        chart.leftYAxis,
        tinted ? axisTextColor(visible[0].colors?.axis, background) : NEUTRAL_TEXT_FILL
    )
}

// Gridlines come only from the left scale and are never tinted.
function drawGridLines(chart, yScale, tickValues) {
    const yGrid = d3.axisLeft(yScale)
        .ticks(AXIS_TICK_COUNT)
        .tickSize(-chart.width)
        .tickFormat('')
    chart.gridLayer.call(yGrid)
    chart.gridLayer.selectAll('line.vertical-grid')
        .data(tickValues)
        .join('line')
        .attr('class', 'vertical-grid')
        .attr('x1', value => chart.xScale(value))
        .attr('x2', value => chart.xScale(value))
        .attr('y1', 0)
        .attr('y2', chart.height)
    chart.gridLayer.selectAll('line').attr('stroke', GRID_STROKE)
    chart.gridLayer.selectAll('path').attr('stroke', 'transparent')
}

// Right axis for the second visible series, offset to the plot's right edge.
function drawRightAxis(chart, series, background) {
    chart.rightYAxis
        .attr('transform', `translate(${chart.width},0)`)
        .style('display', 'block')
    chart.rightYAxis.call(d3.axisRight(series.yScale).ticks(AXIS_TICK_COUNT))
    applyAxisStrokeAndTextStyling(chart.rightYAxis, axisTextColor(series.colors?.axis, background))
}

function axisTextColor(value, background) {
    const color = d3.color(value)?.rgb()
    if (!color) return NEUTRAL_TEXT_FILL
    const result = contrastingAxisColor(color, background)
    return `rgb(${result.r}, ${result.g}, ${result.b})`
}

// The SVG host is transparent; include all translucent ancestor backgrounds.
function chartBackground(element) {
    const layers = []
    for (let node = element; node; node = node.parentElement) {
        const color = d3.color(getComputedStyle(node).backgroundColor)?.rgb()
        if (color && color.opacity > 0) layers.push(color)
    }
    return layers.reverse().reduce((background, layer) => compositeColor(layer, background),
        { r: 255, g: 255, b: 255, opacity: 1 })
}

function refreshAxisColors(chart) {
    const visible = (chart.series ?? []).filter(series => series.native?.length)
    if (visible.length < 2) return
    const background = chartBackground(chart.container)
    chart.leftYAxis.selectAll('text').attr('fill', axisTextColor(visible[0].colors?.axis, background))
    chart.rightYAxis.selectAll('text').attr('fill', axisTextColor(visible[1].colors?.axis, background))
}

function observeAxisTheme(chart) {
    if (chart.axisThemeObserver) return
    const observer = new MutationObserver(() => refreshAxisColors(chart))
    for (let node = chart.container; node; node = node.parentElement) {
        observer.observe(node, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
    }
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    const onChange = () => refreshAxisColors(chart)
    media?.addEventListener?.('change', onChange)
    chart.axisThemeObserver = { observer, media, onChange }
}

export function disconnectAxisTheme(chart) {
    const theme = chart.axisThemeObserver
    theme?.observer.disconnect()
    theme?.media?.removeEventListener?.('change', theme.onChange)
    chart.axisThemeObserver = null
}

// Composed x axis draw: bottom axis, edge label anchoring, shared styling.
// History and future overlays use the chart-owned coordinated scale.
export function drawStyledXAxis(chart, scale, tickValues, tickFormat) {
    const axis = d3.axisBottom(scale)
        .tickValues(tickValues)
        .tickFormat(tickFormat)
    chart.xAxis.call(axis)
    applyXAxisLabelAnchoring(chart.xAxis, scale, chart.width)
    applyAxisStrokeAndTextStyling(chart.xAxis)
}
