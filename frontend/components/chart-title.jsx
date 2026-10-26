// Trendlines title with live price + percent-change metrics
import { useAppState } from '../js/state'

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

export default function TrendlinesTitle() {
	const { historicalData, currentSymbol, assetClass } = useAppState()

	const closes = (historicalData || [])
		.map(d => Number(d?.close ?? d?.value))
		.filter(Number.isFinite)

	const first = closes.length ? closes[0] : null
	const last = closes.length ? closes[closes.length - 1] : null
	const pct = first && last ? ((last - first) / first) * 100 : null

	let priceText = '—'
	if (last != null) {
		if (assetClass === 'forex' && currentSymbol) {
			priceText = formatForexLabel(currentSymbol, last)
		} else {
			priceText = `$${last.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`
		}
	}

	const pctText = pct != null
		? `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
		: '—'

	const pctClass = pct == null ? 'neutral' : pct >= 0 ? 'up' : 'down'

	return (
		<div className="chart-title-wrap">
			<h1>Trendlines</h1>
			<span className={`chart-title-metrics ${pctClass}`}>{priceText} • {pctText}</span>
		</div>
	)
}
