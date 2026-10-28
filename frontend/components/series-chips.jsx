// Sidebar series chips - one chip per chart slot, in axis order
import { useRef, useState } from 'react'
import { resolveSeriesColors } from '../js/visualizer/visualizer-colors'

function errorMessage(error) {
    if (!error) return ''
    return typeof error === 'string' ? error : error.message || String(error)
}

function ChipStatus({ status, error }) {
    const message = errorMessage(error)
    if (status !== 'loading' && !message) return null
    return (
        <>
            {status === 'loading' && (
                <span className="series-chip-status is-loading" title="Loading">…</span>
            )}
            {message && (
                <span className="series-chip-status is-error" title={message}>!</span>
            )}
        </>
    )
}

function hiddenLabel(mainHidden) {
    return mainHidden ? 'main graph hidden' : 'main graph visible'
}

function SeriesChip({
    slot,
    index,
    total,
    isFocused,
    isDragSource,
    isDropTarget,
    onActivate,
    onRemove,
    onDragStart,
    onDragEnd,
    onMove
}) {
    const colors = resolveSeriesColors(index, total)
    const symbol = slot.symbol || ''
    const axisLabel = index === 0 ? 'left axis' : 'right axis'
    const name = symbol || 'Empty slot'
    const canDrag = Boolean(symbol)
    const mainHidden = (slot.hiddenLevel ?? 0) >= 1

    const handleKeyDown = (event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onActivate?.(slot.id)
            return
        }
        if (!canDrag || !event.altKey) return
        if (event.key === 'ArrowLeft' && index > 0) {
            event.preventDefault()
            onMove?.(slot.id, -1)
        } else if (event.key === 'ArrowRight' && index < total - 1) {
            event.preventDefault()
            onMove?.(slot.id, 1)
        }
    }

    const handleDragStart = (event) => {
        if (!canDrag) {
            event.preventDefault()
            return
        }
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', slot.id)
        onDragStart?.(slot.id)
    }

    return (
        <div
            className={`series-chip${isFocused ? ' is-focused' : ''}${isDragSource ? ' is-dragging' : ''}${isDropTarget ? ' is-drop-target' : ''}`}
            role="button"
            tabIndex={0}
            draggable={canDrag}
            data-series-id={slot.id}
            data-hidden-level={mainHidden ? 1 : 0}
            aria-pressed={isFocused}
            aria-keyshortcuts={canDrag && total > 1 ? 'Alt+ArrowLeft Alt+ArrowRight' : undefined}
            aria-label={`${isFocused ? 'Editing' : 'Edit'} ${name} (${axisLabel}); ${hiddenLabel(mainHidden)}`}
            onClick={() => onActivate?.(slot.id)}
            onKeyDown={handleKeyDown}
            onDragStart={handleDragStart}
            onDragEnd={onDragEnd}
        >
            <span
                className="series-chip-swatch"
                style={{ background: colors.line }}
                aria-hidden="true"
            />
            <span className="series-chip-slot" aria-hidden="true">{index === 0 ? 'L' : 'R'}</span>
            <span
                className={`series-chip-symbol${symbol ? '' : ' is-empty'}`}
                title={symbol || undefined}
            >
                {symbol || 'Add symbol'}
            </span>
            <ChipStatus status={slot.status} error={slot.error} />
            <button
                type="button"
                className="series-chip-remove"
                onClick={(event) => {
                    event.stopPropagation()
                    onRemove?.(slot.id)
                }}
                aria-label={`Remove ${symbol || 'empty slot'}`}
                title="Remove"
            >
                ×
            </button>
        </div>
    )
}

export default function SeriesChips({
    series = [],
    focusedSeriesId = null,
    maxSeries = 2,
    onFocus,
    onRemove,
    onAdd,
    onReorder,
    onCycle
}) {
    const [draggingId, setDraggingId] = useState(null)
    const [dropTargetId, setDropTargetId] = useState(null)
    const dragIdRef = useRef(null)
    const lastSwapTargetRef = useRef(null)
    const isMax = series.length >= maxSeries
    const addTitle = isMax ? `Maximum ${maxSeries} instruments` : 'Add instrument'

    const resetDrag = () => {
        dragIdRef.current = null
        lastSwapTargetRef.current = null
        setDraggingId(null)
        setDropTargetId(null)
    }

    const handleDragStart = (id) => {
        dragIdRef.current = id
        lastSwapTargetRef.current = null
        setDraggingId(id)
        setDropTargetId(null)
    }

    // Swap live while dragging over another populated pill. The ref prevents
    // repeated dragover events from toggling the order back and forth.
    const handleDragOver = (event) => {
        const sourceId = dragIdRef.current
        if (!sourceId) return
        event.preventDefault()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'

        const targetId = event.target.closest?.('.series-chip')?.dataset.seriesId
        if (!targetId || targetId === sourceId) {
            lastSwapTargetRef.current = null
            setDropTargetId(null)
            return
        }

        const source = series.find(s => s.id === sourceId)
        const target = series.find(s => s.id === targetId)
        if (!source?.symbol || !target?.symbol) {
            setDropTargetId(null)
            return
        }

        setDropTargetId(targetId)
        if (lastSwapTargetRef.current === targetId) return
        lastSwapTargetRef.current = targetId
        onReorder?.(sourceId, targetId)
    }

    const handleDrop = (event) => {
        if (!dragIdRef.current) return
        event.preventDefault()
        resetDrag()
    }

    const handleMove = (id, delta) => {
        const from = series.findIndex(s => s.id === id)
        const target = series[from + delta]
        if (!series[from]?.symbol || !target?.symbol) return
        onReorder?.(id, target.id)
    }

    const handleActivate = (id) => {
        onFocus?.(id)
        if (series.find(s => s.id === id)?.symbol) onCycle?.(id)
    }

    return (
        <div
            className="series-chips"
            role="group"
            aria-label="Chart instruments. Drag to reorder, press Alt plus arrow keys, or click a pill to cycle hidden layers."
            onDragOver={handleDragOver}
            onDragEnter={handleDragOver}
            onDrop={handleDrop}
        >
            {series.map((slot, index) => (
                <SeriesChip
                    key={slot.id}
                    slot={slot}
                    index={index}
                    total={series.length}
                    isFocused={slot.id === focusedSeriesId}
                    isDragSource={slot.id === draggingId}
                    isDropTarget={slot.id === dropTargetId}
                    onActivate={handleActivate}
                    onRemove={onRemove}
                    onDragStart={handleDragStart}
                    onDragEnd={resetDrag}
                    onMove={handleMove}
                />
            ))}
            <button
                type="button"
                className="series-add-btn"
                onClick={() => onAdd?.()}
                disabled={isMax}
                title={addTitle}
                aria-label={addTitle}
            >
                +
            </button>
        </div>
    )
}
