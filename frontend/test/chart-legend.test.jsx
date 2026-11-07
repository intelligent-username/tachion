import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import ChartLegend from '../components/chart-legend'

it('associates each band with its own return rates for all instruments', () => {
    render(<ChartLegend stats={[
        { id: 'a', symbol: 'AAA', classicLabel: 'Bollinger Bands', classicReturn: '50% within 5 bars', volatilityLabel: 'Calibrated Volume Bands', volatilityReturn: '75% within 5 bars' },
        { id: 'b', symbol: 'BBB', classicLabel: 'Bollinger Bands', classicReturn: '80% within 5 bars', volatilityLabel: 'Calibrated Volume Bands', volatilityReturn: '90% within 5 bars' },
    ]} />)
    const classic = screen.getByRole('button', { name: 'Bollinger Bands' })
    const volatility = screen.getByRole('button', { name: 'Calibrated Volume Bands' })
    const classicText = document.getElementById(classic.getAttribute('aria-describedby')).textContent
    const volatilityText = document.getElementById(volatility.getAttribute('aria-describedby')).textContent
    expect(classicText).toContain('AAA: 50% within 5 bars')
    expect(classicText).toContain('BBB: 80% within 5 bars')
    expect(volatilityText).toContain('AAA: 75% within 5 bars')
    expect(volatilityText).toContain('BBB: 90% within 5 bars')
})
