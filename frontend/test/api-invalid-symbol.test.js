import { afterEach, expect, it, vi } from 'vitest'
import { fetchHistory } from '../js/api'

afterEach(() => vi.unstubAllGlobals())

it('shows the server rejection detail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false, statusText: 'Not Found', json: async () => ({ detail: 'Unsupported symbol.' })
    }))
    await expect(fetchHistory('FAKE', 'crypto')).rejects.toThrow('Unsupported symbol.')
})

it('falls back when an error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false, statusText: 'Bad Gateway', json: async () => { throw new Error('invalid JSON') }
    }))
    await expect(fetchHistory('FAKE', 'crypto')).rejects.toThrow('Failed to fetch history: Bad Gateway')
})
