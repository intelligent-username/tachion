import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Sidebar from '../components/sidebar'

let appState
vi.mock('../js/state', () => ({ MAX_SERIES: 2, useAppState: () => appState }))
vi.mock('../components/tooltip-settings', () => ({ default: () => null }))
const directory = {
    currencies: ['EUR', 'USD'], pairs: [{ symbol: 'EUR_USD', base: 'EUR', quote: 'USD' }],
    stale: false, refreshAfterSeconds: 3600,
}

beforeEach(() => {
    appState = {
        series: [{ id: 's1', symbol: 'AAPL', assetClass: 'equities', status: 'ready' }],
        focusedSeriesId: 's1', timespan: '7d', isLoading: false,
        setAsset: vi.fn().mockResolvedValue({ ok: true }),
        setSeriesSymbol: vi.fn().mockResolvedValue({ ok: true }),
        addSeriesSlot: vi.fn(), focusSeries: vi.fn(), removeSeries: vi.fn(),
        reorderSeries: vi.fn(), cycleSeriesVisibility: vi.fn(), runPrediction: vi.fn(),
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => directory }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function switchAsset(asset) {
    fireEvent.change(document.getElementById('asset-select'), { target: { value: asset } })
}
function enterPair(from = 'eur', to = 'usD') {
    fireEvent.change(screen.getByLabelText('From'), { target: { value: from } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: to } })
}

describe('Sidebar FOREX submission', () => {
    it('restores an initially focused FOREX pair without searching', async () => {
        appState.series = [{ id: 's1', symbol: 'GBP_JPY', assetClass: 'forex' }]
        render(<Sidebar />)
        expect(screen.getByLabelText('From').value).toBe('GBP')
        expect(screen.getByLabelText('To').value).toBe('JPY')
        expect(appState.setSeriesSymbol).not.toHaveBeenCalled()
        await waitFor(() => expect(fetch).toHaveBeenCalled())
    })

    it('switches to blank fields and remembers the draft across asset switches', async () => {
        render(<Sidebar />)
        switchAsset('forex')
        expect(screen.getByPlaceholderText('EUR').value).toBe('')
        expect(screen.getByPlaceholderText('USD').value).toBe('')
        enterPair()
        await waitFor(() => expect(screen.getByRole('status').textContent).toBe(''))
        switchAsset('crypto')
        expect(screen.queryByLabelText('From')).toBeNull()
        switchAsset('forex')
        expect(screen.getByLabelText('From').value).toBe('eur')
        expect(screen.getByLabelText('To').value).toBe('usD')
        expect(appState.setSeriesSymbol).not.toHaveBeenCalled()
        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    })

    it.each(['Search', 'Enter'])('%s submits one canonical pair', async action => {
        render(<Sidebar />)
        switchAsset('forex')
        enterPair(' e/u_r ', '_usD')
        if (action === 'Search') fireEvent.click(screen.getByRole('button', { name: 'Search', exact: true }))
        else fireEvent.keyDown(screen.getByLabelText('To'), { key: 'Enter' })
        await waitFor(() => expect(appState.setSeriesSymbol).toHaveBeenCalledExactlyOnceWith('s1', 'EUR_USD', 'forex', '7d'))
        expect(screen.getByLabelText('From').value).toBe('EUR')
        expect(screen.getByLabelText('To').value).toBe('USD')
    })

    it('normalizes on blur, not while typing, and exposes field errors', async () => {
        render(<Sidebar />)
        switchAsset('forex')
        enterPair(' e/u_r ', 'EUR_USD')
        expect(screen.getByLabelText('From').value).toBe(' e/u_r ')
        fireEvent.blur(screen.getByLabelText('From'))
        expect(screen.getByLabelText('From').value).toBe('EUR')
        fireEvent.blur(screen.getByLabelText('To'))
        expect(screen.getByLabelText('To').getAttribute('aria-invalid')).toBe('true')
        fireEvent.click(screen.getByRole('button', { name: 'Search', exact: true }))
        expect(appState.setSeriesSymbol).not.toHaveBeenCalled()
        await waitFor(() => expect(screen.getByText('Enter one three-letter currency code, e.g. EUR.')).toBeTruthy())
    })

    it.each([['', ''], ['EUR_USD', 'USD'], ['usd', 'USD']])('blocks invalid Search, Swap and Predict: %s/%s', async (from, to) => {
        render(<Sidebar />)
        switchAsset('forex')
        enterPair(from, to)
        fireEvent.click(screen.getByRole('button', { name: 'Search', exact: true }))
        fireEvent.click(screen.getByRole('button', { name: 'Swap currencies and search' }))
        fireEvent.click(screen.getByRole('button', { name: 'Predict' }))
        expect(appState.setSeriesSymbol).not.toHaveBeenCalled()
        expect(appState.setAsset).not.toHaveBeenCalled()
        expect(appState.runPrediction).not.toHaveBeenCalled()
        expect(screen.getByLabelText('From').value).toBe(from.replace(/_/g, '').toUpperCase())
        await waitFor(() => expect(screen.getAllByText(/Enter a currency|Enter one three|Choose two different/).length).toBeGreaterThan(0))
    })

    it('swaps and searches the new pair once', async () => {
        render(<Sidebar />)
        switchAsset('forex')
        enterPair()
        fireEvent.click(screen.getByRole('button', { name: 'Swap currencies and search' }))
        await waitFor(() => expect(appState.setSeriesSymbol).toHaveBeenCalledExactlyOnceWith('s1', 'USD_EUR', 'forex', '7d'))
        expect(screen.getByLabelText('From').value).toBe('USD')
        expect(screen.getByLabelText('To').value).toBe('EUR')
    })

    it('fills a focused FOREX chart but does not overwrite typing on series updates', async () => {
        const view = render(<Sidebar />)
        appState = { ...appState, focusedSeriesId: 's2', series: [...appState.series, { id: 's2', symbol: 'GBP_JPY', assetClass: 'forex' }] }
        view.rerender(<Sidebar />)
        expect(screen.getByLabelText('From').value).toBe('GBP')
        enterPair('EUR', 'USD')
        appState = { ...appState, series: appState.series.map(series => ({ ...series, status: 'ready' })) }
        view.rerender(<Sidebar />)
        expect(screen.getByLabelText('From').value).toBe('EUR')
        appState = { ...appState, focusedSeriesId: 's3', series: [...appState.series, { id: 's3', symbol: '', assetClass: null }] }
        view.rerender(<Sidebar />)
        expect(screen.getByLabelText('From').value).toBe('EUR')
        await waitFor(() => expect(fetch).toHaveBeenCalled())
    })

    it('only normalizes the existing Predict options and preserves loading guards', async () => {
        const view = render(<Sidebar />)
        switchAsset('forex')
        enterPair()
        fireEvent.click(screen.getByRole('button', { name: 'Predict' }))
        expect(appState.runPrediction).toHaveBeenCalledExactlyOnceWith(7, {
            symbol: 'EUR_USD', assetClass: 'forex', timespan: '7d', ensureSearched: true,
        })
        appState = { ...appState, isLoading: true }
        view.rerender(<Sidebar />)
        expect(screen.getByRole('button', { name: 'Search', exact: true }).disabled).toBe(true)
        fireEvent.click(screen.getByRole('button', { name: 'Swap currencies and search' }))
        expect(appState.setSeriesSymbol).not.toHaveBeenCalled()
        await waitFor(() => expect(fetch).toHaveBeenCalled())
    })

    it('keeps manual search usable when suggestions fail and preserves duplicate/stale results', async () => {
        fetch.mockRejectedValue(new Error('offline'))
        appState.setSeriesSymbol.mockResolvedValueOnce({ ok: false, error: 'Already on chart' }).mockResolvedValueOnce({ stale: true })
        render(<Sidebar />)
        switchAsset('forex')
        enterPair('ABC', 'XYZ')
        await waitFor(() => expect(screen.getByText(/Currency suggestions are unavailable/)).toBeTruthy())
        fireEvent.click(screen.getByRole('button', { name: 'Search', exact: true }))
        await waitFor(() => expect(screen.getByText('Already on chart')).toBeTruthy())
        fireEvent.click(screen.getByRole('button', { name: 'Search', exact: true }))
        await waitFor(() => expect(screen.queryByText('Already on chart')).toBeNull())
    })

    it('preserves the single non-FOREX search input', async () => {
        render(<Sidebar />)
        const input = document.getElementById('symbol-input')
        fireEvent.change(input, { target: { value: '$msft' } })
        fireEvent.keyDown(input, { key: 'Enter' })
        await waitFor(() => expect(appState.setSeriesSymbol).toHaveBeenCalledWith('s1', 'MSFT', 'equities', '7d'))
        expect(screen.queryByLabelText('From')).toBeNull()
    })
})
