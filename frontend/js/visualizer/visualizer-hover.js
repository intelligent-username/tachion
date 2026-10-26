// Hover interactivity: line highlighting, crosshair, tooltip content/positioning
import * as d3 from 'd3'

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

// Dim non-hovered lines and emphasize the hovered one (ma/ema/prediction/price)
export function applyLineOpacities(chart) {
    const h = chart.hoveredLine

    if (chart.showMovingAverage) {
        const targetOpacity = h === null ? chart.baseOpacities.ma : (h === 'ma' ? 1 : 0.15)
        chart.movingAverageLine
            .attr('opacity', targetOpacity)
            .attr('stroke-width', h === 'ma' ? 2.5 : 1.8)
    }

    if (chart.showExponentialMovingAverage) {
        const targetOpacity = h === null ? chart.baseOpacities.ema : (h === 'ema' ? 1 : 0.15)
        chart.exponentialMovingAverageLine
            .attr('opacity', targetOpacity)
            .attr('stroke-width', h === 'ema' ? 2.5 : 1.8)
    }

    if (chart.hasPrediction) {
        const targetPred = h === null ? chart.baseOpacities.prediction : (h === 'prediction' ? 1 : 0.15)
        const targetBounds = h === null ? 1 : (h === 'prediction' ? 1 : 0.15)
        chart.predictionLine
            .attr('opacity', targetPred)
            .attr('stroke-width', h === 'prediction' ? 2.5 : 1.8)
        chart.predictionBand.attr('opacity', targetBounds)
        chart.predictionUpper.attr('opacity', targetBounds)
        chart.predictionLower.attr('opacity', targetBounds)
    }

    if (chart.chartMode === 'line') {
        const targetPrice = h === null ? chart.baseOpacities.price : (h === 'price' ? 1 : 0.15)
        chart.priceLine
            .attr('opacity', targetPrice)
            .attr('stroke-width', h === 'price' ? 3.0 : 2.2)
        chart.priceArea.attr('opacity', targetPrice)
    }
}

// Build tooltip HTML for the hovered candle, depending on chart mode
function buildTooltipContent(d, dateLabel, chartMode) {
    if (chartMode === 'line') {
        return `<div><strong>Time:</strong> ${dateLabel}</div>` +
            `<div><strong>Price:</strong> ${formatPrice(d.close)}</div>` +
            `<div><strong>Volume:</strong> ${formatVolume(d.volume)}</div>`
    }
    return `<div><strong>Time:</strong> ${dateLabel}</div>` +
        `<div><strong>Open:</strong> ${formatPrice(d.open)}</div>` +
        `<div><strong>High:</strong> ${formatPrice(d.high)}</div>` +
        `<div><strong>Low:</strong> ${formatPrice(d.low)}</div>` +
        `<div><strong>Close:</strong> ${formatPrice(d.close)}</div>` +
        `<div><strong>Volume:</strong> ${formatVolume(d.volume)}</div>`
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

// Bind mousemove/mouseleave handlers: crosshair, hover dot, line proximity
// detection, and tooltip display.
export function bindHover(chart) {
    chart.hoverRect
        .on('mousemove', (event) => {
            if (!chart.indexedCandles.length) return

            const [x, y] = d3.pointer(event, chart.hoverRect.node())
            const idx = Math.max(0, Math.min(chart.indexedCandles.length - 1, Math.round(chart.xScale.invert(x))))
            const d = chart.indexedCandles[idx]
            if (!d) return

            const cx = chart.xScale(d._i)
            const cy = chart.yScale(d.close)

            // Detect line hover based on distance in Y to lines at current X/idx
            let closestLine = null
            let minDistance = 14 // Threshold in pixels

            if (chart.chartMode === 'line') {
                const distPrice = Math.abs(y - cy)
                if (distPrice < minDistance) {
                    minDistance = distPrice
                    closestLine = 'price'
                }
            }

            if (chart.showMovingAverage && chart.currentMaPoints && chart.currentMaPoints[idx]) {
                const maY = chart.yScale(chart.currentMaPoints[idx].y)
                const distMa = Math.abs(y - maY)
                if (distMa < minDistance) {
                    minDistance = distMa
                    closestLine = 'ma'
                }
            }

            if (chart.showExponentialMovingAverage && chart.currentEmaPoints && chart.currentEmaPoints[idx]) {
                const emaY = chart.yScale(chart.currentEmaPoints[idx].y)
                const distEma = Math.abs(y - emaY)
                if (distEma < minDistance) {
                    minDistance = distEma
                    closestLine = 'ema'
                }
            }

            if (chart.hasPrediction && chart.currentPredictionPoints) {
                const predPt = chart.currentPredictionPoints.find(p => p.x === idx)
                if (predPt) {
                    const predY = chart.yScale(predPt.y)
                    const distPred = Math.abs(y - predY)
                    if (distPred < minDistance) {
                        minDistance = distPred
                        closestLine = 'prediction'
                    }
                }
            }

            if (chart.hoveredLine !== closestLine) {
                chart.hoveredLine = closestLine
                applyLineOpacities(chart)
            }

            chart.hoverLine
                .attr('x1', cx)
                .attr('x2', cx)
                .attr('opacity', 1)

            if (chart.chartMode === 'line') {
                chart.priceHoverDot
                    .attr('cx', cx)
                    .attr('cy', cy)
                    .attr('opacity', 1)
            } else {
                chart.priceHoverDot.attr('opacity', 0)
            }

            const dateLabel = d3.timeFormat('%Y-%m-%d %H:%M')(d.date)
            chart.tooltip
                .html(buildTooltipContent(d, dateLabel, chart.chartMode))
                .style('opacity', 1)

            positionTooltip(chart, cx, chart.chartMode === 'line' ? cy : chart.yScale(d.high))
        })
        .on('mouseleave', () => {
            chart.hoverLine.attr('opacity', 0)
            chart.priceHoverDot.attr('opacity', 0)
            chart.tooltip.style('opacity', 0)
            if (chart.hoveredLine !== null) {
                chart.hoveredLine = null
                applyLineOpacities(chart)
            }
        })
}
