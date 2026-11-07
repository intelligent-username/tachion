// Dropdown-style button beside the asset select; expands to tooltip field checkboxes
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

function ChevronIcon() {
    return (
        <svg
            viewBox="0 0 14 10"
            width="12"
            height="9"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M2 2l5 5 5-5" />
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
                <ChevronIcon />
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
