// Graph component - series-aware D3 chart wrapper
import { useEffect, useRef, useState } from 'react'
import { useAppState } from '../js/state'
import { TChart } from '../js/visualizer'
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
        drawMovingAverage,
        drawExponentialMovingAverage,
        chartMode,
        isLoading,
        loadingMessage,
        focusedSeriesId,
        tooltipFields,
        registerChart,
        removeSeries
    } = useAppState()

    // Initialize chart on mount
    useEffect(() => {
        if (!containerRef.current || chartRef.current) return

        // Chart stats can be re-emitted with identical values (hover/resize);
        // keep the same array reference so React skips pointless re-renders
        const chart = new TChart(containerRef.current, {
            onStats: stats => setLegendStats(prev => shallowEqualStats(prev, stats) ? prev : stats)
        })
        chartRef.current = chart
        registerChart(chart)

        return () => {
            chart.destroy()
            chartRef.current = null
            registerChart(null)
            setLegendStats([])
        }
    }, [registerChart])

    // Render series data before predictions so the data pass cannot clear new overlays
    useEffect(() => {
        if (!chartRef.current) return

        chartRef.current.renderSeries(
            series.map(s => ({ id: s.id, symbol: s.symbol, assetClass: s.assetClass, data: s.data, hiddenLevel: s.hiddenLevel ?? 0 })),
            {
                timespan,
                chartMode,
                showMovingAverage: drawMovingAverage,
                showExponentialMovingAverage: drawExponentialMovingAverage,
                tooltipFields
            }
        )
    }, [series, timespan, chartMode, drawMovingAverage, drawExponentialMovingAverage, tooltipFields])

    // Apply predictions after the data render pass
    useEffect(() => {
        if (!chartRef.current) return
        chartRef.current.applyPredictions(predictions)
    }, [predictions])

    const hasAnyData = series.some(s => (s.data?.length ?? 0) > 0)
    const hasSymbol = series.some(s => s.symbol)

    return (
        <div ref={containerRef} className="chart-container">
            <ChartLegend
                stats={legendStats}
                series={series}
                focusedSeriesId={focusedSeriesId}
                onRemove={removeSeries}
            />

            {isLoading && !hasAnyData && (
                <div className="chart-loading-overlay">
                    <span>{loadingMessage || 'Loading...'}</span>
                </div>
            )}

            {!isLoading && !hasAnyData && hasSymbol && (
                <div className="chart-loading-overlay">
                    <span>No data</span>
                </div>
            )}
            {/* D3 will render the chart here */}
        </div>
    )
}
