const OVERLAY_KEY = 'tachion.overlay.v1'

export function loadOverlayPrefs() {
    try {
        const saved = JSON.parse(localStorage.getItem(OVERLAY_KEY))
        return {
            drawBollingerBands: saved?.drawBollingerBands === true,
            drawVolatilityBands: saved?.drawVolatilityBands === true
        }
    } catch {
        return { drawBollingerBands: false, drawVolatilityBands: false }
    }
}

export function saveOverlayPrefs(drawBollingerBands, drawVolatilityBands) {
    try {
        localStorage.setItem(OVERLAY_KEY, JSON.stringify({
            drawBollingerBands: drawBollingerBands === true,
            drawVolatilityBands: drawVolatilityBands === true
        }))
    } catch {
        // Storage may be unavailable; preferences remain active in memory.
    }
}
