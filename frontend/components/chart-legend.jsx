// In-chart legend overlay for multi-series mode
const EMPTY_VALUE = '—'
const MIN_PRICE_DECIMALS = 2
const MAX_PRICE_DECIMALS = 6

function toFiniteNumber(value) {
	if (value == null || value === '') return null
	const numeric = Number(value)
	return Number.isFinite(numeric) ? numeric : null
}

function formatPrice(value) {
	const numeric = toFiniteNumber(value)
	if (numeric == null) return EMPTY_VALUE
	return numeric.toLocaleString(undefined, {
		minimumFractionDigits: MIN_PRICE_DECIMALS,
		maximumFractionDigits: MAX_PRICE_DECIMALS,
	})
}

function formatChange(value) {
	const numeric = toFiniteNumber(value)
	if (numeric == null) return EMPTY_VALUE
	return `${numeric >= 0 ? '+' : ''}${numeric.toFixed(2)}%`
}

function changeClass(value) {
	const numeric = toFiniteNumber(value)
	if (numeric == null) return ''
	return numeric >= 0 ? 'is-up' : 'is-down'
}

function mergeSeriesState(stats, series) {
	const byId = new Map((series || []).map(item => [item.id, item]))
	return stats.map(stat => {
		const live = byId.get(stat.id)
		return { ...stat, status: live?.status, error: live?.error }
	})
}

function errorMessage(error) {
	if (!error) return ''
	return typeof error === 'string' ? error : error.message || String(error)
}

function LegendStatus({ status, error }) {
	const message = errorMessage(error)
	if (status !== 'loading' && !message) return null
	return (
		<>
			{status === 'loading' && <span className="chart-legend-status" title="Loading">…</span>}
			{message && <span className="chart-legend-status is-error" title={message}>!</span>}
		</>
	)
}

function LegendRow({ row, isFocused, onRemove }) {
	const symbol = row.symbol || EMPTY_VALUE
	const removeLabel = `Remove ${row.symbol || 'series'}`
	const toneClass = changeClass(row.pctChange)

	return (
		<div className={`chart-legend-row${isFocused ? ' is-focused' : ''}`} role="listitem">
			<span className="chart-legend-swatch" style={{ background: row.color }} aria-hidden="true" />
			<span className="chart-legend-symbol" title={row.symbol || undefined}>{symbol}</span>
			<span className="chart-legend-value">{formatPrice(row.lastClose)}</span>
			<span className={`chart-legend-change${toneClass ? ` ${toneClass}` : ''}`}>{formatChange(row.pctChange)}</span>
			<LegendStatus status={row.status} error={row.error} />
			<button
				type="button"
				className="chart-legend-remove"
				onClick={() => onRemove?.(row.id)}
				aria-label={removeLabel}
				title={removeLabel}
			>
				×
			</button>
		</div>
	)
}

export default function ChartLegend({ stats, series, focusedSeriesId = null, onRemove }) {
	if (!Array.isArray(stats) || stats.length < 2) return null

	const rows = mergeSeriesState(stats, series)

	return (
		<div className="chart-legend" role="list" aria-label="Chart series">
			{rows.map(row => (
				<LegendRow
					key={row.id}
					row={row}
					isFocused={row.id === focusedSeriesId}
					onRemove={onRemove}
				/>
			))}
		</div>
	)
}
