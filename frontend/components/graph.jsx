// Graph component - series-aware D3 chart wrapper
import { useEffect, useRef, useState } from 'react'
import { useAppState } from '../js/state'
import { TChart } from '../js/visualizer'
import { CHART_MARGIN } from '../js/visualizer/visualizer-layers'
import ChartLegend from './chart-legend'

function shallowEqualStats(a, b) {
    if (a === b) return true
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((row, i) => {
        const other = b[i]
        if (row === other) return true
        if (!row || !other || typeof row !== typeof other) return false
        const ra = Object.keys(row), rb = Object.keys(other)
        return ra.length === rb.length && ra.every(k => row[k] === other[k])
    })
}

export default function Graph() {
    const containerRef = useRef(null)
    const chartRef = useRef(null)
    const [legendStats, setLegendStats] = useState([])
    const {
        series,
        predictions,
        timespan,
        selectedRange,
        setSelectedRange,
        drawMovingAverage,
        drawExponentialMovingAverage,
        drawBollingerBands,
        drawVolatilityBands,
        chartMode,
        isLoading,
        loadingMessage,
        tooltipFields,
        registerChart
    } = useAppState()

    // Initialize chart on mount
    useEffect(() => {
        if (!containerRef.current || chartRef.current) return

        // Chart stats can be re-emitted with identical values (hover/resize);
        // keep the same array reference so React skips pointless re-renders
        const chart = new TChart(containerRef.current, {
            onStats: stats => setLegendStats(prev => shallowEqualStats(prev, stats) ? prev : stats),
            onRangeSelect: setSelectedRange
        })
        chartRef.current = chart
        registerChart(chart)

        return () => {
            chart.destroy()
            chartRef.current = null
            registerChart(null)
            setLegendStats([])
        }
    }, [registerChart, setSelectedRange])

    // TChart retains forecasts across data/options redraws.
    useEffect(() => {
        if (!chartRef.current) return

        chartRef.current.renderSeries(
            series.map(s => ({ id: s.id, symbol: s.symbol, assetClass: s.assetClass, data: s.data, bandHistory: s.bandHistory, hiddenLevel: s.hiddenLevel ?? 0 })),
            {
                timespan,
                chartMode,
                showMovingAverage: drawMovingAverage,
                showExponentialMovingAverage: drawExponentialMovingAverage,
                showBollingerBands: drawBollingerBands,
                showVolatilityBands: drawVolatilityBands,
                range: selectedRange,
                tooltipFields
            }
        )
    }, [series, timespan, selectedRange, chartMode, drawMovingAverage, drawExponentialMovingAverage, drawBollingerBands, drawVolatilityBands, tooltipFields])

    // Apply predictions after the data render pass
    useEffect(() => {
        if (!chartRef.current) return
        chartRef.current.applyPredictions(predictions)
    }, [predictions])

    const hasAnyData = series.some(s => (s.data?.length ?? 0) > 0)
    const hasSymbol = series.some(s => s.symbol)

    return (
        <>
            <div className={`chart-container${hasAnyData ? '' : ' is-empty'}`} style={{ '--chart-plot-left': `${CHART_MARGIN.left}px` }}>
                <div ref={containerRef} className="chart-svg-host" />
                <ChartLegend stats={legendStats} />

                {isLoading && !hasAnyData && (
                    <div className="chart-loading-overlay">
                        <span>{loadingMessage || 'Loading…'}</span>
                    </div>
                )}

                {!isLoading && !hasAnyData && hasSymbol && (
                    <div className="chart-loading-overlay">
                        <span>No data</span>
                    </div>
                )}
            </div>

        </>
    )
}
