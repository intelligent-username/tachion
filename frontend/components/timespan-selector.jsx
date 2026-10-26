// TimespanSelector — orchestrator for the selector ring.
// Pure layout math lives in ./timespan-selector/layout.js
import { useEffect, useRef, useState } from 'react'
import { useAppState } from '../js/state'
import { ALL_OPTIONS, getAvailableSelectorWidth, getVisibleOptions, sameOptionSet, trimOneByPriority } from './timespan-selector/layout'

export default function TimespanSelector() {
    const { timespan, setTimespan } = useAppState()
    const [customDays, setCustomDays]           = useState('')
    const [visibleOptions, setVisibleOptions]   = useState(ALL_OPTIONS)
    const [availableWidth, setAvailableWidth] = useState(0)
    const selectorRef = useRef(null)
    const rafRef = useRef(null)

    const applyCustomDays = (value) => {
        const days = Number(value)
        if (!Number.isFinite(days) || days <= 0) return
        setTimespan(`${Math.floor(days)}d`)
    }

    // Recalculate visible chips on container resize
    useEffect(() => {
        const node = selectorRef.current
        if (!node) return

        const header = node.closest('.chart-header')
        const titleBlock = header?.querySelector('.chart-title-wrap') || header?.querySelector('h1')
        const recalc = () => {
            const nextWidth = getAvailableSelectorWidth(node)
            setAvailableWidth(prev => (prev === nextWidth ? prev : nextWidth))
            setVisibleOptions(prev => {
                const next = getVisibleOptions(nextWidth, timespan)
                return sameOptionSet(prev, next) ? prev : next
            })
        }

        const scheduleRecalc = () => {
            if (rafRef.current != null) return
            rafRef.current = window.requestAnimationFrame(() => {
                rafRef.current = null
                recalc()
            })
        }

        recalc()

        const obs = new ResizeObserver(() => {
            scheduleRecalc()
        })

        if (header) {
            obs.observe(header)
            obs.observe(node)
            if (titleBlock) obs.observe(titleBlock)
        } else {
            obs.observe(node)
        }

        return () => {
            obs.disconnect()
            if (rafRef.current != null) {
                window.cancelAnimationFrame(rafRef.current)
                rafRef.current = null
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Recalculate when timespan changes so the selected chip is always shown
    useEffect(() => {
        if (!availableWidth) return
        setVisibleOptions(prev => {
            const next = getVisibleOptions(availableWidth, timespan)
            return sameOptionSet(prev, next) ? prev : next
        })
    }, [timespan, availableWidth])

    // Guard against real overflow after render (single-row edge case).
    useEffect(() => {
        const node = selectorRef.current
        if (!node) return
        if (visibleOptions.length <= 1) return

        const hasOverflow = node.scrollWidth > node.clientWidth + 1
        if (!hasOverflow) return

        setVisibleOptions(prev => {
            const next = trimOneByPriority(prev, timespan)
            return sameOptionSet(prev, next) ? prev : next
        })
    }, [visibleOptions, timespan])

    return (
        <div className="timespan-selector" role="group" aria-label="Select chart timespan" ref={selectorRef}>

            {/* Custom numeric input — always leftmost inside the ring */}
            <input
                type="number"
                min="1"
                className="timespan-custom-input"
                placeholder="custom"
                value={customDays}
                onChange={(e) => { setCustomDays(e.target.value); applyCustomDays(e.target.value) }}
                onKeyDown={(e) => e.key === 'Enter' && applyCustomDays(customDays)}
                onBlur={() => applyCustomDays(customDays)}
            />

            {/* Priority decides visibility; display keeps chronological ring order */}
            {visibleOptions.map(({ label, value }) => (
                <button
                    key={value}
                    type="button"
                    className={`timespan-chip${timespan === value ? ' active' : ''}`}
                    onClick={() => setTimespan(value)}
                >
                    {label}
                </button>
            ))}
        </div>
    )
}
