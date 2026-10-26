// Chart display toolbar: bars/line mode toggle + MA/EMA checkboxes
import { useAppState } from '../js/state'

function BarsIcon() {
	return (
		<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
			{/* Candlestick icon */}
			<rect x="2" y="1" width="1.2" height="14" rx="0.5" opacity="0.6"/>
			<rect x="0.5" y="4" width="4.2" height="7" rx="1"/>
			<rect x="12.8" y="1" width="1.2" height="14" rx="0.5" opacity="0.6"/>
			<rect x="11.3" y="3" width="4.2" height="9" rx="1"/>
			<rect x="7.4" y="2" width="1.2" height="12" rx="0.5" opacity="0.6"/>
			<rect x="5.9" y="5" width="4.2" height="5" rx="1"/>
		</svg>
	)
}

function LineIcon() {
	return (
		<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			{/* Line chart trend icon */}
			<path d="M1.5 12.5 L5.5 7.5 L9.5 10 L14.5 3.5"/>
		</svg>
	)
}

const MODE_BUTTONS = [
	{ value: 'bars', title: 'Candlestick / Bar Chart', Icon: BarsIcon },
	{ value: 'line', title: 'Stock Price Line Chart', Icon: LineIcon },
]

const CHECKBOXES = [
	{ stateKey: 'drawMovingAverage', setterKey: 'setDrawMovingAverage', label: 'MA', css: 'ma-checkbox', ariaLabel: 'Simple Moving Average' },
	{ stateKey: 'drawExponentialMovingAverage', setterKey: 'setDrawExponentialMovingAverage', label: 'EMA', css: 'ema-checkbox', ariaLabel: 'Exponential Moving Average' },
]

export default function ChartToolbar() {
	const state = useAppState()

	return (
		<div className="chart-bottom-controls" role="toolbar" aria-label="Chart display options">
			<div className={`chart-mode-toggle mode-${state.chartMode}`} role="group" aria-label="Chart visualization mode">
				<span className="chart-mode-indicator" aria-hidden="true" />
				{MODE_BUTTONS.map(({ value, title, Icon }) => (
					<button
						key={value}
						type="button"
						className={`chart-mode-btn${state.chartMode === value ? ' active' : ''}`}
						onClick={() => state.setChartMode(value)}
						title={title}
						aria-label={title}
					>
						<Icon />
					</button>
				))}
			</div>
			<div className="chart-checkbox-group">
				{CHECKBOXES.map(({ stateKey, setterKey, label, css, ariaLabel }) => (
					<label key={stateKey} className={`chart-checkbox ${css}`} aria-label={ariaLabel}>
						<input
							type="checkbox"
							checked={!!state[stateKey]}
							onChange={(e) => state[setterKey](e.target.checked)}
						/>
						<span>{label}</span>
					</label>
				))}
			</div>
		</div>
	)
}
