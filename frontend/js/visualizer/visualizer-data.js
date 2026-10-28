// Chart data normalization and timespan filtering helpers
export function parseDateLike(input) {
    if (input == null) return null
    const d = input instanceof Date ? input : new Date(input)
    return Number.isNaN(d.getTime()) ? null : d
}

export function toNumber(value) {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
}

export function normalizeCandle(row, previousClose = null) {
    const date = parseDateLike(
        row.timestamp ?? row.datetime ?? row.date ?? row.time ?? row.t
    )
    if (!date) return null

    const open = toNumber(row.open ?? row.o)
    const high = toNumber(row.high ?? row.h)
    const low = toNumber(row.low ?? row.l)
    const close = toNumber(row.close ?? row.c ?? row.value)
    const volume = toNumber(row.volume ?? row.v ?? 0) ?? 0

    const fallback = close ?? previousClose
    if (fallback == null) return null

    const safeOpen = open ?? previousClose ?? fallback
    const safeClose = close ?? safeOpen
    const safeHigh = high ?? Math.max(safeOpen, safeClose)
    const safeLow = low ?? Math.min(safeOpen, safeClose)

    return {
        date,
        open: safeOpen,
        high: Math.max(safeHigh, safeOpen, safeClose),
        low: Math.min(safeLow, safeOpen, safeClose),
        close: safeClose,
        volume
    }
}

export function clampCandlesByTimespan(candles, timespan) {
    if (!candles.length || !timespan || timespan === 'max') return candles

    const sorted = [...candles].sort((a, b) => a.date - b.date)
    const end = sorted[sorted.length - 1].date
    let start = null

    if (timespan === 'ytd') {
        start = new Date(end.getFullYear(), 0, 1)
    } else {
        const hourMatch = String(timespan).match(/^(\d+)h$/i)
        const dayMatch = String(timespan).match(/^(\d+)d$/)
        const monthMatch = String(timespan).match(/^(\d+)m$/i)
        const yearMatch = String(timespan).match(/^(\d+)y$/i)

        if (hourMatch) {
            start = new Date(end)
            start.setHours(start.getHours() - Number(hourMatch[1]))
        } else if (dayMatch) {
            start = new Date(end)
            start.setDate(start.getDate() - Number(dayMatch[1]))
        } else if (monthMatch) {
            start = new Date(end)
            start.setMonth(start.getMonth() - Number(monthMatch[1]))
        } else if (yearMatch) {
            start = new Date(end)
            start.setFullYear(start.getFullYear() - Number(yearMatch[1]))
        }
    }

    if (!start) return sorted

    const clamped = sorted.filter(d => d.date >= start && d.date <= end)
    return clamped.length > 1 ? clamped : sorted.slice(-2)
}

export function clampRowsByTimespan(rows, timespan) {
    if (!rows?.length || !timespan || timespan === 'max') return rows ?? []

    // Find a usable end time from the back of the array.
    let end = null
    for (let i = rows.length - 1; i >= 0; i--) {
        const dt = parseDateLike(rows[i]?.timestamp ?? rows[i]?.datetime ?? rows[i]?.date ?? rows[i]?.time ?? rows[i]?.t)
        if (dt) { end = dt; break }
    }
    if (!end) return rows

    let start = null
    if (timespan === 'ytd') {
        start = new Date(end.getFullYear(), 0, 1)
    } else {
        const hourMatch = String(timespan).match(/^(\d+)h$/i)
        const dayMatch = String(timespan).match(/^(\d+)d$/)
        const monthMatch = String(timespan).match(/^(\d+)m$/i)
        const yearMatch = String(timespan).match(/^(\d+)y$/i)

        if (hourMatch) {
            start = new Date(end)
            start.setHours(start.getHours() - Number(hourMatch[1]))
        } else if (dayMatch) {
            start = new Date(end)
            start.setDate(start.getDate() - Number(dayMatch[1]))
        } else if (monthMatch) {
            start = new Date(end)
            start.setMonth(start.getMonth() - Number(monthMatch[1]))
        } else if (yearMatch) {
            start = new Date(end)
            start.setFullYear(start.getFullYear() - Number(yearMatch[1]))
        }
    }

    if (!start) return rows

    const clamped = rows.filter(r => {
        const dt = parseDateLike(r?.timestamp ?? r?.datetime ?? r?.date ?? r?.time ?? r?.t)
        return dt && dt >= start && dt <= end
    })

    return clamped.length > 1 ? clamped : rows.slice(-2)
}

// Normalize raw OHLCV rows into date-sorted candles clamped to the timespan.
// prepareCandles([{ close: 10 }], 'max') returns one candle with close 10.
export function prepareCandles(rows, timespan = 'max') {
    const rawRows = clampRowsByTimespan(rows ?? [], timespan)
    let previousClose = null
    const normalized = rawRows
        .map(row => {
            const candle = normalizeCandle(row, previousClose)
            if (candle) previousClose = candle.close
            return candle
        })
        .filter(Boolean)
        .sort((a, b) => a.date - b.date)
    return clampCandlesByTimespan(normalized, timespan)
}
