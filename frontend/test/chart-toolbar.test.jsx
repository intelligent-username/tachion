import { render, fireEvent } from '@testing-library/react'
import { expect, it, vi, beforeEach, afterEach } from 'vitest'
import ChartToolbar from '../components/chart-toolbar'
import { StateProvider, useAppState } from '../js/state'

function TestWrapper() {
    const state = useAppState()
    return <ChartToolbar />
}

function renderWithProvider() {
    return render(
        <StateProvider>
            <TestWrapper />
        </StateProvider>
    )
}

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})

afterEach(() => {
    vi.unstubAllGlobals()
})

it('defaults to cursor mode', () => {
    const { container } = renderWithProvider()
    expect(container.querySelector('button[aria-label="Regular cursor"]').getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('button[aria-label="Crosshair cursor"]').getAttribute('aria-pressed')).toBe('false')
})

it('toggles to crosshair mode on click', () => {
    const { container } = renderWithProvider()
    const crosshairBtn = container.querySelector('button[aria-label="Crosshair cursor"]')
    fireEvent.click(crosshairBtn)
    expect(crosshairBtn.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('button[aria-label="Regular cursor"]').getAttribute('aria-pressed')).toBe('false')
})

it('toggles back to cursor mode on click', () => {
    const { container } = renderWithProvider()
    const crosshairBtn = container.querySelector('button[aria-label="Crosshair cursor"]')
    const cursorBtn = container.querySelector('button[aria-label="Regular cursor"]')
    fireEvent.click(crosshairBtn)
    fireEvent.click(cursorBtn)
    expect(cursorBtn.getAttribute('aria-pressed')).toBe('true')
    expect(crosshairBtn.getAttribute('aria-pressed')).toBe('false')
})



it('cursor and chart-mode toggles are adjacent', () => {
    const { container } = renderWithProvider()
    const cursorGroup = container.querySelector('[aria-label="Chart cursor mode"]')
    const chartGroup = container.querySelector('[aria-label="Chart visualization mode"]')
    expect(cursorGroup).toBeTruthy()
    expect(chartGroup).toBeTruthy()
    expect(cursorGroup.parentElement).toBe(chartGroup.parentElement)
})

it('remounting provider resets cursor mode without persistence', () => {
    const { unmount, container } = renderWithProvider()
    const crosshairBtn = container.querySelector('button[aria-label="Crosshair cursor"]')
    fireEvent.click(crosshairBtn)
    expect(crosshairBtn.getAttribute('aria-pressed')).toBe('true')

    unmount()
    const { container: newContainer } = renderWithProvider()
    expect(newContainer.querySelector('button[aria-label="Regular cursor"]').getAttribute('aria-pressed')).toBe('true')
    expect(newContainer.querySelector('button[aria-label="Crosshair cursor"]').getAttribute('aria-pressed')).toBe('false')
})