import { expect, it, vi } from 'vitest'
import { color } from 'd3'
import { TChart } from '../js/visualizer'
import { compositeColor, contrastRatio, contrastingAxisColor, SERIES_COLORS } from '../js/visualizer/visualizer-colors'

it('meets text contrast on dark, light and mid-tone backgrounds without changing series colors', () => {
    for (const background of ['#101827', '#ffffff', '#777777', '#0c1629']) {
        for (const series of SERIES_COLORS) {
            const original = color(series.axis).rgb()
            const adjusted = contrastingAxisColor(original, color(background).rgb())
            expect(contrastRatio(adjusted, color(background).rgb())).toBeGreaterThanOrEqual(4.5)
            expect(series.line).toBe(series.axis)
        }
    }
})

it('updates axis contrast when an ancestor theme changes, including translucent backgrounds', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    const parent = document.createElement('div')
    const container = document.createElement('div')
    parent.style.backgroundColor = 'rgb(20, 30, 40)'
    container.style.backgroundColor = 'rgba(100, 120, 140, 0.5)'
    container.getBoundingClientRect = () => ({ width: 1000, height: 520 })
    parent.appendChild(container)
    document.body.appendChild(parent)
    const chart = new TChart(container)
    try {
        const data = [100, 104].map((close, i) => ({
            timestamp: new Date(1700000000000 + i * 1800000),
            open: close, high: close + 1, low: close - 1, close
        }))
        chart.renderSeries([{ id: 'one', data }, { id: 'two', data }], { chartMode: 'line' })
        const check = () => {
            const background = compositeColor(color(container.style.backgroundColor).rgb(), color(parent.style.backgroundColor).rgb())
            for (const axis of [chart.leftYAxis, chart.rightYAxis]) {
                expect(contrastRatio(color(axis.select('text').attr('fill')).rgb(), background)).toBeGreaterThanOrEqual(4.5)
            }
        }
        check()
        const previous = chart.leftYAxis.select('text').attr('fill')
        parent.style.backgroundColor = 'rgb(250, 250, 250)'
        await Promise.resolve()
        check()
        expect(chart.leftYAxis.select('text').attr('fill')).not.toBe(previous)
        expect(chart.series.map(series => series.colors.line)).toEqual(SERIES_COLORS.map(series => series.line))
    } finally {
        chart.destroy()
        parent.remove()
        vi.unstubAllGlobals()
    }
})
