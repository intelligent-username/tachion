// Sidebar component - Search and Predict controls
import { useEffect, useRef, useState } from 'react'
import { MAX_SERIES, useAppState } from '../js/state'
import { ASSET_CLASSES, getAssetPlaceholder } from '../js/asset-classes'
import { buildForexPair, cleanCurrencyCode, sanitizeSymbol } from '../js/symbol-utils'
import useForexDirectory from '../js/use-forex-directory'
import ForexPairInput from './forex-pair-input'
import InfoModal from './info-modal'
import SeriesChips from './series-chips'
import TooltipSettings from './tooltip-settings'

export default function Sidebar() {
    const [searchTerm, setSearchTerm] = useState('')
    const [assetClass, setAssetClass] = useState('equities')
    const [showInfo, setShowInfo] = useState(false)
    const [duplicateMessage, setDuplicateMessage] = useState('')
    const [forexDraft, setForexDraft] = useState({ from: '', to: '' })
    const [forexErrors, setForexErrors] = useState({})
    const [forexTouched, setForexTouched] = useState({})
    const forexInputRefs = useRef({})
    const forexDirectory = useForexDirectory(assetClass === 'forex')
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

    // Mirror the focused chip's symbol and asset class when the edit target changes
    useEffect(() => {
        const focused = series.find(s => s.id === focusedSeriesId)
        setSearchTerm(focused?.symbol ?? '')
        if (focused?.assetClass) setAssetClass(focused.assetClass)
        if (focused?.assetClass === 'forex' && focused.symbol) {
            const pair = sanitizeSymbol(focused.symbol, 'forex').match(/^([A-Z]{3})_([A-Z]{3})$/)
            if (pair) setForexDraft({ from: pair[1], to: pair[2] })
        }
        setForexErrors({})
        setForexTouched({})
    }, [focusedSeriesId])

    const handleForexChange = (next) => {
        setForexDraft(next)
        setForexErrors({})
        setDuplicateMessage('')
    }

    const handleForexBlur = (field) => {
        const next = { ...forexDraft, [field]: cleanCurrencyCode(forexDraft[field]) }
        const touched = { ...forexTouched, [field]: true }
        const result = buildForexPair(next)
        setForexDraft(next)
        setForexTouched(touched)
        setForexErrors(Object.fromEntries(Object.entries(result.errors).filter(([key]) => touched[key])))
    }

    const handleAssetChange = (value) => {
        setAssetClass(value)
        setForexErrors({})
        setForexTouched({})
        setDuplicateMessage('')
    }

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

    const submitSymbol = async (symbol) => {
        if (isLoading || !symbol) return
        if (series.length === 0) {
            const result = await setAsset(symbol, assetClass, timespan)
            applySearchResult(result)
            return
        }

        const target = focusedSeries ?? series[0]
        const result = await setSeriesSymbol(target.id, symbol, assetClass, timespan)
        applySearchResult(result)
    }

    const resolveForexPair = (draft = forexDraft) => {
        const result = buildForexPair(draft)
        setForexDraft({ from: result.from, to: result.to })
        setForexErrors(result.errors)
        setForexTouched({ from: true, to: true })
        if (!result.symbol) {
            const field = result.errors.from ? 'from' : 'to'
            forexInputRefs.current[field]?.focus()
        }
        return result
    }

    const handleSearch = (pairOverride) => {
        if (isLoading) return
        const symbol = assetClass === 'forex'
            ? resolveForexPair(pairOverride).symbol
            : sanitizeSymbol(searchTerm, assetClass)
        if (symbol) return submitSymbol(symbol)
    }

    const handleSwap = () => {
        if (isLoading) return
        const result = resolveForexPair()
        if (!result.symbol) return
        const nextDraft = { from: result.to, to: result.from }
        setForexDraft(nextDraft)
        return handleSearch(nextDraft)
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
        if (isLoading) return
        const symbolToUse = assetClass === 'forex'
            ? resolveForexPair().symbol
            : sanitizeSymbol(searchTerm, assetClass) || focusedSeries?.symbol || series[0]?.symbol
        if (!symbolToUse) return
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
                    {assetClass === 'forex' ? (
                        <ForexPairInput
                            key={focusedSeriesId ?? 'forex'}
                            value={forexDraft} errors={forexErrors} disabled={isLoading}
                            directory={forexDirectory.directory} status={forexDirectory.status}
                            onChange={handleForexChange} onBlur={handleForexBlur}
                            onSearch={handleSearch} onSwap={handleSwap} onRetry={forexDirectory.retry}
                            inputRefs={forexInputRefs}
                        />
                    ) : (
                        <>
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
                        </>
                    )}
                </div>

                <div className="asset-row">
                    <select
                        id="asset-select"
                        value={assetClass}
                        onChange={(e) => handleAssetChange(e.target.value)}
                        disabled={isLoading}
                        className="asset-select"
                    >
                        {ASSET_CLASSES.map(({ id, label }) => (
                            <option key={id} value={id}>{label}</option>
                        ))}
                    </select>
                    <TooltipSettings />
                </div>
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
