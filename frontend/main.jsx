// Main entry point for React application
import React from 'react'
import ReactDOM from 'react-dom/client'
import { StateProvider } from './js/state'
import { useAppState } from './js/state'
import Header from './components/header'
import Sidebar from './components/sidebar'
import Graph from './components/graph'
import Footer from './components/footer'
import TimespanSelector from './components/timespan-selector'
import './styles.css'

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

function TrendlinesTitle() {
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

function ChartToolbar() {
	const {
		chartMode,
		setChartMode,
		drawMovingAverage,
		setDrawMovingAverage,
		drawExponentialMovingAverage,
		setDrawExponentialMovingAverage,
	} = useAppState()

	return (
		<div className="chart-bottom-controls" role="toolbar" aria-label="Chart display options">
			<div className={`chart-mode-toggle mode-${chartMode}`} role="group" aria-label="Chart visualization mode">
				<span className="chart-mode-indicator" aria-hidden="true" />
				<button
					type="button"
					className={`chart-mode-btn${chartMode === 'bars' ? ' active' : ''}`}
					onClick={() => setChartMode('bars')}
					title="Candlestick / Bar Chart"
					aria-label="Candlestick / Bar Chart"
				>
					<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
						{/* Candlestick icon */}
						<rect x="2" y="1" width="1.2" height="14" rx="0.5" opacity="0.6"/>
						<rect x="0.5" y="4" width="4.2" height="7" rx="1"/>
						<rect x="12.8" y="1" width="1.2" height="14" rx="0.5" opacity="0.6"/>
						<rect x="11.3" y="3" width="4.2" height="9" rx="1"/>
						<rect x="7.4" y="2" width="1.2" height="12" rx="0.5" opacity="0.6"/>
						<rect x="5.9" y="5" width="4.2" height="5" rx="1"/>
					</svg>
				</button>
				<button
					type="button"
					className={`chart-mode-btn${chartMode === 'line' ? ' active' : ''}`}
					onClick={() => setChartMode('line')}
					title="Stock Price Line Chart"
					aria-label="Stock Price Line Chart"
				>
					<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
						{/* Line chart trend icon */}
						<path d="M1.5 12.5 L5.5 7.5 L9.5 10 L14.5 3.5"/>
					</svg>
				</button>
			</div>
			<div className="chart-checkbox-group">
				<label className="chart-checkbox ma-checkbox" aria-label="Simple Moving Average">
					<input
						type="checkbox"
						checked={!!drawMovingAverage}
						onChange={(e) => setDrawMovingAverage(e.target.checked)}
					/>
					<span>MA</span>
				</label>
				<label className="chart-checkbox ema-checkbox" aria-label="Exponential Moving Average">
					<input
						type="checkbox"
						checked={!!drawExponentialMovingAverage}
						onChange={(e) => setDrawExponentialMovingAverage(e.target.checked)}
					/>
					<span>EMA</span>
				</label>
			</div>
		</div>
	)
}

function App() {
	return (
		<StateProvider>
			<Header />
			<main className="main-content">
				<section className="chart-panel">
					<div className="chart-header">
						<TrendlinesTitle />
						<TimespanSelector />
					</div>
					<Graph />
					<ChartToolbar />
				</section>
				<aside className="control-panel">
					<Sidebar />
				</aside>
			</main>
			<Footer />
		</StateProvider>
	)
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />)
