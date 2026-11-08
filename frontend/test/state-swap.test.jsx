import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StateProvider, useAppState } from '../js/state'
import { fetchHistory, fetchPrediction, sendSearch } from '../js/api'

vi.mock('../js/api', () => ({
    fetchHistory: vi.fn(),
    fetchPrediction: vi.fn(),
    sendSearch: vi.fn(),
}))

const rows = [
    { timestamp: '2026-11-06T10:00:00', open: 2, high: 2.4, low: 1.8, close: 2.2, volume: 10 },
    { timestamp: '2026-11-06T10:30:00', open: 2.2, high: 2.5, low: 2, close: 2.4, volume: 12 },
]

let app

function Probe() {
    app = useAppState()
    return null
}

async function mount() {
    render(<StateProvider><Probe /></StateProvider>)
}

afterEach(() => {
    cleanup()
    vi.clearAllMocks()
})

describe('FOREX direction swap', () => {
    it('serves the reciprocal locally and restores the original cache entry instantly', async () => {
        fetchHistory.mockResolvedValue(rows)
        sendSearch.mockResolvedValue({ status: 'ok' })
        fetchPrediction.mockResolvedValue({ predictions: [] })

        await mount()
        await act(async () => { await app.setAsset('EUR_USD', 'forex', 'max') })
        await waitFor(() => expect(app.series[0]?.data).toHaveLength(2))

        const id = app.series[0].id
        const original = app.series[0].data
        const calls = fetchHistory.mock.calls.length

        let result
        await act(async () => { result = await app.setSeriesSymbol(id, 'USD_EUR', 'forex', 'max') })

        expect(result).toMatchObject({ ok: true, local: true })
        expect(fetchHistory).toHaveBeenCalledTimes(calls)
        expect(app.series[0].symbol).toBe('USD_EUR')
        expect(app.series[0].status).toBe('ready')
        expect(app.series[0].data).not.toBe(original)
        expect(app.series[0].data[0].open).toBeCloseTo(1 / 2)
        expect(app.series[0].data[0].high).toBeCloseTo(1 / 1.8)
        expect(app.series[0].data[0].low).toBeCloseTo(1 / 2.4)
        expect(app.series[0].data[0].close).toBeCloseTo(1 / 2.2)
        expect(app.series[0].data[0].volume).toBe(10)

        await act(async () => { result = await app.setSeriesSymbol(id, 'EUR_USD', 'forex', 'max') })

        expect(result).toMatchObject({ ok: true, local: true })
        expect(fetchHistory).toHaveBeenCalledTimes(calls)
        expect(app.series[0].symbol).toBe('EUR_USD')
        expect(app.series[0].data).toBe(original)
    })
})
