// Classic-only supporting strips. Values come from the mapped band geometry.
import * as d3 from 'd3'

const SUBPANEL_HEIGHT = 110
const SUBPANEL_BREAKPOINT = 640
const HEADER_HEIGHT = 44
const PANELS = [
    { key: 'percentB', label: '%B', domain: [0, 1], ticks: [0, 0.5, 1] },
    { key: 'bandwidth', label: 'Bandwidth', domain: [0, 1.5], ticks: [0, 0.75, 1.5] }
]

/** Sole height-budget owner; constrained strips yield to the price plot. */
export function resolveSubpanelLayout(chart, { fullWidth, availableHeight, minPriceHeight }) {
    if (!chart.subpanelDefaultsSet) {
        const collapsed = fullWidth < SUBPANEL_BREAKPOINT
        chart.subpanelCollapsed = { percentB: collapsed, bandwidth: collapsed }
        chart.subpanelDefaultsSet = true
    }
    const active = chart.showBollingerBands && chart.series.some(renderer =>
        renderer.native.length && renderer.assetClass !== 'interest')
    if (!active) return { priceHeight: availableHeight, xAxisY: availableHeight, panels: [] }

    // At exceptionally short heights, put the two collapsed headers side by
    // side rather than stealing the minimum price plot height.
    const sharedHeader = availableHeight < minPriceHeight + HEADER_HEIGHT * PANELS.length
    const headerBudget = HEADER_HEIGHT * (sharedHeader ? 1 : PANELS.length)
    let extra = Math.max(0, availableHeight - minPriceHeight - headerBudget)
    const expanded = new Set()
    const priority = [...PANELS].sort((a, b) =>
        Number(b.key === chart.lastExpandedSubpanel) - Number(a.key === chart.lastExpandedSubpanel))
    for (const panel of priority) {
        if (!sharedHeader && !chart.subpanelCollapsed[panel.key] && extra >= SUBPANEL_HEIGHT - HEADER_HEIGHT) {
            expanded.add(panel.key)
            extra -= SUBPANEL_HEIGHT - HEADER_HEIGHT
        }
    }
    const priceHeight = Math.max(minPriceHeight, availableHeight - headerBudget -
        expanded.size * (SUBPANEL_HEIGHT - HEADER_HEIGHT))
    let top = priceHeight
    const panels = PANELS.map((panel, index) => {
        const isExpanded = expanded.has(panel.key)
        const height = isExpanded ? SUBPANEL_HEIGHT : HEADER_HEIGHT
        const layout = { ...panel, top, height, expanded: isExpanded,
            left: sharedHeader ? index * chart.width / 2 : 0,
            width: sharedHeader ? chart.width / 2 : chart.width,
            canExpand: !sharedHeader && availableHeight >= minPriceHeight + HEADER_HEIGHT + SUBPANEL_HEIGHT }
        if (!sharedHeader) top += height
        return layout
    })
    return { priceHeight, panels, xAxisY: sharedHeader ? priceHeight + HEADER_HEIGHT : top }
}

/** Release strip paths and controls without changing the local preferences. */
export function clearSubpanels(chart) {
    chart.subpanelLayer.selectAll('*').remove()
    chart.defs.selectAll('.subpanel-clip').remove()
}

/** Draw two shared, clipped strips with keyed per-series paths and native buttons. */
export function drawSubpanels(chart) {
    const panels = chart.subpanelLayout.panels
    if (!panels.length) { clearSubpanels(chart); return }
    const renderers = chart.series.filter(renderer => renderer.native.length && renderer.assetClass !== 'interest')
    const symbols = renderers.map(renderer => renderer.symbol || 'asset').join(', ')
    const groups = chart.subpanelLayer.selectAll('g.chart-subpanel').data(panels, panel => panel.key)
        .join(enter => {
            const group = enter.append('g').attr('class', 'chart-subpanel')
            group.append('g').attr('class', 'subpanel-ticks').style('pointer-events', 'none')
            group.append('g').attr('class', 'subpanel-paths').style('pointer-events', 'none')
            group.append('foreignObject').attr('class', 'subpanel-header')
                .append('xhtml:button').attr('type', 'button').attr('class', 'chart-subpanel-toggle')
            return group
        })
        .attr('transform', panel => `translate(${panel.left},${panel.top})`)

    groups.each(function (panel) {
        const group = d3.select(this)
        const contentId = `${chart.chartId}-${panel.key}`
        const clipId = `${contentId}-clip`
        group.select('foreignObject').attr('width', panel.width).attr('height', HEADER_HEIGHT)
        group.select('button')
            .attr('aria-label', `${panel.expanded ? 'Collapse' : 'Expand'} ${panel.label} strip`)
            .attr('aria-expanded', String(panel.expanded)).attr('aria-controls', contentId)
            .property('disabled', !panel.expanded && !panel.canExpand)
            .attr('title', panel.canExpand ? null : 'More chart height is needed to expand this strip.')
            .text(`${panel.expanded ? '−' : '+'} ${panel.label}`)
            .on('click', () => {
                chart.subpanelCollapsed[panel.key] = panel.expanded
                if (!panel.expanded) chart.lastExpandedSubpanel = panel.key
                chart.redrawFromCache()
            })

        const plotTop = HEADER_HEIGHT + 4
        const plotBottom = panel.height - 6
        const yScale = d3.scaleLinear().domain(panel.domain).range([plotBottom, plotTop])
        const clip = chart.defs.selectAll(`clipPath[id="${clipId}"]`).data([panel]).join('clipPath')
            .attr('class', 'subpanel-clip').attr('id', clipId)
        clip.selectAll('rect').data([panel]).join('rect').attr('x', 0).attr('y', plotTop)
            .attr('width', panel.width).attr('height', Math.max(0, plotBottom - plotTop))
        const paths = group.select('.subpanel-paths').attr('id', contentId)
            .attr('clip-path', `url(#${clipId})`).attr('role', 'img')
            .attr('aria-label', `${panel.label} for ${symbols}; scale ${panel.domain[0]} to ${panel.domain[1]}.`)
            .attr('aria-hidden', String(!panel.expanded))
        const line = d3.line().defined(point => point && Number.isFinite(point[panel.key]))
            .x(point => chart.xScale(point.x)).y(point => yScale(point[panel.key]))
        paths.selectAll('path').data(panel.expanded ? renderers : [], renderer => renderer.id).join('path')
            .attr('fill', 'none').attr('stroke', renderer => renderer.colors.line)
            .attr('stroke-width', 1.3).attr('stroke-dasharray', renderer => renderer.colors.dash)
            .attr('d', renderer => line(renderer.bandPoints?.bollinger ?? []))
        const ticks = group.select('.subpanel-ticks').selectAll('g').data(panel.expanded ? panel.ticks : [])
            .join(enter => {
                const tick = enter.append('g')
                tick.append('line')
                tick.append('text')
                return tick
            }).attr('transform', value => `translate(0,${yScale(value)})`)
        ticks.select('line').attr('x2', panel.width).attr('stroke', 'rgba(255,255,255,0.08)')
        ticks.select('text').attr('x', 4).attr('dy', '-0.2em').attr('fill', 'rgba(238,238,238,0.75)')
            .style('font-size', '10px').text(value => value)
    })
}
