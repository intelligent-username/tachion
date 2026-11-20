// Per-series chart palette. JS source of truth for SVG attributes.
// Pure module: imports nothing from sibling modules.

export const MA_COLOR = '#f1c40f'
export const EMA_COLOR = '#00d2ff'

// Composite each translucent surface over its ancestors before measuring contrast.
export function compositeColor(foreground, background) {
    const alpha = foreground.opacity
    return {
        r: foreground.r * alpha + background.r * (1 - alpha),
        g: foreground.g * alpha + background.g * (1 - alpha),
        b: foreground.b * alpha + background.b * (1 - alpha),
        opacity: 1
    }
}

export function contrastRatio(a, b) {
    const luminance = color => {
        const linear = channel => {
            const value = channel / 255
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
        }
        return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b)
    }
    const values = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (values[0] + 0.05) / (values[1] + 0.05)
}

// Move toward the better contrasting endpoint, retaining the series hue as much
// as possible. Measure rounded RGB values, since those are what SVG renders.
export function contrastingAxisColor(color, background) {
    const black = { r: 0, g: 0, b: 0 }
    const white = { r: 255, g: 255, b: 255 }
    const target = contrastRatio(black, background) > contrastRatio(white, background) ? black : white
    const mix = amount => ({
        r: Math.round(color.r + (target.r - color.r) * amount),
        g: Math.round(color.g + (target.g - color.g) * amount),
        b: Math.round(color.b + (target.b - color.b) * amount)
    })
    if (contrastRatio(mix(0), background) >= 4.5) return mix(0)
    let low = 0
    let high = 1
    for (let i = 0; i < 16; i++) {
        const mid = (low + high) / 2
        if (contrastRatio(mix(mid), background) >= 4.5) high = mid
        else low = mid
    }
    return mix(high)
}

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
