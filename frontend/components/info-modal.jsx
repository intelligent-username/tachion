// InfoModal – Question mark on the search bar for documentation
import { useEffect, useRef } from 'react'

const GLOBAL_NOTES = [
    "The 'custom' time band accepts a timespan in whole days (no decimals).",
    "The models will predict an 'upcoming' period of ⌊ln(n)⌋ time of movement, meaning, for example, when pressing 'Predict' with a timespan of 14 days, the model will predict roughly the next 2 days of movement.",
    "Market close times (for commodities, equities, and FOREX) cap how much data is available to show.",
    "Some requests simply don't have enough data. For example JPY to INR conversion will have such little volume that no meaningful uses are servable.",
    "The MA checkbox draws the 30-candlestick moving average for the given time series.",
    "By default, data goes back a maximum of roughly ~5 years for equities and crypto, ~15 years for FOREX, and ~16 years for commodities. For interest rates, we have many more years of data. The reason the data span is capped is because the primary purpose is to make predictions, and very old financial information has no bearing on today\'s movements.",
    "Disclaimer: all retrieved timeseries data will be on a 30-minute OHCLV basis in order to maintain consistency with the models.",
    "Disclaimer: selecting the 'max' timeframe is likely to cause major lag.",
]

const ASSET_DOCS = [
    {
        id: 'equities',
        label: 'Equities',
        intro: 'These are data from US stock exchanges..',
        examples: [
            { symbol: 'SPY', label: 'S&P 500 ETF' },
            { symbol: 'NVDA', label: 'NVIDIA' },
            { symbol: 'QQQ', label: 'Nasdaq 100 Index' },
            { symbol: 'BRK.B', label: 'Berkshire Hathaway B' },
        ],
        alternatives:
            'Prices are shown in USD. Symbols are capped to US stock exchanges. You can type with or without a leading dollar sign, (e.g. $AAPL) and with or without capitalization (e.g. aapl).',
        finalPoint: 'If a ticker is not listed on supported US exchanges, it may not resolve.',
    },
    {
        id: 'crypto',
        label: 'Crypto',
        intro: 'These are cryptocurrency price movements. Write the base symbol.',
        examples: [
            { symbol: 'BTC', label: 'Bitcoin' },
            { symbol: 'ETH/USD', label: 'Ethereum in USD' },
            { symbol: 'XRP-usd', label: 'XRP in USD (dash + lowercase works)' },
        ],
        alternatives:
            'You may add slash/lowercase/dash since the backend normalizes format. BTC, btc, BTC/USD, and BTC-usdt are accepted and normalized to the base symbol.',
        finalPoint: 'Data comes from Binance, so some tickers may not show, depending on availability.',
    },
    {
        id: 'forex',
        label: 'FOREX',
        intro:
            "This are foreign currency exchanges. Write the primary currency's symbol followed by the currency you want to convert it to.",
        examples: [
            { symbol: 'EURUSD', label: 'Converts € to $' },
            { symbol: 'Eur/Usd', label: 'Alternative slash format' },
            { symbol: 'aud_gpy', label: 'Australian $ to Japanese ¥' },
        ],
        alternatives:
            'Requirement: 3 letters for the first currency and 3 for the second. Dashes/underscores/slashes may be added, and capitalization is free, since all will be normalized in the backend.',
        finalPoint: 'Pairs outside provider coverage will return no results.',
    },
    {
        id: 'comm',
        label: 'Commodities',
        intro: 'These are physical commodities.',
        examples: [
            { symbol: 'XAU_USD', label: 'Gold price in USD' },
            { symbol: 'XAG_USD', label: 'Silver price in USD' },
            { symbol: 'WTICO_USD', label: 'WTI crude oil in USD' },
            { symbol: 'BCO_USD', label: 'Brent crude in USD' },
        ],
        alternatives:
            'Accepted aliases: Gold (will be converted to XAU_USD), SILVER, OIL/WTI/CRUDE, Brent, etc. with varying capitalizations.',
        finalPoint: 'If the OANDA API does not expose a commodity symbol, it cannot be retrieved.',
    },
    {
        id: 'interest',
        label: 'Interest Rates',
        intro: 'These are US government interest rate changes. More details coming soon.',
        examples: [
            { symbol: 'DGS10', label: '10-Year Treasury constant maturity rate' },
            { symbol: 'DGS2', label: '2-Year Treasury constant maturity rate' },
            { symbol: 'FEDFUNDS', label: 'Effective Federal Funds Rate' },
        ],
        alternatives:
            'Use common FRED series IDs for rates and spreads; symbols are typically uppercase identifiers.',
        finalPoint: 'This category has much longer historical coverage than the others.',
    },
]

export default function InfoModal({ onClose, initialAsset = 'equities' }) {
    const overlayRef = useRef(null)
    const bodyRef = useRef(null)

    // Close on Escape
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [onClose])

    // Auto-scroll to currently selected asset class section on open
    useEffect(() => {
        if (!initialAsset) return
        const timer = setTimeout(() => {
            const targetSection = bodyRef.current?.querySelector(`[data-asset-id="${initialAsset}"]`)
            if (targetSection) {
                targetSection.scrollIntoView({ behavior: 'smooth', block: 'start' })
                targetSection.classList.add('info-asset-highlight')
            }
        }, 80)
        return () => clearTimeout(timer)
    }, [initialAsset])

    // Close on backdrop click
    const handleOverlayClick = (e) => {
        if (e.target === overlayRef.current) onClose()
    }

    return (
        <div className="info-modal-overlay" ref={overlayRef} onClick={handleOverlayClick}>
            <div className="info-modal">
                <button className="info-modal-close" onClick={onClose} aria-label="Close">✕</button>

                <div className="info-modal-header">
                    <h2>Search Reference Page</h2>
                    <p className="info-modal-subtitle">
                        Select an asset class, then type a symbol into the search bar.
                        This page explains accepted inputs, normalization behavior, and caveats.
                    </p>
                </div>

                <div className="info-modal-body" ref={bodyRef}>
                    <section className="info-global-notes">
                        <h3>Note</h3>
                        <ul>
                            {GLOBAL_NOTES.map((note, i) => (
                                <li key={i}>{note}</li>
                            ))}
                        </ul>
                    </section>

                    {ASSET_DOCS.map((asset) => (
                        <section
                            key={asset.id}
                            data-asset-id={asset.id}
                            className={`info-asset-section${initialAsset === asset.id ? ' info-asset-target' : ''}`}
                        >
                            <div className="info-asset-header">
                                <h3>{asset.label}</h3>
                            </div>

                            <p className="info-asset-desc">
                                {asset.intro}
                            </p>

                            <div className="info-examples">
                                {asset.examples.map((ex) => (
                                    <div key={`${asset.id}-${ex.symbol}`} className="info-example info-example-chip">
                                        <span className="info-example-symbol">{ex.symbol}</span>
                                        <span className="info-example-label">{ex.label}</span>
                                    </div>
                                ))}
                            </div>

                            <p className="info-asset-alt">{asset.alternatives}</p>
                            <p className="info-asset-final">{asset.finalPoint}</p>
                        </section>
                    ))}
                </div>

                <div className="info-modal-footer">
                    <button className="info-return-btn" onClick={onClose}>
                        ← return to main page
                    </button>
                </div>
            </div>
        </div>
    )
}
