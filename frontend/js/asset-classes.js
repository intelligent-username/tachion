// Canonical asset class registry — single source of truth for the sidebar
// select options, search placeholders, and info modal asset ids.
export const ASSET_CLASSES = [
    { id: 'equities', label: 'Equities', placeholder: 'e.g. NVDA' },
    { id: 'forex', label: 'FOREX', placeholder: 'e.g. EUR_USD or EUR/USD' },
    { id: 'comm', label: 'Commodities', placeholder: 'e.g. XAU_USD (Gold), WTICO_USD' },
    { id: 'crypto', label: 'Crypto', placeholder: 'e.g. ETH' },
    { id: 'interest', label: 'Interest Rates', placeholder: '' },
]

export const ASSET_LABELS = Object.fromEntries(
    ASSET_CLASSES.map(({ id, label }) => [id, label])
)

export function getAssetPlaceholder(assetClass) {
    return ASSET_CLASSES.find(a => a.id === assetClass)?.placeholder ?? ''
}
