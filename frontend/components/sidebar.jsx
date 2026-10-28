// Sidebar component - Search and Predict controls
import { useEffect, useState } from 'react'
import { MAX_SERIES, useAppState } from '../js/state'
import { ASSET_CLASSES, getAssetPlaceholder } from '../js/asset-classes'
import { sanitizeSymbol } from '../js/symbol-utils'
import InfoModal from './info-modal'
import SeriesChips from './series-chips'

export default function Sidebar() {
    const [searchTerm, setSearchTerm] = useState('')
    const [assetClass, setAssetClass] = useState('equities')
    const [showInfo, setShowInfo] = useState(false)
    const [duplicateMessage, setDuplicateMessage] = useState('')
    const {
        series,
        focusedSeriesId,
        timespan,
        isLoading,
        setAsset,
        setSeriesSymbol,
        addSeriesSlot,
        focusSeries,
        removeSeries,
        reorderSeries,
        cycleSeriesVisibility,
        runPrediction
    } = useAppState()
    const focusedSeries = series.find(s => s.id === focusedSeriesId) ?? series[0] ?? null
    const isSearchEmpty = !searchTerm.trim()
    const hasPopulatedSeries = series.some(s => s.symbol)

    // Mirror the focused chip's asset class when the edit target changes
    useEffect(() => {
        const focused = series.find(s => s.id === focusedSeriesId)
        if (focused?.assetClass) setAssetClass(focused.assetClass)
    }, [focusedSeriesId])

    const applySearchResult = (result) => {
        // A superseded request is not an error; the newer request owns the UI.
        if (result?.stale === true) {
            setDuplicateMessage('')
            return
        }
        if (result?.ok === false) {
            setDuplicateMessage(result.error || 'Already on chart')
            return
        }
        setDuplicateMessage('')
    }

    const handleSearch = async () => {
        const symbol = sanitizeSymbol(searchTerm, assetClass)
        if (!symbol) return

        if (series.length === 0) {
            const result = await setAsset(symbol, assetClass, timespan)
            applySearchResult(result)
            return
        }

        const target = focusedSeries ?? series[0]
        const result = await setSeriesSymbol(target.id, symbol, assetClass, timespan)
        applySearchResult(result)
    }

    const handleSearchInput = (value) => {
        setSearchTerm(value)
        setDuplicateMessage('')
    }

    const handleAdd = () => {
        addSeriesSlot()
    }

    const handleRemove = (id) => {
        removeSeries(id)
    }

    const handlePredict = () => {
        const symbolToUse = sanitizeSymbol(searchTerm, assetClass) || focusedSeries?.symbol || series[0]?.symbol
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
                        onChange={(e) => handleSearchInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && !isSearchEmpty && !isLoading && handleSearch()}
                        disabled={isLoading}
                    />
                    <svg
                        className={`search-icon${isSearchEmpty || isLoading ? ' is-disabled' : ''}`}
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        onClick={!isSearchEmpty && !isLoading ? handleSearch : undefined}
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

            <SeriesChips
                series={series}
                focusedSeriesId={focusedSeriesId}
                maxSeries={MAX_SERIES}
                onFocus={focusSeries}
                onRemove={handleRemove}
                onReorder={reorderSeries}
                onCycle={cycleSeriesVisibility}
                onAdd={handleAdd}
            />

            {duplicateMessage && (
                <div className="series-duplicate-msg" role="status">{duplicateMessage}</div>
            )}

            <button
                className="predict-button"
                onClick={handlePredict}
                disabled={isLoading || !hasPopulatedSeries}
            >
                <span className="button-text">Predict</span>
            </button>
        </div>
    )
}
