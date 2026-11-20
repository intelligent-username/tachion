// Trendlines title with visible-series price and range metrics
import { useId, useMemo } from 'react'
import { useAppState } from '../js/state'
import { filterCandlesByRange, prepareCandles } from '../js/visualizer/visualizer-data'

const CURRENCY_NAMES = {
	USD: 'USD', EUR: 'EUR', GBP: 'GBP', JPY: 'JPY', CAD: 'CAD',
	AUD: 'AUD', NZD: 'NZD', CHF: 'CHF', SGD: 'SGD', HKD: 'HKD',
	SEK: 'SEK', NOK: 'NOK', DKK: 'DKK', ZAR: 'ZAR', MXN: 'MXN',
	TRY: 'TRY', PLN: 'PLN', CNH: 'CNH', INR: 'INR', THB: 'THB',
}

function formatForexLabel(symbol, value) {
	const clean = (symbol || '').toUpperCase().replace(/[\/_-]/g, '')
	const base = clean.slice(0, 3)
	const quote = clean.slice(3, 6)
	const formatted = value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
	return `1 ${CURRENCY_NAMES[base] || base} equals ${formatted} ${CURRENCY_NAMES[quote] || quote}`
}

function getMetrics(slot, timespan, selectedRange) {
	const candles = filterCandlesByRange(prepareCandles(slot.data, timespan), selectedRange)
	const first = candles[0]?.close ?? null
	const last = candles[candles.length - 1]?.close ?? null
	const pct = first != null && first !== 0 && last != null ? ((last - first) / first) * 100 : null
	const price = last == null ? '—' : slot.assetClass === 'forex'
		? formatForexLabel(slot.symbol, last)
		: `$${last.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`
	return {
		text: `${price} • ${pct == null ? '—' : `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`}`,
		className: pct == null ? 'neutral' : pct >= 0 ? 'up' : 'down'
	}
}

function ComparisonSymbol({ slot, metrics }) {
	const id = useId()
	return (
		<span className="chart-title-comparison-item">
			<span className="chart-title-symbol chart-title-trigger" tabIndex={0} aria-describedby={id}>{slot.symbol}</span>
			<span id={id} role="tooltip" className={`chart-title-tooltip ${metrics.className}`}>{metrics.text}</span>
		</span>
	)
}

export default function TrendlinesTitle() {
	const { series, timespan, selectedRange } = useAppState()
	const visible = useMemo(() => (series ?? [])
		.filter(slot => slot.symbol && (slot.hiddenLevel ?? 0) === 0)
		.map(slot => ({ slot, metrics: getMetrics(slot, timespan, selectedRange) })),
	[series, timespan, selectedRange])

	if (visible.length > 1) {
		return (
			<div className="chart-title-wrap chart-title-comparison">
				<ComparisonSymbol {...visible[0]} />
				<span>vs.</span>
				<ComparisonSymbol {...visible[1]} />
				<span>Price Movements</span>
			</div>
		)
	}

	const item = visible[0]
	return (
		<div className="chart-title-wrap">
			{item ? <span className="chart-title-symbol">{item.slot.symbol}</span> : <h1>Trendlines</h1>}
			<span className={`chart-title-metrics ${item?.metrics.className ?? 'neutral'}`}>{item?.metrics.text ?? '— • —'}</span>
		</div>
	)
}
