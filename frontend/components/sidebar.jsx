// Sidebar component - Search and Predict controls
import { useState } from 'react'
import { useAppState } from '../js/state'
import InfoModal from './info-modal'

export default function Sidebar() {
    const [searchTerm, setSearchTerm] = useState('')
    const [searchResults, setSearchResults] = useState([])
    const [assetClass, setAssetClass] = useState('equities')
    const [showInfo, setShowInfo] = useState(false)
    const { currentSymbol, timespan, isLoading, setAsset, runPrediction } = useAppState()
    const isSearchEmpty = !searchTerm.trim()

    const sanitizeSymbol = (value, cls = assetClass) => {
        let symbol = value.trim().replace(/^\$+/, '')
        if (!symbol) return ''

        if (cls === 'crypto') {
            symbol = symbol.toUpperCase().replace(/[\/_-]?USD[T]?$/i, '')
            return symbol
        }

        if (cls === 'forex' || cls === 'comm') {
            const aliases = {
                GOLD: 'XAU_USD',
                SILVER: 'XAG_USD',
                OIL: 'WTICO_USD',
                WTI: 'WTICO_USD',
                BRENT: 'BCO_USD',
                CRUDE: 'WTICO_USD',
            }

            symbol = symbol.toUpperCase().replace(/[\/-]/g, '_')
            if (aliases[symbol]) return aliases[symbol]

            if (/^[A-Z]{6}$/.test(symbol)) {
                return `${symbol.slice(0, 3)}_${symbol.slice(3)}`
            }
            return symbol
        }

        return symbol.toUpperCase()
    }

    const handleSearch = () => {
        const symbol = sanitizeSymbol(searchTerm, assetClass)
        if (!symbol) return
        setAsset(symbol, assetClass, timespan)
    }

    const handlePredict = () => {
        const symbolToUse = sanitizeSymbol(searchTerm, assetClass) || currentSymbol
        runPrediction(7, {
            symbol: symbolToUse,
            assetClass,
            timespan,
            ensureSearched: true
        })
    }

    const placeholders = {
        'equities': 'e.g. NVDA',
        'crypto': 'e.g. ETH',
        'forex': 'e.g. EUR_USD or EUR/USD',
        'comm': 'e.g. XAU_USD (Gold), WTICO_USD',
        'interest': ''
    }

    return (
        <div className="sidebar">
            {showInfo && <InfoModal onClose={() => setShowInfo(false)} initialAsset={assetClass} />}
            <div className="search-section">
                <button
                    className="info-btn"
                    onClick={() => setShowInfo(true)}
                    aria-label="Search help"
                    title="How to search"
                >
                    ?
                </button>
                <div className="search-bar-wrapper">
                    <input
                        id="symbol-input"
                        type="text"
                        placeholder={placeholders[assetClass]}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && !isSearchEmpty && handleSearch()}
                        disabled={isLoading}
                    />
                    <svg
                        className={`search-icon${isSearchEmpty ? ' is-disabled' : ''}`}
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        onClick={!isSearchEmpty ? handleSearch : undefined}
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                </div>

                {searchResults.length > 0 && (
                    <div className="search-results">
                        {searchResults.map((result, i) => (
                            <div
                                key={i}
                                className="search-result"
                                onClick={() => {
                                    setSearchTerm(result)
                                    setSearchResults([])
                                }}
                            >
                                {result}
                            </div>
                        ))}
                    </div>
                )}

                <select
                    id="asset-select"
                    value={assetClass}
                    onChange={(e) => setAssetClass(e.target.value)}
                    disabled={isLoading}
                    className="asset-select"
                >
                    <option value="equities">Equities</option>
                    <option value="forex">FOREX</option>
                    <option value="comm">Commodities</option>
                    <option value="crypto">Crypto</option>
                    <option value="interest">Interest Rates</option>
                </select>
            </div>

            <button
                className="predict-button"
                onClick={handlePredict}
                disabled={isLoading || isSearchEmpty}
            >
                <span className="button-text">Predict</span>
            </button>
        </div>
    )
}
