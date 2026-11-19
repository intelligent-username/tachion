import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CorrelationSection from '../components/correlation-section'

let appState
vi.mock('../js/state', () => ({ useAppState: () => appState }))

const START = Date.parse('2026-01-05T14:30:00Z')
const BAR = 30 * 60 * 1000

function stock(symbol, returns, factor = 1) {
    let close = 100
    return {
        id: symbol, symbol, assetClass: 'equities', status: 'ready',
        data: [{ timestamp: START, close }, ...returns.map((value, i) => {
            close *= 1 + value * factor
            return { timestamp: START + (i + 1) * BAR, close }
        })]
    }
}

function readyState() {
    const returns = Array.from({ length: 96 }, (_, i) => [0.01, -0.02, 0.03, -0.04][i % 4])
    return { series: [stock('AAA', returns), stock('BBB', returns, 0.5)], timespan: 'max', selectedRange: null }
}

beforeEach(() => { appState = readyState() })
afterEach(cleanup)

function sentences() {
    return screen.getAllByRole('button')
}

describe('Correlation sidebar results', () => {
    it('shows six concise points and no settings controls or requests', () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch')
        render(<CorrelationSection />)
        expect(screen.getByRole('heading', { name: 'Correlation' }).tagName).toBe('H2')
        expect(screen.getAllByRole('listitem')).toHaveLength(6)
        expect(screen.getByRole('button', { name: 'AAA and BBB move together 100% of the time.' })).toBeTruthy()
        expect(screen.getByRole('button', { name: 'AAA and BBB’s co-movement score is 1.00.' })).toBeTruthy()
        expect(screen.getByRole('button', { name: /After AAA rises, BBB follows/ })).toBeTruthy()
        expect(screen.getByRole('button', { name: /After AAA falls, BBB follows/ })).toBeTruthy()
        expect(screen.getByRole('button', { name: /Across rises and falls, BBB follows AAA/ })).toBeTruthy()
        expect(screen.getByRole('button', { name: /BBB’s typical later move/ })).toBeTruthy()
        expect(screen.queryByRole('spinbutton')).toBeNull()
        expect(screen.queryByRole('tooltip')).toBeNull()
        expect(screen.getByText('Historical observations, not forecasts; windows may overlap.')).toBeTruthy()
        expect(fetchSpy).not.toHaveBeenCalled()
        fetchSpy.mockRestore()
    })

    it('explains the proportional rule, defaults and raw sample counts on hover', () => {
        render(<CorrelationSection />)
        fireEvent.pointerEnter(sentences()[0], { pointerType: 'mouse' })
        const tooltip = screen.getByRole('tooltip')
        expect(tooltip.textContent).toContain('30-minute')
        expect(tooltip.textContent).toContain('at least 20% as much')
        expect(tooltip.textContent).toContain('below 0.1%')
        expect(tooltip.textContent).toContain('96/96 observations')
        expect(sentences()[0].getAttribute('aria-describedby')).toBe(tooltip.id)
    })

    it('shows insufficient subgroups without hiding available metrics', () => {
        appState.series = [stock('AAA', Array(30).fill(0.01)), stock('BBB', Array(30).fill(0.01))]
        render(<CorrelationSection />)
        expect(sentences()).toHaveLength(6)
        expect(screen.getByRole('button', { name: 'Not enough AAA falls to measure BBB’s response.' })).toBeTruthy()
        fireEvent.pointerEnter(sentences()[2])
        expect(screen.getByRole('tooltip').textContent).toContain('0/20 required falls')
        expect(screen.getByRole('button', { name: 'AAA and BBB’s co-movement score is unavailable.' })).toBeTruthy()
        fireEvent.pointerEnter(sentences()[5])
        expect(screen.getByRole('tooltip').textContent).toContain('constant')
    })

    it.each([
        ['loading', 'Waiting for both stocks'],
        ['error', 'Search again to retry'],
        ['unsupported', 'supports two equities'],
        ['short', 'Not enough meaningful moves'],
        ['disjoint', 'Not enough meaningful moves']
    ])('handles %s without fabricated results', (kind, message) => {
        if (kind === 'loading' || kind === 'error') appState.series[1].status = kind
        if (kind === 'unsupported') appState.series[1].assetClass = 'forex'
        if (kind === 'short') appState.selectedRange = { start: START, end: START + BAR * 3 }
        if (kind === 'disjoint') appState.series[1].data = appState.series[1].data.map(row => ({
            ...row, timestamp: row.timestamp + BAR * 200
        }))
        render(<CorrelationSection />)
        expect(screen.getByRole('status').textContent).toContain(message)
        expect(screen.queryByRole('list')).toBeNull()
        expect(screen.getByRole('region', { name: 'Correlation' }).getAttribute('aria-busy'))
            .toBe(String(kind === 'loading'))
    })

    it.each(['empty', 'one', 'empty-slot'])('hides the entire section with %s selections', kind => {
        if (kind === 'empty') appState.series = []
        if (kind === 'one') appState.series = appState.series.slice(0, 1)
        if (kind === 'empty-slot') appState.series[1] = { id: 'empty', symbol: null }
        render(<CorrelationSection />)
        expect(screen.queryByRole('region', { name: 'Correlation' })).toBeNull()
        expect(screen.queryByText(/Historical observations/)).toBeNull()
    })

    it('appears when the second stock loads and disappears when one is removed', () => {
        const pair = appState.series
        appState.series = pair.slice(0, 1)
        const view = render(<CorrelationSection />)
        expect(screen.queryByRole('region', { name: 'Correlation' })).toBeNull()
        appState.series = pair
        view.rerender(<CorrelationSection />)
        expect(screen.getByRole('region', { name: 'Correlation' })).toBeTruthy()
        appState.series = pair.slice(0, 1)
        view.rerender(<CorrelationSection />)
        expect(screen.queryByRole('region', { name: 'Correlation' })).toBeNull()
    })

    it('recomputes directional sentences when the stock chips reverse', () => {
        const view = render(<CorrelationSection />)
        fireEvent.pointerEnter(sentences()[0])
        appState.series = [...appState.series].reverse()
        view.rerender(<CorrelationSection />)
        expect(screen.queryByRole('tooltip')).toBeNull()
        expect(screen.getByRole('button', { name: /After BBB rises, AAA follows/ })).toBeTruthy()
        expect(screen.getByRole('button', { name: /Across rises and falls, AAA follows BBB/ })).toBeTruthy()
    })

    it('recomputes on replacement data and removes stale results during loading', () => {
        const view = render(<CorrelationSection />)
        fireEvent.pointerEnter(sentences()[0])
        appState.series[1] = stock('BBB', Array(96).fill(0))
        view.rerender(<CorrelationSection />)
        expect(screen.queryByRole('tooltip')).toBeNull()
        expect(screen.getByRole('button', { name: 'AAA and BBB move together 0% of the time.' })).toBeTruthy()
        appState.series[1] = { ...appState.series[1], status: 'loading' }
        view.rerender(<CorrelationSection />)
        expect(screen.queryByRole('list')).toBeNull()
    })

    it('updates and closes explanations on range and timespan changes', () => {
        const view = render(<CorrelationSection />)
        fireEvent.pointerEnter(sentences()[0])
        appState.selectedRange = { start: START + 20 * BAR, end: START + 80 * BAR }
        view.rerender(<CorrelationSection />)
        expect(screen.queryByRole('tooltip')).toBeNull()
        fireEvent.pointerEnter(sentences()[0])
        expect(screen.getByRole('tooltip').textContent).toContain('60/60 observations')
        appState.timespan = '1h'
        view.rerender(<CorrelationSection />)
        expect(screen.queryByRole('tooltip')).toBeNull()
        expect(screen.queryByRole('list')).toBeNull()
    })

    it('does not change results when a selected stock is hidden or focused', () => {
        const view = render(<CorrelationSection />)
        const before = sentences().map(button => button.textContent)
        appState.series = appState.series.map(item => ({ ...item, hiddenLevel: 2 }))
        appState.focusedSeriesId = 'BBB'
        view.rerender(<CorrelationSection />)
        expect(sentences().map(button => button.textContent)).toEqual(before)
    })

    it('does not display negative zero for a tiny negative relative response', () => {
        appState.series[1] = stock('BBB', Array(96).fill(-1e-9))
        render(<CorrelationSection />)
        expect(screen.getByRole('button', { name: 'BBB’s typical later move is 0% of AAA’s move.' })).toBeTruthy()
    })
})

describe('Correlation explanations', () => {
    it('allows a new keyboard focus after dismissing a hover-only explanation', () => {
        render(<CorrelationSection />)
        const first = sentences()[0]
        fireEvent.pointerEnter(first)
        fireEvent.keyDown(document, { key: 'Escape' })
        expect(screen.queryByRole('tooltip')).toBeNull()
        fireEvent.focus(first)
        expect(screen.getByRole('tooltip')).toBeTruthy()
    })

    it('supports keyboard focus, Escape suppression, and reopening after blur', () => {
        render(<CorrelationSection />)
        const first = sentences()[0]
        fireEvent.focus(first)
        expect(screen.getByRole('tooltip')).toBeTruthy()
        fireEvent.keyDown(first, { key: 'Escape' })
        expect(screen.queryByRole('tooltip')).toBeNull()
        fireEvent.pointerEnter(first)
        expect(screen.queryByRole('tooltip')).toBeNull()
        fireEvent.blur(first, { relatedTarget: document.body })
        fireEvent.focus(first)
        expect(screen.getByRole('tooltip')).toBeTruthy()
    })

    it('keeps the explanation open when moving from the sentence onto its explanation', () => {
        render(<CorrelationSection />)
        const first = sentences()[0]
        fireEvent.pointerEnter(first)
        const tooltip = screen.getByRole('tooltip')
        fireEvent.pointerOut(first, { relatedTarget: tooltip })
        fireEvent.pointerOver(tooltip, { relatedTarget: first })
        expect(screen.getByRole('tooltip')).toBe(tooltip)
        fireEvent.pointerLeave(first.closest('li'))
        expect(screen.queryByRole('tooltip')).toBeNull()
    })

    it('shows only one explanation at a time', () => {
        render(<CorrelationSection />)
        const [first, second] = sentences()
        fireEvent.pointerEnter(first)
        fireEvent.pointerEnter(second)
        expect(screen.getAllByRole('tooltip')).toHaveLength(1)
        expect(second.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id)
        expect(first.hasAttribute('aria-describedby')).toBe(false)
    })

    it('toggles and pins explanations on tap, then dismisses outside', () => {
        render(<CorrelationSection />)
        const first = sentences()[0]
        fireEvent.pointerEnter(first, { pointerType: 'touch' })
        fireEvent.click(first)
        expect(screen.getByRole('tooltip')).toBeTruthy()
        fireEvent.pointerLeave(first.closest('li'))
        expect(screen.getByRole('tooltip')).toBeTruthy()
        fireEvent.click(first)
        expect(screen.queryByRole('tooltip')).toBeNull()
        fireEvent.click(first)
        expect(screen.getByRole('tooltip')).toBeTruthy()
        fireEvent.pointerDown(document.body)
        expect(screen.queryByRole('tooltip')).toBeNull()
    })

    it('dismisses when keyboard focus leaves the point', () => {
        render(<CorrelationSection />)
        const [first, second] = sentences()
        fireEvent.focus(first)
        fireEvent.blur(first, { relatedTarget: second })
        expect(screen.queryByRole('tooltip')).toBeNull()
    })

    it('cleans up document listeners on unmount', () => {
        const add = vi.spyOn(document, 'addEventListener')
        const remove = vi.spyOn(document, 'removeEventListener')
        const view = render(<CorrelationSection />)
        fireEvent.focus(sentences()[0])
        const pointerHandler = add.mock.calls.find(([type]) => type === 'pointerdown')[1]
        const keyHandler = add.mock.calls.find(([type]) => type === 'keydown')[1]
        view.unmount()
        expect(remove).toHaveBeenCalledWith('pointerdown', pointerHandler)
        expect(remove).toHaveBeenCalledWith('keydown', keyHandler)
        add.mockRestore()
        remove.mockRestore()
    })
})
