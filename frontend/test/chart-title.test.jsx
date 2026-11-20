import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import TrendlinesTitle from '../components/chart-title'
import { useAppState } from '../js/state'

vi.mock('../js/state', () => ({ useAppState: vi.fn() }))

it('tracks visible series, selected range, and independent comparison readouts', () => {
	const rows = (values) => values.map((close, index) => ({ date: `2025-01-0${index + 1}`, close }))
	const series = [
		{ id: 'a', symbol: 'AAA', assetClass: 'stock', data: rows([10, 20, 30]) },
		{ id: 'b', symbol: 'BBB', assetClass: 'stock', data: rows([100, 80, 60]) },
	]
	useAppState.mockReturnValue({ series, timespan: 'max', selectedRange: {
		start: Date.parse('2025-01-02'), end: Date.parse('2025-01-03')
	} })
	const { rerender } = render(<TrendlinesTitle />)
	for (const [symbol, text] of [['AAA', '$30.00 • +50.00%'], ['BBB', '$60.00 • -25.00%']]) {
		const trigger = screen.getByText(symbol)
		expect(trigger.tabIndex).toBe(0)
		expect(document.getElementById(trigger.getAttribute('aria-describedby')).textContent).toBe(text)
	}
	useAppState.mockReturnValue({ series: [{ ...series[0], hiddenLevel: 1 }, series[1]], timespan: 'max' })
	rerender(<TrendlinesTitle />)
	expect(screen.getByText('BBB')).toBeTruthy()
	expect(screen.getByText('$60.00 • -40.00%')).toBeTruthy()
})

it('preserves empty and forex readouts', () => {
	useAppState.mockReturnValue({ series: [], timespan: 'max' })
	const { rerender } = render(<TrendlinesTitle />)
	expect(screen.getByText('Trendlines')).toBeTruthy()
	expect(screen.getByText('— • —')).toBeTruthy()
	useAppState.mockReturnValue({ series: [{ symbol: 'EURUSD', assetClass: 'forex', data: [
		{ date: '2025-01-01', close: 1.2 }
	] }], timespan: 'max' })
	rerender(<TrendlinesTitle />)
	expect(screen.getByText('1 EUR equals 1.20 USD • +0.00%')).toBeTruthy()
})
