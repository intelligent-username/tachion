// Symbol normalization shared by the search + predict flows.
// Mirrors the backend's accepted formats (see info-modal docs).

// Commodity alias table (OANDA-style underscore symbols)
const COMM_ALIASES = {
    GOLD: 'XAU_USD',
    SILVER: 'XAG_USD',
    OIL: 'WTICO_USD',
    WTI: 'WTICO_USD',
    BRENT: 'BCO_USD',
    CRUDE: 'WTICO_USD',
}

export function sanitizeSymbol(value, assetClass) {
    let symbol = value.trim().replace(/^\$+/, '')
    if (!symbol) return ''

    if (assetClass === 'crypto') {
        symbol = symbol.toUpperCase().replace(/[\/_-]?USD[T]?$/i, '')
        return symbol
    }

    if (assetClass === 'forex' || assetClass === 'comm') {
        symbol = symbol.toUpperCase().replace(/[\/-]/g, '_')
        if (COMM_ALIASES[symbol]) return COMM_ALIASES[symbol]

        if (/^[A-Z]{6}$/.test(symbol)) {
            return `${symbol.slice(0, 3)}_${symbol.slice(3)}`
        }
        return symbol
    }

    return symbol.toUpperCase()
}

export function cleanCurrencyCode(value) {
    return String(value ?? '').replace(/[\s_/]/g, '').replace(/[a-z]/g, letter => letter.toUpperCase())
}

// Return the opposite canonical pair, or null when the input is not a valid pair.
export function inverseForexPair(symbol) {
    const match = /^([A-Z]{3})_([A-Z]{3})$/.exec(String(symbol ?? ''))
    if (!match || match[1] === match[2]) return null
    return `${match[2]}_${match[1]}`
}

// Express OHLC candles in the reciprocal quote. Ordering reverses: the old
// low becomes the new high. Invalid/non-positive candles are dropped.
export function invertForexRows(rows) {
    if (!Array.isArray(rows)) return []
    const inverted = []
    for (const row of rows) {
        if (!row || typeof row !== 'object') continue
        const open = Number(row.open)
        const high = Number(row.high)
        const low = Number(row.low)
        const close = Number(row.close ?? row.value)
        if (![open, high, low, close].every(price => Number.isFinite(price) && price > 0)) continue
        const volume = Number(row.volume)
        inverted.push({
            ...row,
            open: 1 / open,
            high: 1 / low,
            low: 1 / high,
            close: 1 / close,
            value: 1 / close,
            volume: Number.isFinite(volume) ? volume : 0,
        })
    }
    return inverted
}

export function buildForexPair({ from, to }) {
    const normalized = { from: cleanCurrencyCode(from), to: cleanCurrencyCode(to) }
    const errors = {}
    for (const field of ['from', 'to']) {
        if (!normalized[field]) errors[field] = 'Enter a currency code.'
        else if (!/^[A-Z]{3}$/.test(normalized[field])) errors[field] = 'Enter one three-letter currency code, e.g. EUR.'
    }
    if (!Object.keys(errors).length && normalized.from === normalized.to) {
        errors.to = 'Choose two different currencies.'
    }
    return {
        ...normalized,
        symbol: Object.keys(errors).length ? '' : `${normalized.from}_${normalized.to}`,
        errors,
    }
}

export function getForexSuggestions(directory, otherCode, query = '') {
    if (!directory) return []
    const other = cleanCurrencyCode(otherCode)
    const prefix = cleanCurrencyCode(query)
    let candidates = directory.currencies
    if (/^[A-Z]{3}$/.test(other)) {
        const partners = new Set()
        for (const { base, quote } of directory.pairs) {
            if (base === other) partners.add(quote)
            if (quote === other) partners.add(base)
        }
        candidates = [...partners]
    }
    return candidates.filter(code => code !== other && code.startsWith(prefix)).sort()
}
