// Gear button beside the search bar; expands to tooltip field checkboxes
import { useEffect, useRef, useState } from 'react'
import { useAppState } from '../js/state'

const FIELD_LABELS = [
    ['price', 'Price'],
    ['time', 'Time'],
    ['open', 'Open'],
    ['high', 'High'],
    ['low', 'Low'],
    ['volume', 'Volume']
]

function GearIcon() {
    return (
        <svg
            viewBox="0 0 24 24"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <circle cx="12" cy="12" r="3.2" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33 1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
    )
}

export default function TooltipSettings() {
    const [open, setOpen] = useState(false)
    const rootRef = useRef(null)
    const { tooltipFields, setTooltipField } = useAppState()

    // Close when clicking anywhere outside, like a native popover
    useEffect(() => {
        if (!open) return
        const onPointerDown = (e) => {
            if (!rootRef.current?.contains(e.target)) setOpen(false)
        }
        document.addEventListener('pointerdown', onPointerDown)
        return () => document.removeEventListener('pointerdown', onPointerDown)
    }, [open])

    return (
        <div className="tooltip-settings" ref={rootRef}>
            <button
                className={`tooltip-settings-btn${open ? ' is-open' : ''}`}
                onClick={() => setOpen(v => !v)}
                aria-expanded={open}
                aria-haspopup="true"
                aria-label="Chart tooltip settings"
                title="Chart tooltip settings"
            >
                <GearIcon />
            </button>
            {open && (
                <div className="tooltip-settings-popover" role="group" aria-label="Tooltip rows">
                    {FIELD_LABELS.map(([key, label]) => (
                        <label key={key} className="chart-checkbox">
                            <input
                                type="checkbox"
                                checked={tooltipFields?.[key] !== false}
                                onChange={(e) => setTooltipField(key, e.target.checked)}
                            />
                            <span>{label}</span>
                        </label>
                    ))}
                </div>
            )}
        </div>
    )
}
