// Graph component - series-aware D3 chart wrapper
import { useEffect, useRef, useState } from 'react'
import { useAppState } from '../js/state'
import { TChart } from '../js/visualizer'
import ChartLegend from './chart-legend'

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
        registerChart,
        removeSeries
    } = useAppState()

    // Initialize chart on mount
    useEffect(() => {
        if (!containerRef.current || chartRef.current) return

        const chart = new TChart(containerRef.current, { onStats: setLegendStats })
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
            series.map(s => ({ id: s.id, symbol: s.symbol, assetClass: s.assetClass, data: s.data })),
            {
                timespan,
                chartMode,
                showMovingAverage: drawMovingAverage,
                showExponentialMovingAverage: drawExponentialMovingAverage
            }
        )
    }, [series, timespan, chartMode, drawMovingAverage, drawExponentialMovingAverage])

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
