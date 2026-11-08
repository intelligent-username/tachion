import { useEffect, useMemo, useRef, useState } from 'react'
import { getForexSuggestions } from '../js/symbol-utils'

function CurrencyField({ field, label, placeholder, value, pair, error, disabled, directory, open, setOpen, onChange, onBlur, onSearch, inputRefs }) {
    const id = `forex-${field}`
    const listId = `${id}-suggestions`
    const other = field === 'from' ? pair.to : pair.from
    const suggestions = useMemo(() => getForexSuggestions(directory, other, value), [directory, other, value])
    const [activeCode, setActiveCode] = useState(null)
    const composing = useRef(false)
    const pointerStart = useRef(null)
    const listRef = useRef(null)
    const expanded = open && !disabled && suggestions.length > 0
    const activeOption = expanded && suggestions.includes(activeCode) ? activeCode : null

    useEffect(() => { if (!open) setActiveCode(null) }, [open])
    useEffect(() => { setActiveCode(null) }, [suggestions])
    useEffect(() => {
        if (activeOption) listRef.current?.querySelector(`[id="${id}-${activeOption}"]`)?.scrollIntoView?.({ block: 'nearest' })
    }, [activeOption, id])

    const select = (code, search = false) => {
        const next = { ...pair, [field]: code }
        onChange(next)
        setOpen(null)
        setActiveCode(null)
        if (search) onSearch(next)
    }

    const handleKeyDown = event => {
        if (disabled || composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(field)
            if (suggestions.length) {
                const index = expanded ? suggestions.indexOf(activeCode) : -1
                const nextIndex = event.key === 'ArrowDown'
                    ? (index + 1) % suggestions.length
                    : (index < 0 ? suggestions.length - 1 : (index - 1 + suggestions.length) % suggestions.length)
                setActiveCode(suggestions[nextIndex])
            }
        } else if (event.key === 'Escape') {
            event.preventDefault()
            setOpen(null)
            setActiveCode(null)
        } else if (event.key === 'Enter') {
            event.preventDefault()
            event.stopPropagation()
            if (activeOption) select(activeOption, true)
            else {
                setOpen(null)
                onSearch(pair)
            }
        }
    }

    return (
        <div className="forex-currency-field">
            <fieldset className="forex-input-shell" data-invalid={Boolean(error)}>
                <legend><label htmlFor={id}>{label}</label></legend>
                <input
                    ref={element => { if (inputRefs) inputRefs.current[field] = element }}
                    id={id} name={id} type="text" inputMode="text"
                    role="combobox" aria-autocomplete="list" aria-expanded={Boolean(expanded)}
                    aria-controls={expanded ? listId : undefined}
                    aria-activedescendant={activeOption ? `${id}-${activeOption}` : undefined}
                    aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined}
                    autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellCheck={false}
                    placeholder={placeholder} value={value} disabled={disabled}
                    onFocus={() => setOpen(field)}
                    onChange={event => { onChange({ ...pair, [field]: event.target.value }); setOpen(field) }}
                    onBlur={() => { setOpen(null); onBlur(field) }}
                    onKeyDown={handleKeyDown}
                    onCompositionStart={() => { composing.current = true }}
                    onCompositionEnd={() => { composing.current = false }}
                />
            </fieldset>
            {expanded && (
                <ul ref={listRef} id={listId} role="listbox" aria-label={`${label} currencies`} className="forex-suggestions">
                    {suggestions.map(code => (
                        <li key={code} id={`${id}-${code}`} role="option" aria-selected={activeOption === code}
                            onPointerDown={event => {
                                event.preventDefault()
                                pointerStart.current = { x: event.clientX, y: event.clientY }
                            }}
                            onPointerUp={event => {
                                const start = pointerStart.current
                                pointerStart.current = null
                                if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 8) select(code)
                            }}
                            onPointerCancel={() => { pointerStart.current = null }}
                            onClick={event => { if (event.detail === 0) select(code) }}>
                            {code}
                        </li>
                    ))}
                </ul>
            )}
            {error && <div id={`${id}-error`} className="forex-field-error" aria-live="polite">{error}</div>}
        </div>
    )
}

export default function ForexPairInput({ value, errors, disabled, swapDisabled = disabled, directory, status, onChange, onBlur, onSearch, onSwap, onRetry, inputRefs }) {
    const [openField, setOpenField] = useState(null)
    const wrapperRef = useRef(null)
    const common = { pair: value, disabled, directory, onChange, onBlur, onSearch, inputRefs }
    const warning = status === 'error' || status === 'stale' || status === 'waiting'

    useEffect(() => {
        if (!openField) return
        const closeOutside = event => {
            if (!wrapperRef.current?.contains(event.target)) setOpenField(null)
        }
        document.addEventListener('pointerdown', closeOutside)
        return () => document.removeEventListener('pointerdown', closeOutside)
    }, [openField])

    return (
        <div ref={wrapperRef} className="forex-pair-control">
            <div className="forex-pair-row">
                <CurrencyField {...common} field="from" label="From" placeholder="EUR" value={value.from}
                    error={errors.from} open={openField === 'from'} setOpen={setOpenField} />
                <button type="button" className="forex-icon-button" aria-label="Swap currencies and search"
                    title="Swap currencies and search" disabled={swapDisabled}
                    onClick={() => { setOpenField(null); onSwap() }}>
                    <span aria-hidden="true">⇄</span>
                </button>
                <CurrencyField {...common} field="to" label="To" placeholder="USD" value={value.to}
                    error={errors.to} open={openField === 'to'} setOpen={setOpenField} />
                <button type="button" className="forex-icon-button forex-search-button" aria-label="Search"
                    title="Search" disabled={disabled} onClick={() => { setOpenField(null); onSearch() }}>
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                </button>
            </div>
            <div className="forex-directory-status" role="status">
                {status === 'loading' && 'Loading currency suggestions…'}
                {status === 'stale' && 'Using the last currency list. You can still enter codes.'}
                {status === 'error' && 'Currency suggestions are unavailable. You can still enter codes.'}
                {status === 'waiting' && 'Currency suggestions will retry shortly. You can still enter codes.'}
                {warning && <button type="button" onClick={onRetry} disabled={status === 'waiting'} className="forex-retry-button">Retry</button>}
            </div>
        </div>
    )
}
