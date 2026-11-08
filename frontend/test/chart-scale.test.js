import { expect, it, vi } from 'vitest'
import { TChart } from '../js/visualizer'

it('keeps a padded, rounded scale when either band is toggled', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    const container = document.createElement('div')
    container.getBoundingClientRect = () => ({ width: 1000, height: 520 })
    document.body.appendChild(container)
    const chart = new TChart(container)
    const data = Array.from({ length: 50 }, (_, i) => {
        const close = 100 + Math.sin(i / 4) * 8
        return { timestamp: new Date(1700000000000 + i * 1800000), open: close, high: close + 2, low: close - 2, close }
    })
    const series = [{ id: 'one', symbol: 'TEST', assetClass: 'equities', data }]
    const domain = options => { chart.renderSeries(series, options); return chart.series[0].yScale.domain() }
    const base = domain({ showBollingerBands: false, showVolatilityBands: false })
    expect(domain({ showBollingerBands: true })).toEqual(base)
    expect(domain({ showVolatilityBands: true })).toEqual(base)
    expect(base[0]).toBeLessThan(Math.min(...data.map(bar => bar.low)))
    expect(base[1]).toBeGreaterThan(Math.max(...data.map(bar => bar.high)))
    expect(chart.series[0].yScale.ticks(6).length).toBeGreaterThan(0)
    chart.destroy()
    container.remove()
    vi.unstubAllGlobals()
})

it('renders a subtle two-axis grid and an unfilled smooth price line', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    const container = document.createElement('div')
    container.getBoundingClientRect = () => ({ width: 1000, height: 520 })
    document.body.appendChild(container)
    const chart = new TChart(container)
    const data = [100, 104, 102, 108].map((close, i) => ({
        timestamp: new Date(1700000000000 + i * 1800000),
        open: close, high: close + 2, low: close - 2, close
    }))
    chart.renderSeries([{ id: 'one', symbol: 'TEST', assetClass: 'equities', data }], { chartMode: 'line' })
    expect(chart.chartMode).toBe('line')
    expect(chart.series[0].native).toHaveLength(4)
    expect(chart.series[0].hiddenLevel).toBe(0)
    expect(chart.series[0].aligned.map(item => item?.close)).toEqual([100, 104, 102, 108])
    expect(chart.series[0].price.line.datum()).toHaveLength(4)
    expect(chart.series[0].price.line.node()).not.toBe(chart.series[0].prediction.line.node())
    expect(container.querySelectorAll('.vertical-grid').length).toBeGreaterThan(0)
    expect(container.querySelector('.series-price-area').getAttribute('fill')).toBe('none')
    expect(chart.series[0].price.line.attr('d')).toContain('C')
    chart.applyPredictions({ one: { predictions: [{ median: 109, upper: 112, lower: 106 }] } })
    expect(chart.series[0].price.line.attr('d')).toContain('C')
    expect(chart.series[0].prediction.line.attr('d')).toBeTruthy()
    chart.applyPredictions({})
    expect(chart.series[0].price.line.attr('d')).toContain('C')
    expect(chart.series[0].prediction.line.attr('d')).toBeNull()
    chart.renderSeries([], { chartMode: 'line' })
    expect(container.querySelectorAll('.vertical-grid')).toHaveLength(0)
    chart.destroy()
    container.remove()
    vi.unstubAllGlobals()
})
