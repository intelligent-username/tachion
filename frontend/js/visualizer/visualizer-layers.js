// SVG structure construction: layered containers, defs, axes groups, tooltip
import * as d3 from 'd3'

export const CHART_MARGIN = { top: 18, right: 18, bottom: 26, left: 54 }

// Reserved right margin when a second series needs its own axis
export const SERIES_AXIS_MARGIN_RIGHT = 54

// Builds the layered SVG skeleton for the chart inside `container`.
// Per-series elements are created by visualizer-series.js.
export function initChartSvg(container) {
    // Clear any existing content
    d3.select(container).selectAll('*').remove()

    // Create responsive SVG that fills the chart container
    const rootSvg = d3.select(container)
        .append('svg')
        .attr('class', 'tick-chart-svg')
        .attr('width', '100%')
        .attr('height', '100%')
        .attr('preserveAspectRatio', 'none')

    // Per-series gradients are registered here by the series renderer factory
    const defs = rootSvg.append('defs')

    const svg = rootSvg.append('g')

    // Stable z-order: grid, series candles, series price, indicators,
    // predictions, axes, hover
    const gridLayer = svg.append('g').attr('class', 'grid-layer')
    const seriesCandlesLayer = svg.append('g').attr('class', 'series-candles-layer')
    const seriesPriceLayer = svg.append('g').attr('class', 'series-price-layer')
    const indicatorLayer = svg.append('g').attr('class', 'indicator-layer')
    const predictionLayer = svg.append('g').attr('class', 'prediction-layer')

    const axisLayer = svg.append('g').attr('class', 'axis-layer')

    const xAxis = axisLayer.append('g')
        .attr('class', 'x-axis')

    const leftYAxis = axisLayer.append('g')
        .attr('class', 'y-axis y-axis-left')

    const rightYAxis = axisLayer.append('g')
        .attr('class', 'y-axis y-axis-right')
        .style('display', 'none')

    const hoverLayer = svg.append('g').attr('class', 'hover-layer')

    const hoverLine = hoverLayer.append('line')
        .attr('class', 'hover-line')
        .attr('stroke', 'rgba(255,255,255,0.3)')
        .attr('stroke-width', 1)
        .attr('y1', 0)
        .attr('opacity', 0)

    const hoverRect = hoverLayer.append('rect')
        .attr('class', 'hover-capture')
        .attr('fill', 'transparent')
        .style('pointer-events', 'all')

    const tooltip = d3.select(container)
        .append('div')
        .attr('class', 'chart-tooltip')
        .style('opacity', 0)

    return {
        rootSvg, defs, svg,
        gridLayer, seriesCandlesLayer, seriesPriceLayer,
        indicatorLayer, predictionLayer, axisLayer,
        xAxis, leftYAxis, rightYAxis,
        hoverLayer, hoverLine, hoverRect, tooltip
    }
}
