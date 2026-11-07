import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TChart } from '../js/visualizer'

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

function pointer(node, type, clientX) {
    const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY: 100,
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

it('reports a forward drag, filters the view, and restores on Reset', () => {
    const onRangeSelect = vi.fn()
    chart = new TChart(container, { onRangeSelect })
    chart.renderSeries(series())
    const node = chart.hoverRect.node()

    pointer(node, 'pointerdown', 200)
    expect(chart.rangeDrag).toBeTruthy()
    pointer(node, 'pointermove', 400)
    pointer(node, 'pointerup', 400)

    expect(chart.rangeDrag).toBeNull()
    expect(chart.rangeRect.attr('opacity')).toBe('0')
    expect(onRangeSelect).toHaveBeenCalledTimes(1)
    const range = onRangeSelect.mock.calls[0][0]
    expect(range.start).toBe(chart.unionDates[11].getTime())
    expect(range.end).toBe(chart.unionDates[21].getTime())
    expect(range.start).toBeLessThan(range.end)

    chart.renderSeries(series(), { range })
    expect(chart.selectedRange).toEqual(range)
    expect(chart.unionDates).toHaveLength(11)

    chart.renderSeries(series(), { range: null })
    expect(chart.selectedRange).toBeNull()
    expect(chart.unionDates).toHaveLength(50)
})

it('reports a reverse drag ascending and ignores a tiny drag', () => {
    const onRangeSelect = vi.fn()
    chart = new TChart(container, { onRangeSelect })
    chart.renderSeries(series())
    const node = chart.hoverRect.node()

    pointer(node, 'pointerdown', 500)
    pointer(node, 'pointermove', 300)
    pointer(node, 'pointerup', 300)
    const range = onRangeSelect.mock.calls[0][0]
    expect(range.start).toBe(chart.unionDates[16].getTime())
    expect(range.end).toBe(chart.unionDates[26].getTime())

    onRangeSelect.mockClear()
    pointer(node, 'pointerdown', 200)
    pointer(node, 'pointermove', 202)
    pointer(node, 'pointerup', 202)
    expect(onRangeSelect).not.toHaveBeenCalled()
})

it('retains a forecast for a series outside the selected range until Reset', () => {
    const later = data.map(row => ({
        ...row,
        timestamp: new Date(row.timestamp.getTime() + 365 * 24 * 3600000)
    }))
    const twoSeries = () => [
        { id: 'one', symbol: 'ONE', assetClass: 'equities', data },
        { id: 'two', symbol: 'TWO', assetClass: 'equities', data: later }
    ]
    const prediction = { predictions: [{ median: 1, upper: 2, lower: 0 }] }

    chart = new TChart(container)
    chart.renderSeries(twoSeries())
    chart.applyPredictions({ one: prediction, two: prediction })

    const range = { start: data[10].timestamp.getTime(), end: data[20].timestamp.getTime() }
    chart.renderSeries(twoSeries(), { range })
    expect(chart.series.find(renderer => renderer.id === 'two').native).toHaveLength(0)
    expect(chart.appliedPredictions.two).toBeTruthy()

    chart.renderSeries(twoSeries(), { range: null })
    expect(chart.series.find(renderer => renderer.id === 'two').currentPredictionPoints?.length)
        .toBeGreaterThan(1)
})

it('drops a range that contains fewer than two candles', () => {
    const onRangeSelect = vi.fn()
    chart = new TChart(container, { onRangeSelect })
    chart.renderSeries(series())

    chart.renderSeries(series(), { range: { start: 1, end: 2 } })
    expect(onRangeSelect).toHaveBeenCalledWith(null)
    expect(chart.selectedRange).toBeNull()
    expect(chart.unionDates).toHaveLength(50)
})
