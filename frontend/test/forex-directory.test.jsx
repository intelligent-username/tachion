import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchForexCurrencies } from '../js/api'
import useForexDirectory from '../js/use-forex-directory'

const directory = {
    currencies: ['EUR', 'USD'], pairs: [{ symbol: 'EUR_USD', base: 'EUR', quote: 'USD' }],
    stale: false, refreshAfterSeconds: 3600,
}
const response = data => ({ ok: true, json: async () => data })
const flush = async () => { await act(async () => { await Promise.resolve() }) }

beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(directory)))
})
afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

describe('directory client', () => {
    it('uses the neutral endpoint and AbortSignal', async () => {
        const controller = new AbortController()
        expect(await fetchForexCurrencies({ signal: controller.signal })).toEqual(directory)
        expect(fetch).toHaveBeenCalledWith('/api/forex/currencies', { signal: controller.signal })
    })
    it.each([{}, { ...directory, pairs: [] }, { ...directory, currencies: ['USD'] }, { ...directory, refreshAfterSeconds: 0 }])('rejects malformed data', async data => {
        fetch.mockResolvedValueOnce(response(data))
        await expect(fetchForexCurrencies()).rejects.toThrow('Invalid currency directory')
    })
    it('rejects HTTP failures', async () => {
        fetch.mockResolvedValueOnce({ ok: false })
        await expect(fetchForexCurrencies()).rejects.toThrow('unavailable')
    })
})

describe('directory lifecycle', () => {
    it('loads lazily, preserves cached results across asset switches, and refreshes hourly', async () => {
        const { result, rerender } = renderHook(({ active }) => useForexDirectory(active), { initialProps: { active: false } })
        expect(fetch).not.toHaveBeenCalled()
        rerender({ active: true })
        await flush()
        expect(result.current.status).toBe('ready')
        rerender({ active: false })
        rerender({ active: true })
        await flush()
        expect(fetch).toHaveBeenCalledTimes(1)
        await act(async () => { await vi.advanceTimersByTimeAsync(3_600_000) })
        expect(fetch).toHaveBeenCalledTimes(2)
        expect(result.current.directory).toEqual(directory)
    })

    it('retains suggestions on error and throttles retries', async () => {
        const { result } = renderHook(() => useForexDirectory(true))
        await flush()
        fetch.mockRejectedValueOnce(new Error('offline'))
        await act(async () => { await vi.advanceTimersByTimeAsync(3_600_000) })
        expect(result.current.status).toBe('error')
        expect(result.current.directory).toEqual(directory)
        act(() => result.current.retry())
        expect(fetch).toHaveBeenCalledTimes(2)
        await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
        expect(result.current.status).toBe('ready')
        expect(fetch).toHaveBeenCalledTimes(3)
    })

    it('exposes cold failure and stale server results without discarding data', async () => {
        fetch.mockRejectedValueOnce(new Error('offline'))
        const { result } = renderHook(() => useForexDirectory(true))
        await flush()
        expect(result.current.directory).toBeNull()
        expect(result.current.status).toBe('error')
        fetch.mockResolvedValueOnce(response({ ...directory, stale: true, refreshAfterSeconds: 60 }))
        await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
        expect(result.current.status).toBe('stale')
        expect(result.current.directory.currencies).toEqual(['EUR', 'USD'])
    })

    it('ignores aborted late responses and clears refresh timers', async () => {
        let resolveOld
        fetch.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
        const { result, rerender, unmount } = renderHook(({ active }) => useForexDirectory(active), { initialProps: { active: true } })
        const oldSignal = fetch.mock.calls[0][1].signal
        rerender({ active: false })
        expect(oldSignal.aborted).toBe(true)
        rerender({ active: true })
        await flush()
        await act(async () => { resolveOld(response({ ...directory, stale: true })) })
        expect(result.current.status).toBe('ready')
        unmount()
        expect(vi.getTimerCount()).toBe(0)
    })
})
