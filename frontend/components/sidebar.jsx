// Sidebar component - Search and Predict controls
import { useState } from 'react'
import { useAppState } from '../js/state'
import { ASSET_CLASSES, getAssetPlaceholder } from '../js/asset-classes'
import { sanitizeSymbol } from '../js/symbol-utils'
import InfoModal from './info-modal'

export default function Sidebar() {
    const [searchTerm, setSearchTerm] = useState('')
    const [assetClass, setAssetClass] = useState('equities')
    const [showInfo, setShowInfo] = useState(false)
    const { currentSymbol, timespan, isLoading, setAsset, runPrediction } = useAppState()
    const isSearchEmpty = !searchTerm.trim()

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
                        placeholder={getAssetPlaceholder(assetClass)}
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

                <select
                    id="asset-select"
                    value={assetClass}
                    onChange={(e) => setAssetClass(e.target.value)}
                    disabled={isLoading}
                    className="asset-select"
                >
                    {ASSET_CLASSES.map(({ id, label }) => (
                        <option key={id} value={id}>{label}</option>
                    ))}
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
