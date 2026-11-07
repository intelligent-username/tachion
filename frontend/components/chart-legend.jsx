// Descriptions of the enabled chart overlays.
import { memo } from 'react'

const ChartLegend = memo(function ChartLegend({ stats = [] }) {
    const overlays = new Map()
    for (const row of stats) {
        for (const [kind, label, status] of [
            ['classic', row.classicLabel, row.classicStatus],
            ['calibrated', row.volatilityLabel, row.volatilityStatus],
        ]) {
            if (label) overlays.set(`${kind}:${label}:${status || ''}`, { kind, label, status })
        }
    }
    if (!overlays.size) return null
    return (
        <div className="chart-legend" aria-label="Chart bands">
            <div className="chart-legend-overlays" aria-live="polite">
                {[...overlays.values()].map(({ kind, label, status }) => (
                    <div key={`${kind}:${label}:${status || ''}`} className={`chart-legend-overlay is-${kind}`}>
                        <span>{label}</span>
                        {status && <span className="chart-band-status">{status}</span>}
                    </div>
                ))}
            </div>
        </div>
    )
})

export default ChartLegend
