// Per-series chart palette. JS source of truth for SVG attributes.
// Pure module: imports nothing from sibling modules.

export const MA_COLOR = '#f1c40f'
export const EMA_COLOR = '#00d2ff'

// Descriptors for two-series mode, indexed by axis position.
export const SERIES_COLORS = [
    {
        up: '#27ae60',
        down: '#e74c3c',
        line: '#e74c3c',
        axis: '#e74c3c',
        gradientId: 'price-area-gradient-series-1',
        gradientFrom: 'rgba(231, 76, 60, 0.95)',
        gradientTo: 'rgba(231, 76, 60, 0.95)',
        dash: null
    },
    {
        up: '#4dabf7',
        down: '#ff8a4c',
        line: '#00d2ff',
        axis: '#00d2ff',
        gradientId: 'price-area-gradient-series-2',
        gradientFrom: 'rgba(0, 210, 255, 0.95)',
        gradientTo: 'rgba(0, 210, 255, 0.95)',
        dash: '6 3'
    }
]

// Single-series look must match the pre-multi-series chart exactly.
const SINGLE_SERIES_NEUTRAL = {
    line: 'rgba(238, 238, 238, 0.9)',
    axis: 'rgba(238, 238, 238, 0.75)',
    gradientId: 'price-area-gradient-neutral',
    gradientFrom: 'rgba(238, 238, 238, 0.95)',
    gradientTo: 'rgba(238, 238, 238, 0.95)'
}

const FALLBACK_INDEX = SERIES_COLORS.length - 1

// Stable shape: { up, down, line, axis, gradientId, gradientFrom, gradientTo, dash }.
// resolveSeriesColors(0, 1) keeps the neutral line/axis; resolveSeriesColors(1, 2) returns cyan with dash '6 3'.
// Indices above the palette fall back to series 2 with a unique gradient id and never throw.
export function resolveSeriesColors(index, totalSeries = 1) {
    const safeIndex = Number.isInteger(index) && index > 0 ? index : 0
    const descriptor = SERIES_COLORS[safeIndex] ?? SERIES_COLORS[FALLBACK_INDEX]
    const colors = { ...descriptor }

    if (safeIndex === 0 && totalSeries < 2) {
        Object.assign(colors, SINGLE_SERIES_NEUTRAL)
    }
    if (safeIndex > FALLBACK_INDEX) {
        colors.gradientId = `price-area-gradient-series-${safeIndex + 1}`
    }
    return colors
}
