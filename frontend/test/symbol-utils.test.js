import { describe, expect, it } from 'vitest'
import {
    buildForexPair, cleanCurrencyCode, getForexSuggestions, inverseForexPair, invertForexRows, sanitizeSymbol,
} from '../js/symbol-utils'

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

describe('reciprocal FOREX history', () => {
    it('identifies the opposite canonical pair', () => {
        expect(inverseForexPair('EUR_USD')).toBe('USD_EUR')
        expect(inverseForexPair('USD_JPY')).toBe('JPY_USD')
        expect(inverseForexPair('EUR_EUR')).toBeNull()
        expect(inverseForexPair('EURUSD')).toBeNull()
        expect(inverseForexPair(null)).toBeNull()
    })

    it('inverts OHLC and keeps timestamps and volume', () => {
        const [row] = invertForexRows([
            { timestamp: '2026-11-06T10:00:00', open: 2, high: 2.4, low: 1.8, close: 2.2, volume: 10, value: 2.2 },
        ])
        expect(row).toMatchObject({ timestamp: '2026-11-06T10:00:00', volume: 10 })
        expect(row.open).toBeCloseTo(1 / 2)
        expect(row.high).toBeCloseTo(1 / 1.8)
        expect(row.low).toBeCloseTo(1 / 2.4)
        expect(row.close).toBeCloseTo(1 / 2.2)
        expect(row.value).toBeCloseTo(1 / 2.2)
    })

    it('drops unusable prices and non-arrays', () => {
        expect(invertForexRows(null)).toEqual([])
        expect(invertForexRows([{ open: 0, high: 1, low: 1, close: 1 }])).toEqual([])
        expect(invertForexRows([{ open: 1, high: 1, low: 1, close: 'nope' }])).toEqual([])
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
