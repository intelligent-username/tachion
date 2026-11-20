import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TChart } from '../js/visualizer'
import { formatPrice } from '../js/visualizer/visualizer-hover'

let chart
let container

const data = Array.from({ length: 50 }, (_, i) => {
    const close = 100 + Math.sin(i / 4) * 8
    return {
        timestamp: new Date(1700000000000 + i * 3600000),
        open: close,
        high: close + 2,
        low: close - 2,
        close
    }
})

const series = () => [{ id: 'one', symbol: 'TEST', assetClass: 'equities', data }]

function pointer(node, type, clientX, clientY = 100) {
    const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY,
        button: 0
    })
    Object.defineProperty(event, 'pointerId', { value: 1 })
    node.dispatchEvent(event)
}

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    container = document.createElement('div')
    container.getBoundingClientRect = () => ({ width: 1000, height: 520, left: 0, top: 0 })
    document.body.appendChild(container)
})

afterEach(() => {
    chart?.destroy()
    container?.remove()
    vi.unstubAllGlobals()
})

it('crosshair mode shows crosshair overlay on mousemove', () => {
    chart = new TChart(container, { onRangeSelect: vi.fn() })
    chart.renderSeries(series(), { cursorMode: 'crosshair' })
    const node = chart.hoverRect.node()

    pointer(node, 'mousemove', 300, 150)

    expect(chart.crosshairLayer.attr('opacity')).toBe('1')
    expect(chart.crosshairVertical.attr('x1')).toBe(chart.crosshairVertical.attr('x2'))
    expect(chart.crosshairHorizontal.attr('y1')).toBe(chart.crosshairHorizontal.attr('y2'))
})

it('crosshair mode shows date label when not on a stock', () => {
    chart = new TChart(container, { onRangeSelect: vi.fn() })
    chart.renderSeries(series(), { cursorMode: 'crosshair' })
    const node = chart.hoverRect.node()

    pointer(node, 'mousemove', 50, 50)

    expect(chart.crosshairDate.attr('opacity')).toBe('1')
    expect(chart.crosshairDate.text()).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)
})

it('crosshair prices follow the vertical stock intersections, not pointer height', () => {
    chart = new TChart(container, { onRangeSelect: vi.fn() })
    chart.renderSeries(series(), { cursorMode: 'crosshair' })
    const node = chart.hoverRect.node()

    const idx = 25
    const x = chart.xScale(idx)
    const renderer = chart.series[0]
    const close = renderer.aligned[idx].close
    for (const y of [10, chart.height - 10]) {
        pointer(node, 'mousemove', x, y)
        const label = chart.crosshairPrices.select('text')
        expect(label.text()).toBe(`TEST: ${formatPrice(close)}`)
        expect(+label.attr('x')).toBeCloseTo(x + 9)
        expect(+label.attr('y')).toBeCloseTo(renderer.yScale(close) - 8)
        const dot = chart.crosshairPrices.select('circle')
        expect(+dot.attr('cx')).toBeCloseTo(x)
        expect(+dot.attr('cy')).toBeCloseTo(renderer.yScale(close))
    }
})

it('snaps to a stock within 6px screen distance', () => {
    chart = new TChart(container, { onRangeSelect: vi.fn() })
    chart.renderSeries(series(), { cursorMode: 'crosshair' })
    const node = chart.hoverRect.node()

    const idx = 25
    const cx = chart.xScale(idx)
    const cy = chart.series[0].yScale(data[idx].close)

    pointer(node, 'mousemove', cx, cy)

    expect(chart.crosshairVertical.attr('x1')).toBe(String(cx))
    expect(chart.crosshairHorizontal.attr('y1')).toBe(String(cy))
    expect(chart.crosshairDate.attr('opacity')).toBe('0')
    expect(chart.tooltip.style('opacity')).toBe('1')
})

it('does not snap outside 6px screen distance', () => {
    chart = new TChart(container, { onRangeSelect: vi.fn() })
    chart.renderSeries(series(), { cursorMode: 'crosshair' })
    const node = chart.hoverRect.node()

    const idx = 25
    const cx = chart.xScale(idx)
    const cy = chart.series[0].yScale(data[idx].close)

    pointer(node, 'mousemove', cx + 20, cy + 20)

    expect(chart.crosshairDate.attr('opacity')).toBe('1')
    expect(chart.tooltip.style('opacity')).toBe('0')
})

it('cursor mode does not show crosshair overlay', () => {
    chart = new TChart(container, { onRangeSelect: vi.fn() })
    chart.renderSeries(series(), { cursorMode: 'cursor' })
    const node = chart.hoverRect.node()

    pointer(node, 'mousemove', 500, 150)

    expect(chart.crosshairLayer.attr('opacity')).toBe('0')
    expect(chart.hoverLine.attr('opacity')).toBe('1')
})

it('crosshair and hover coexist: snap shows tooltip, free shows crosshair labels', () => {
    chart = new TChart(container, { onRangeSelect: vi.fn() })
    chart.renderSeries(series(), { cursorMode: 'crosshair', chartMode: 'bars' })
    const node = chart.hoverRect.node()

    const idx = 25
    const cx = chart.xScale(idx)
    const cy = chart.series[0].yScale(data[idx].close)

    pointer(node, 'mousemove', cx, cy)
    expect(chart.tooltip.style('opacity')).toBe('1')
    expect(chart.crosshairDate.attr('opacity')).toBe('0')

    // Move far from any candle - use a Y well outside the data range
    pointer(node, 'mousemove', 100, 10)
    expect(chart.crosshairDate.attr('opacity')).toBe('1')
    expect(chart.crosshairPrices.selectAll('text').size()).toBe(1)
})

it('mouseleave hides crosshair in crosshair mode', () => {
    chart = new TChart(container, { onRangeSelect: vi.fn() })
    chart.renderSeries(series(), { cursorMode: 'crosshair' })
    const node = chart.hoverRect.node()

    pointer(node, 'mousemove', 500, 150)
    expect(chart.crosshairLayer.attr('opacity')).toBe('1')

    const leaveEvent = new MouseEvent('mouseleave', { bubbles: true })
    node.dispatchEvent(leaveEvent)

    expect(chart.crosshairLayer.attr('opacity')).toBe('0')
})

it('range drag preserves crosshair cleanup', () => {
    chart = new TChart(container, { onRangeSelect: vi.fn() })
    chart.renderSeries(series(), { cursorMode: 'crosshair' })
    const node = chart.hoverRect.node()

    pointer(node, 'mousemove', 500, 150)
    expect(chart.crosshairLayer.attr('opacity')).toBe('1')

    pointer(node, 'pointerdown', 200)
    pointer(node, 'pointermove', 400)
    expect(chart.crosshairLayer.attr('opacity')).toBe('0')
    expect(chart.rangeDrag).toBeTruthy()

    pointer(node, 'pointerup', 400)
    expect(chart.rangeDrag).toBeNull()
    expect(chart.crosshairLayer.attr('opacity')).toBe('0')
})

it('works in line chart mode', () => {
    chart = new TChart(container, { onRangeSelect: vi.fn() })
    chart.renderSeries(series(), { cursorMode: 'crosshair', chartMode: 'line' })
    const node = chart.hoverRect.node()

    pointer(node, 'mousemove', 500, 150)

    expect(chart.crosshairLayer.attr('opacity')).toBe('1')
    expect(chart.crosshairDate.attr('opacity')).toBe('1')
})

it('multiple series shows price labels for each', () => {
    const twoSeries = () => [
        { id: 'one', symbol: 'ONE', assetClass: 'equities', data },
        { id: 'two', symbol: 'TWO', assetClass: 'equities', data: data.map(d => ({ ...d, close: d.close + 20 })) }
    ]
    chart = new TChart(container, { onRangeSelect: vi.fn() })
    chart.renderSeries(twoSeries(), { cursorMode: 'crosshair' })
    const node = chart.hoverRect.node()

    pointer(node, 'mousemove', 500, 150)

    expect(chart.crosshairPrices.selectAll('text').size()).toBe(2)
})

it('mode switch clears crosshair', () => {
    chart = new TChart(container, { onRangeSelect: vi.fn() })
    chart.renderSeries(series(), { cursorMode: 'crosshair' })
    const node = chart.hoverRect.node()

    pointer(node, 'mousemove', 500, 150)
    expect(chart.crosshairLayer.attr('opacity')).toBe('1')

    chart.renderSeries(series(), { cursorMode: 'cursor' })
    expect(chart.crosshairLayer.attr('opacity')).toBe('0')
})

it('resize updates crosshair line dimensions', () => {
    chart = new TChart(container, { onRangeSelect: vi.fn() })
    chart.renderSeries(series(), { cursorMode: 'crosshair' })
    const node = chart.hoverRect.node()

    pointer(node, 'mousemove', 500, 150)
    expect(chart.crosshairVertical.attr('y2')).toBe(String(chart.height))
    expect(chart.crosshairHorizontal.attr('x2')).toBe(String(chart.width))

    container.getBoundingClientRect = () => ({ width: 800, height: 400, left: 0, top: 0 })
    chart.resize()
    expect(chart.crosshairVertical.attr('y2')).toBe(String(chart.height))
    expect(chart.crosshairHorizontal.attr('x2')).toBe(String(chart.width))
})
