// Moving average computation helpers for chart overlays

// Simple moving average with a truncated window at the start of the series
export function computeAdaptiveMovingAverage(values, windowSize) {
    if (!values.length) return []
    const out = new Array(values.length)
    let runningSum = 0

    for (let i = 0; i < values.length; i++) {
        runningSum += values[i]
        const start = Math.max(0, i - windowSize + 1)
        if (start > 0) {
            runningSum -= values[start - 1]
        }
        const span = i - start + 1
        out[i] = span > 0 ? (runningSum / span) : values[i]
    }

    return out
}

// Exponential moving average, seeded with the initial price
export function computeExponentialMovingAverage(values, period = 20) {
    if (!values.length) return []
    const out = new Array(values.length)
    const multiplier = 2 / (period + 1)

    // Seed with initial price
    let prevEma = values[0]
    out[0] = prevEma

    for (let i = 1; i < values.length; i++) {
        prevEma = (values[i] - prevEma) * multiplier + prevEma
        out[i] = prevEma
    }

    return out
}
