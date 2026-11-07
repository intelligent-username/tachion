import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { App } from '../main'

vi.mock('react-dom/client', () => ({
  default: { createRoot: vi.fn(() => ({ render: vi.fn() })) },
  createRoot: vi.fn(() => ({ render: vi.fn() })),
}))

vi.mock('../components/graph', () => ({
  default: () => <div data-testid="graph" />,
}))

describe('App', () => {
  it('renders the app shell without crashing', () => {
    // jsdom has no ResizeObserver; the selector observes the header layout.
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    render(<App />)
    expect(screen.getByText('Tachion')).toBeTruthy()
    vi.unstubAllGlobals()
  })
})
