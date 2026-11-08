// TimespanSelector — orchestrator for the selector ring.
// Pure layout math lives in ./timespan-selector/layout.js
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAppState } from '../js/state'
import { ALL_OPTIONS, getAvailableSelectorWidth, getVisibleOptions, sameOptionSet, trimOneByPriority } from './timespan-selector/layout'

export default function TimespanSelector() {
    const { timespan, setTimespan } = useAppState()
    const [customDays, setCustomDays]           = useState('')
    const [visibleOptions, setVisibleOptions]   = useState(ALL_OPTIONS)
    const [availableWidth, setAvailableWidth] = useState(0)
    const selectorRef = useRef(null)
    const rafRef = useRef(null)
    const indicatorRef = useRef(null)
    const selectionAnimationRef = useRef(null)
    const previousTimespanRef = useRef(timespan)

    useLayoutEffect(() => {
        const node = selectorRef.current
        const indicator = indicatorRef.current
        if (!node || !indicator) return

        const positionIndicator = (animate) => {
            const active = node.querySelector('.timespan-chip.active')
            const previous = indicator.getBoundingClientRect()
            const container = node.getBoundingClientRect()
            const target = active?.getBoundingClientRect()
            selectionAnimationRef.current?.cancel()
            selectionAnimationRef.current = null
            node.dataset.selectionReady = String(Boolean(target))
            indicator.hidden = !target
            if (!target) return

            const x = target.left - container.left - node.clientLeft
            const y = target.top - container.top - node.clientTop
            const transform = `translate(${x}px, ${y}px)`
            indicator.style.width = `${target.width}px`
            indicator.style.height = `${target.height}px`
            indicator.style.transform = transform

            if (!animate || !previous.width || !target.width || !target.height ||
                window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !indicator.animate) return

            // FLIP the highlight only; chip labels and selector geometry never scale.
            selectionAnimationRef.current = indicator.animate([
                { transform: `translate(${previous.left - container.left - node.clientLeft}px, ${previous.top - container.top - node.clientTop}px) scale(${previous.width / target.width}, ${previous.height / target.height})` },
                { transform }
            ], { duration: 240, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' })
        }

        positionIndicator(previousTimespanRef.current !== timespan)
        previousTimespanRef.current = timespan
        let width = node.clientWidth
        let height = node.clientHeight
        const observer = new ResizeObserver(() => {
            if (width === node.clientWidth && height === node.clientHeight) return
            width = node.clientWidth
            height = node.clientHeight
            positionIndicator(false)
        })
        observer.observe(node)
        return () => observer.disconnect()
    }, [timespan, visibleOptions, availableWidth])

    useEffect(() => () => selectionAnimationRef.current?.cancel(), [])

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
        const actions = node.closest('.chart-header-actions')
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
            if (actions) obs.observe(actions)
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
            <span className="timespan-selection" ref={indicatorRef} aria-hidden="true" hidden />

            {/* Custom numeric input — always leftmost inside the ring */}
            <input
                type="number"
                min="1"
                className="timespan-custom-input"
                placeholder="custom"
                aria-label="Custom days"
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
                    aria-pressed={timespan === value}
                    onClick={() => setTimespan(value)}
                >
                    {label}
                </button>
            ))}
        </div>
    )
}
