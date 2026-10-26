// SVG structure construction: layers, gradients, path elements, axes groups, tooltip
import * as d3 from 'd3'

export const CHART_MARGIN = { top: 18, right: 18, bottom: 26, left: 54 }

// Builds the full SVG skeleton for the chart inside `container` and returns
// every element reference needed by the render/hover/prediction helpers.
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

    // Gradient definitions for stock price area chart
    const defs = rootSvg.append('defs')

    // Neutral gradient for stock price area chart
    const neutralGrad = defs.append('linearGradient')
        .attr('id', 'price-area-gradient-neutral')
        .attr('x1', '0%').attr('y1', '0%')
        .attr('x2', '0%').attr('y2', '100%')
    neutralGrad.append('stop').attr('offset', '0%').attr('stop-color', 'rgba(238, 238, 238, 0.95)').attr('stop-opacity', 0.22)
    neutralGrad.append('stop').attr('offset', '80%').attr('stop-color', 'rgba(238, 238, 238, 0.95)').attr('stop-opacity', 0.04)
    neutralGrad.append('stop').attr('offset', '100%').attr('stop-color', 'rgba(238, 238, 238, 0.95)').attr('stop-opacity', 0)

    const svg = rootSvg.append('g')

    const gridLayer = svg.append('g').attr('class', 'grid-layer')
    const candleLayer = svg.append('g').attr('class', 'candle-layer')
    const priceAreaLayer = svg.append('g').attr('class', 'price-area-layer')
    const overlayLayer = svg.append('g').attr('class', 'overlay-layer')

    // Stock Price Mode Line and Area paths
    const priceArea = priceAreaLayer.append('path')
        .attr('class', 'stock-price-area')
        .attr('fill', 'url(#price-area-gradient-up)')
        .attr('opacity', 0)

    const priceLine = priceAreaLayer.append('path')
        .attr('class', 'stock-price-line')
        .attr('fill', 'none')
        .attr('stroke', '#27ae60')
        .attr('stroke-width', 2.2)
        .attr('stroke-linejoin', 'round')
        .attr('stroke-linecap', 'round')
        .attr('opacity', 0)
        .style('cursor', 'pointer')
        .style('transition', 'opacity 0.2s ease, stroke-width 0.2s ease')

    const priceHoverDot = priceAreaLayer.append('circle')
        .attr('class', 'stock-price-dot')
        .attr('r', 5)
        .attr('fill', '#27ae60')
        .attr('stroke', '#ffffff')
        .attr('stroke-width', 2)
        .attr('opacity', 0)

    const xAxis = overlayLayer.append('g')
        .attr('class', 'x-axis')

    const yAxis = overlayLayer.append('g')
        .attr('class', 'y-axis')

    const predictionLine = overlayLayer.append('path')
        .attr('class', 'prediction-line')
        .attr('fill', 'none')
        .attr('stroke', 'rgba(114, 137, 218, 0.95)')
        .attr('stroke-width', 1.8)
        .attr('stroke-dasharray', '3,3')
        .attr('opacity', 0)
        .style('cursor', 'pointer')
        .style('transition', 'opacity 0.2s ease, stroke-width 0.2s ease')

    const predictionBand = overlayLayer.append('path')
        .attr('class', 'prediction-band')
        .attr('fill', 'rgba(67, 78, 117, 0.1)')
        .attr('stroke', 'none')
        .attr('opacity', 0)
        .style('transition', 'opacity 0.2s ease')

    const predictionUpper = overlayLayer.append('path')
        .attr('class', 'prediction-upper')
        .attr('fill', 'none')
        .attr('stroke', 'rgba(37, 119, 115, 0.45)')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '2,2')
        .attr('opacity', 0)
        .style('transition', 'opacity 0.2s ease')

    const predictionLower = overlayLayer.append('path')
        .attr('class', 'prediction-lower')
        .attr('fill', 'none')
        .attr('stroke', 'rgba(146, 81, 28, 0.45)')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '2,2')
        .attr('opacity', 0)
        .style('transition', 'opacity 0.2s ease')

    const movingAverageLine = overlayLayer.append('path')
        .attr('class', 'moving-average-line')
        .attr('fill', 'none')
        .attr('stroke', 'rgba(241, 196, 15, 0.95)')
        .attr('stroke-width', 1.8)
        .attr('opacity', 0)
        .style('cursor', 'pointer')
        .style('transition', 'opacity 0.2s ease, stroke-width 0.2s ease')

    const exponentialMovingAverageLine = overlayLayer.append('path')
        .attr('class', 'exponential-moving-average-line')
        .attr('fill', 'none')
        .attr('stroke', 'rgba(0, 210, 255, 0.95)')
        .attr('stroke-width', 1.8)
        .attr('opacity', 0)
        .style('cursor', 'pointer')
        .style('transition', 'opacity 0.2s ease, stroke-width 0.2s ease')

    const hoverLine = overlayLayer.append('line')
        .attr('class', 'hover-line')
        .attr('stroke', 'rgba(255,255,255,0.3)')
        .attr('stroke-width', 1)
        .attr('y1', 0)
        .attr('opacity', 0)

    const hoverRect = overlayLayer.append('rect')
        .attr('class', 'hover-capture')
        .attr('fill', 'transparent')
        .style('pointer-events', 'all')

    const tooltip = d3.select(container)
        .append('div')
        .attr('class', 'chart-tooltip')
        .style('opacity', 0)

    return {
        rootSvg, defs, svg,
        gridLayer, candleLayer, priceAreaLayer, overlayLayer,
        priceArea, priceLine, priceHoverDot,
        xAxis, yAxis,
        predictionLine, predictionBand, predictionUpper, predictionLower,
        movingAverageLine, exponentialMovingAverageLine,
        hoverLine, hoverRect, tooltip
    }
}
