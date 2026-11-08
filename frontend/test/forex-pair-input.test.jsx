import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ForexPairInput from '../components/forex-pair-input'

afterEach(cleanup)
const directory = {
    currencies: ['EUR', 'GBP', 'JPY', 'USD'],
    pairs: [{ base: 'EUR', quote: 'USD' }, { base: 'GBP', quote: 'USD' }, { base: 'USD', quote: 'JPY' }],
}

function setup(extra = {}) {
    const onSearch = vi.fn(), onSwap = vi.fn(), onRetry = vi.fn(), onBlur = vi.fn()
    function Harness() {
        const [value, setValue] = useState({ from: '', to: 'USD' })
        return <ForexPairInput value={value} onChange={setValue} errors={{}} disabled={false}
            directory={directory} status="ready" onBlur={onBlur} onSearch={onSearch} onSwap={onSwap} onRetry={onRetry} {...extra} />
    }
    render(<Harness />)
    return { from: screen.getByRole('combobox', { name: 'From' }), to: screen.getByRole('combobox', { name: 'To' }), onSearch, onSwap, onRetry, onBlur }
}

describe('currency comboboxes', () => {
    it('has distinct labels, pair-aware options and one open list', () => {
        const { from, to } = setup()
        expect(from.closest('fieldset').querySelector('legend label').htmlFor).toBe(from.id)
        expect(to.closest('fieldset').querySelector('legend label').htmlFor).toBe(to.id)
        fireEvent.focus(from)
        expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['EUR', 'GBP', 'JPY'])
        expect(from.getAttribute('aria-expanded')).toBe('true')
        expect(from.hasAttribute('aria-activedescendant')).toBe(false)
        fireEvent.focus(to)
        expect(from.getAttribute('aria-expanded')).toBe('false')
        expect(screen.getAllByRole('listbox')).toHaveLength(1)
    })

    it('selects highlighted code and submits the new pair exactly once', () => {
        const { from, onSearch } = setup()
        fireEvent.focus(from)
        fireEvent.keyDown(from, { key: 'ArrowDown' })
        expect(from.getAttribute('aria-activedescendant')).toBe('forex-from-EUR')
        fireEvent.keyDown(from, { key: 'Enter' })
        expect(onSearch).toHaveBeenCalledExactlyOnceWith({ from: 'EUR', to: 'USD' })
        expect(from.value).toBe('EUR')
        expect(screen.queryByRole('listbox')).toBeNull()
    })

    it('plain Enter submits once and IME Enter does not submit', () => {
        const { from, onSearch } = setup()
        fireEvent.change(from, { target: { value: 'eur' } })
        fireEvent.compositionStart(from)
        fireEvent.keyDown(from, { key: 'Enter' })
        expect(onSearch).not.toHaveBeenCalled()
        fireEvent.compositionEnd(from)
        fireEvent.keyDown(from, { key: 'Enter' })
        expect(onSearch).toHaveBeenCalledExactlyOnceWith({ from: 'eur', to: 'USD' })
    })

    it('pointer selection fills without searching and blur delegates cleanup', () => {
        const { from, onSearch, onBlur } = setup()
        fireEvent.focus(from)
        const option = screen.getByRole('option', { name: 'GBP' })
        fireEvent.pointerDown(option, { clientX: 0, clientY: 0 })
        fireEvent.pointerUp(option, { clientX: 0, clientY: 0 })
        expect(from.value).toBe('GBP')
        expect(onSearch).not.toHaveBeenCalled()
        fireEvent.blur(from)
        expect(onBlur).toHaveBeenCalledWith('from')
    })

    it('Escape closes; filtering clears highlight; Tab is not trapped', () => {
        const { from, onSearch } = setup()
        fireEvent.focus(from)
        fireEvent.keyDown(from, { key: 'ArrowDown' })
        fireEvent.change(from, { target: { value: 'G' } })
        expect(from.hasAttribute('aria-activedescendant')).toBe(false)
        fireEvent.keyDown(from, { key: 'Escape' })
        expect(screen.queryByRole('listbox')).toBeNull()
        expect(from.value).toBe('G')
        expect(fireEvent.keyDown(from, { key: 'Tab' })).toBe(true)
        expect(onSearch).not.toHaveBeenCalled()
    })

    it('describes field errors and keeps manual entry enabled after directory failure', () => {
        const { from, onRetry } = setup({ status: 'error', directory: null, errors: { from: 'Enter a currency code.' } })
        expect(from.getAttribute('aria-invalid')).toBe('true')
        expect(document.getElementById(from.getAttribute('aria-describedby')).textContent).toBe('Enter a currency code.')
        expect(from.disabled).toBe(false)
        expect(screen.getByRole('status').textContent).toContain('You can still enter codes')
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
        expect(onRetry).toHaveBeenCalledOnce()
    })

    it('blocks actions while chart data is loading', () => {
        const { from, onSearch } = setup({ disabled: true })
        expect(from.disabled).toBe(true)
        expect(screen.getByRole('button', { name: 'Search' }).disabled).toBe(true)
        expect(screen.getByRole('button', { name: 'Swap currencies and search' }).disabled).toBe(true)
        fireEvent.keyDown(from, { key: 'Enter' })
        expect(onSearch).not.toHaveBeenCalled()
    })

    it('keeps swap usable independently of the loading controls', () => {
        const { onSwap } = setup({ disabled: true, swapDisabled: false })
        const swap = screen.getByRole('button', { name: 'Swap currencies and search' })
        expect(swap.disabled).toBe(false)
        fireEvent.click(swap)
        expect(onSwap).toHaveBeenCalledOnce()
    })

    it('reopens a closed list with arrow selection and closes on outside pointer interaction', () => {
        const { from } = setup()
        fireEvent.focus(from)
        fireEvent.keyDown(from, { key: 'Escape' })
        fireEvent.keyDown(from, { key: 'ArrowUp' })
        expect(from.getAttribute('aria-activedescendant')).toBe('forex-from-JPY')
        fireEvent.pointerDown(document.body)
        expect(screen.queryByRole('listbox')).toBeNull()
    })

    it('does not select a currency during a touch scroll gesture', () => {
        const { from, onSearch } = setup()
        fireEvent.focus(from)
        const option = screen.getByRole('option', { name: 'GBP' })
        fireEvent.pointerDown(option, { clientX: 0, clientY: 0 })
        fireEvent.pointerCancel(option)
        fireEvent.pointerUp(option, { clientX: 0, clientY: 40 })
        expect(from.value).toBe('')
        expect(onSearch).not.toHaveBeenCalled()
    })
})
