// Descriptions and return statistics for the enabled chart overlays.
import { memo, useId } from 'react'

const ChartLegend = memo(function ChartLegend({ stats = [] }) {
    const id = useId()
    const overlays = [
        { kind: 'classic', labelKey: 'classicLabel', returnKey: 'classicReturn' },
        { kind: 'calibrated', labelKey: 'volatilityLabel', returnKey: 'volatilityReturn' },
    ].map(overlay => ({ ...overlay, rows: stats.filter(row => row[overlay.labelKey]) }))
        .filter(overlay => overlay.rows.length)
    if (!overlays.length) return null
    return (
        <div className="chart-legend" aria-label="Chart bands">
            <div className="chart-legend-overlays">
                {overlays.map(({ kind, labelKey, returnKey, rows }) => (
                    <div key={kind} className={`chart-legend-overlay is-${kind}`}>
                        <button type="button" className="chart-legend-label" aria-describedby={`${id}-${kind}`}>
                            {rows[0][labelKey]}
                        </button>
                        <span id={`${id}-${kind}`} role="tooltip" className="chart-legend-tooltip">
                            {rows.map(row => (
                                <span key={row.id}>{rows.length > 1 ? `${row.symbol || 'Asset'}: ` : ''}{row[returnKey] || 'Not enough completed exits'}</span>
                            ))}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    )
})

export default ChartLegend
