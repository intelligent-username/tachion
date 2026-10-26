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
