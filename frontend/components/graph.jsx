// Graph component - D3 chart wrapper
import { useEffect, useRef } from 'react'
import { useAppState } from '../js/state'
import { TChart } from '../js/visualizer'

export default function Graph() {
    const containerRef = useRef(null)
    const chartRef = useRef(null)
    const { historicalData, predictionData, timespan, drawMovingAverage, drawExponentialMovingAverage, chartMode, isLoading, loadingMessage, currentSymbol, error, registerChart } = useAppState()

    // Initialize chart on mount
    useEffect(() => {
        if (containerRef.current && !chartRef.current) {
            chartRef.current = new TChart(containerRef.current)
            registerChart(chartRef.current)
        }
    }, [registerChart])

    // Update history when data changes or chart mode changes
    useEffect(() => {
        if (chartRef.current) {
            chartRef.current.renderHistory(historicalData, timespan, drawMovingAverage, chartMode, drawExponentialMovingAverage)
        }
    }, [historicalData, timespan, drawMovingAverage, drawExponentialMovingAverage, chartMode])

    // Animate prediction when it arrives
    useEffect(() => {
        if (chartRef.current && predictionData) {
            chartRef.current.animatePrediction(predictionData)
        }
    }, [predictionData])

    return (
        <div ref={containerRef} className="chart-container">
            {isLoading && (
                <div className="chart-loading-overlay">
                    <span>{loadingMessage || 'Loading...'}</span>
                </div>
            )}

            {!isLoading && currentSymbol && (historicalData?.length ?? 0) === 0 && (
                <div className="chart-loading-overlay">
                    <span>{error ? 'No data' : 'No data'}</span>
                </div>
            )}
            {/* D3 will render the chart here */}
        </div>
    )
}
