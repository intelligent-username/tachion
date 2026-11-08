import { describe, expect, it } from 'vitest'
import { buildForexPair, cleanCurrencyCode, getForexSuggestions, sanitizeSymbol } from '../js/symbol-utils'

describe('FOREX codes', () => {
    it.each(['eur', ' e /u_r ', 'E U R', '_EUR/'])('cleans a single code: %s', from => {
        expect(buildForexPair({ from, to: 'usD' })).toEqual({ from: 'EUR', to: 'USD', symbol: 'EUR_USD', errors: {} })
    })

    it.each(['', 'EU', 'EUR_USD', 'EURUSD', 'EUR/USD', 'EU-R', 'US1', 'ßa', 'éur', '$EUR'])('rejects malformed codes: %s', from => {
        expect(buildForexPair({ from, to: 'USD' }).symbol).toBe('')
        expect(buildForexPair({ from, to: 'USD' }).errors.from).toBeTruthy()
    })

    it('rejects identical codes and accepts codes not in suggestions', () => {
        expect(buildForexPair({ from: 'usd', to: '_USD' }).errors.to).toBe('Choose two different currencies.')
        expect(buildForexPair({ from: 'ABC', to: 'XYZ' }).symbol).toBe('ABC_XYZ')
        expect(cleanCurrencyCode(null)).toBe('')
        expect(cleanCurrencyCode('ßa')).toBe('ßA')
    })

    it('suggests pair-aware codes in either direction', () => {
        const directory = {
            currencies: ['USD', 'EUR', 'JPY', 'GBP'],
            pairs: [{ base: 'EUR', quote: 'USD' }, { base: 'USD', quote: 'JPY' }],
        }
        expect(getForexSuggestions(directory, 'usd')).toEqual(['EUR', 'JPY'])
        expect(getForexSuggestions(directory, 'eur')).toEqual(['USD'])
        expect(getForexSuggestions(directory, '', 'g')).toEqual(['GBP'])
        expect(getForexSuggestions(directory, 'USD', ' e/')).toEqual(['EUR'])
        expect(getForexSuggestions(directory, 'ZZZ')).toEqual([])
        expect(getForexSuggestions(null, '')).toEqual([])
    })
})

describe('existing symbol normalization', () => {
    it.each([
        ['$aapl', 'equities', 'AAPL'], ['btc/usdt', 'crypto', 'BTC'],
        ['gold', 'comm', 'XAU_USD'], ['eurusd', 'forex', 'EUR_USD'],
    ])('preserves %s', (input, asset, expected) => {
        expect(sanitizeSymbol(input, asset)).toBe(expected)
    })
})
