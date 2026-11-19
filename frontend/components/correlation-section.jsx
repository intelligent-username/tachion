import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useAppState } from '../js/state'
import { analyzePair } from '../js/correlation'

const percentFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })
const scoreFormat = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const number = (value, digits = 1) => {
    const rounded = Number(value.toFixed(digits))
    return (digits === 2 ? scoreFormat : percentFormat).format(rounded === 0 ? 0 : rounded)
}

function resultPoints({ a, b, options, metrics }) {
    const movement = number(options.movementBars * options.barMs / 60000)
    const response = number(options.responseBars * options.barMs / 60000)
    const threshold = number(options.minFollowRatio * 100)
    const noise = number(options.minAMove * 100)
    const definitions = [
        {
            id: 'together',
            text: value => `${a} and ${b} move together ${value}% of the time.`,
            missing: `Not enough simultaneous moves for ${a} and ${b}.`,
            explanation: `Same ${movement}-minute window; ${b} moves in ${a}’s direction by at least ${threshold}% as much. Ignores ${a} moves below ${noise}%.`,
            unit: 'observations'
        },
        {
            id: 'up',
            text: value => `After ${a} rises, ${b} follows ${value}% of the time.`,
            missing: `Not enough ${a} rises to measure ${b}’s response.`,
            explanation: `Checks ${b}’s net move over the next ${response} minutes; requires at least ${threshold}% of ${a}’s prior ${movement}-minute rise. Ignores rises below ${noise}%.`,
            unit: 'rises'
        },
        {
            id: 'down',
            text: value => `After ${a} falls, ${b} follows ${value}% of the time.`,
            missing: `Not enough ${a} falls to measure ${b}’s response.`,
            explanation: `Checks ${b}’s net move over the next ${response} minutes; requires a fall at least ${threshold}% as large as ${a}’s prior ${movement}-minute fall. Ignores falls below ${noise}%.`,
            unit: 'falls'
        },
        {
            id: 'combined',
            text: value => `Across rises and falls, ${b} follows ${a} ${value}% of the time.`,
            missing: `Not enough delayed responses from ${b} to ${a}.`,
            explanation: `Pools rises and falls: ${a} moves at least ${noise}% over ${movement} minutes, then ${b} follows by at least ${threshold}% as much over ${response} minutes. End-of-window moves only.`,
            unit: 'observations'
        },
        {
            id: 'size',
            text: value => `${b}’s typical later move is ${value}% of ${a}’s move.`,
            missing: `Not enough observations to measure ${b}’s relative move.`,
            explanation: `Median proportional response over the next ${response} minutes, including misses. Negative means opposite direction.`,
            unit: 'observations'
        },
        {
            id: 'correlation',
            text: value => `${a} and ${b}’s co-movement score is ${value}.`,
            missing: `Not enough observations for ${a} and ${b}’s co-movement score.`,
            explanation: 'Return correlation from −1 (opposite) to +1 (together); 0 means little linear relationship. Not a hit rate.',
            unit: 'observations'
        }
    ]
    return definitions.map(point => {
        const metric = metrics[point.id]
        const available = metric.value !== null
        let text = point.missing
        let explanation = point.explanation
        if (available) {
            text = point.text(point.id === 'correlation'
                ? number(metric.value, 2)
                : number(metric.value * 100))
            explanation += ` ${metric.hits !== undefined ? `${metric.hits}/` : ''}${metric.n} ${point.unit}.`
        } else if (metric.reason === 'insufficient') {
            explanation += ` ${metric.n}/${options.minSamples} required ${point.unit}.`
        } else {
            text = point.id === 'correlation'
                ? `${a} and ${b}’s co-movement score is unavailable.`
                : `${b}’s relative move is unavailable.`
            explanation = metric.reason === 'constant'
                ? `A co-movement score needs variation in both stocks’ returns. One or both are constant across ${metric.n} eligible observations.`
                : 'These returns cannot be summarized reliably; choose another historical range.'
        }
        return { id: point.id, text, explanation }
    })
}

function CorrelationPoint({ point, open, onOpen, onClose }) {
    const tooltipId = useId()
    const root = useRef(null)
    const pinned = useRef(false)
    const dismissed = useRef(false)
    const focused = useRef(false)

    useEffect(() => {
        if (!open) {
            pinned.current = false
            return
        }
        const dismiss = () => {
            pinned.current = false
            dismissed.current = true
            onClose(point.id)
        }
        const onPointerDown = event => {
            if (!root.current?.contains(event.target)) dismiss()
        }
        const onKeyDown = event => {
            if (event.key === 'Escape') dismiss()
        }
        document.addEventListener('pointerdown', onPointerDown)
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('pointerdown', onPointerDown)
            document.removeEventListener('keydown', onKeyDown)
        }
    }, [open, onClose, point.id])

    const show = () => {
        if (!dismissed.current) onOpen(point.id)
    }

    return (
        <li
            className="correlation-point"
            ref={root}
            onPointerEnter={event => {
                if (event.pointerType !== 'touch') show()
            }}
            onPointerLeave={() => {
                if (!pinned.current && !focused.current) onClose(point.id)
                if (!focused.current) dismissed.current = false
            }}
            onBlur={event => {
                if (event.currentTarget.contains(event.relatedTarget)) return
                focused.current = false
                dismissed.current = false
                pinned.current = false
                onClose(point.id)
            }}
        >
            <button
                type="button"
                className="correlation-sentence"
                aria-describedby={open ? tooltipId : undefined}
                onFocus={() => {
                    if (!focused.current) dismissed.current = false
                    focused.current = true
                    show()
                }}
                onClick={() => {
                    if (pinned.current) {
                        pinned.current = false
                        dismissed.current = true
                        onClose(point.id)
                    } else {
                        pinned.current = true
                        dismissed.current = false
                        onOpen(point.id)
                    }
                }}
            >
                {point.text}
            </button>
            {open && <div id={tooltipId} role="tooltip" className="correlation-explanation">{point.explanation}</div>}
        </li>
    )
}

function CorrelationResults({ result }) {
    const [active, setActive] = useState(null)
    const points = resultPoints(result)
    const close = useCallback(id => setActive(previous => previous === id ? null : previous), [])

    useEffect(() => {
        setActive(null)
    }, [result])

    return (
        <ul className="correlation-points">
            {points.map(point => (
                <CorrelationPoint
                    key={point.id}
                    point={point}
                    open={active === point.id}
                    onOpen={setActive}
                    onClose={close}
                />
            ))}
        </ul>
    )
}

export default function CorrelationSection() {
    const { series = [], timespan, selectedRange } = useAppState()
    const [a, b] = series
    const headingId = useId()
    const result = useMemo(() => analyzePair({ series: [a, b], timespan, selectedRange }), [
        a?.id, a?.symbol, a?.assetClass, a?.data, a?.status,
        b?.id, b?.symbol, b?.assetClass, b?.data, b?.status,
        timespan, selectedRange?.start, selectedRange?.end
    ])
    if (!a?.symbol || !b?.symbol) return null

    const messages = {
        unsupported: 'Correlation currently supports two equities; select stocks in both slots.',
        loading: 'Waiting for both stocks’ history…',
        error: 'Stock history is unavailable. Search again to retry.',
        'invalid-options': 'Correlation settings are invalid.',
        insufficient: `Not enough meaningful moves in this range; widen it to include at least ${result.options.minSamples} observations.`
    }

    return (
        <section className="correlation-section" aria-labelledby={headingId} aria-busy={result.status === 'loading'}>
            <h2 id={headingId} className="correlation-heading">Correlation in this time window</h2>
            {result.status === 'ready'
                ? <CorrelationResults result={result} />
                : <p className="correlation-status" role="status">{messages[result.status]}</p>}
            <p className="correlation-caveat">
                Historical observations, not forecasts; windows may overlap.
            </p>
            {result.status === 'ready' && (
                <p className="correlation-caveat">
                    Continuous bars only; source prices may contain unadjusted splits.
                </p>
            )}
        </section>
    )
}
