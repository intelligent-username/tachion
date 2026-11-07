// Header control that clears the drag-selected zoom range.
import { useAppState } from '../js/state'

export default function ResetZoom() {
    const { selectedRange, clearSelectedRange } = useAppState()
    if (!selectedRange) return null
    return (
        <button
            type="button"
            className="chart-reset-zoom"
            onClick={clearSelectedRange}
            aria-label="Reset chart zoom"
        >
            Reset zoom
        </button>
    )
}
