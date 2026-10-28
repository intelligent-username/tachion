// Sidebar series chips - one chip per chart slot, in axis order
import { useState } from 'react'
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

function SeriesChip({
    slot,
    index,
    total,
    isFocused,
    dragActive,
    isDragSource,
    isDropTarget,
    onFocus,
    onRemove,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd,
    onMove
}) {
    const colors = resolveSeriesColors(index, total)
    const symbol = slot.symbol || ''
    const axisLabel = index === 0 ? 'left axis' : 'right axis'
    const name = symbol || 'Empty slot'
    const canDrag = Boolean(symbol)

    const handleKeyDown = (event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onFocus?.(slot.id)
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

    const handleDragOver = (event) => {
        if (!canDrag || !dragActive) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        onDragOver?.(slot.id)
    }

    const handleDrop = (event) => {
        if (!canDrag) return
        event.preventDefault()
        const sourceId = event.dataTransfer.getData('text/plain')
        if (sourceId && sourceId !== slot.id) onDrop?.(sourceId, slot.id)
        onDragEnd?.()
    }

    return (
        <div
            className={`series-chip${isFocused ? ' is-focused' : ''}${isDragSource ? ' is-dragging' : ''}${isDropTarget ? ' is-drop-target' : ''}`}
            role="button"
            tabIndex={0}
            draggable={canDrag}
            aria-pressed={isFocused}
            aria-keyshortcuts={canDrag && total > 1 ? 'Alt+ArrowLeft Alt+ArrowRight' : undefined}
            aria-label={`${isFocused ? 'Editing' : 'Edit'} ${name} (${axisLabel})`}
            onClick={() => onFocus?.(slot.id)}
            onKeyDown={handleKeyDown}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
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
    onReorder
}) {
    const [draggingId, setDraggingId] = useState(null)
    const [dropTargetId, setDropTargetId] = useState(null)
    const isMax = series.length >= maxSeries
    const addTitle = isMax ? `Maximum ${maxSeries} instruments` : 'Add instrument'

    const resetDrag = () => {
        setDraggingId(null)
        setDropTargetId(null)
    }

    const handleDragStart = (id) => {
        setDraggingId(id)
        setDropTargetId(null)
    }

    const handleDragOver = (id) => {
        setDropTargetId(id === draggingId ? null : id)
    }

    const handleDrop = (sourceId, targetId) => {
        const source = series.find(s => s.id === sourceId)
        const target = series.find(s => s.id === targetId)
        if (source?.symbol && target?.symbol) onReorder?.(sourceId, targetId)
        resetDrag()
    }

    const handleMove = (id, delta) => {
        const from = series.findIndex(s => s.id === id)
        const target = series[from + delta]
        if (!series[from]?.symbol || !target?.symbol) return
        onReorder?.(id, target.id)
    }

    return (
        <div
            className="series-chips"
            role="group"
            aria-label="Chart instruments. Drag to reorder, or press Alt plus arrow keys."
        >
            {series.map((slot, index) => (
                <SeriesChip
                    key={slot.id}
                    slot={slot}
                    index={index}
                    total={series.length}
                    isFocused={slot.id === focusedSeriesId}
                    dragActive={draggingId !== null}
                    isDragSource={slot.id === draggingId}
                    isDropTarget={slot.id === dropTargetId}
                    onFocus={onFocus}
                    onRemove={onRemove}
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
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
