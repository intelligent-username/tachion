import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchForexCurrencies } from './api'

const RETRY_DELAY_MS = 60_000

export default function useForexDirectory(active) {
    const cache = useRef({ directory: null, nextAt: 0 })
    const inFlight = useRef(false)
    const [result, setResult] = useState({ directory: null, status: 'idle' })
    const [attempt, setAttempt] = useState(0)

    useEffect(() => {
        if (!active) return
        let disposed = false
        let timer
        let controller

        const schedule = () => {
            timer = setTimeout(load, Math.max(1, cache.current.nextAt - Date.now()))
        }
        const load = async () => {
            if (disposed) return
            if (Date.now() < cache.current.nextAt) {
                schedule()
                return
            }
            controller = new AbortController()
            inFlight.current = true
            setResult(previous => ({ ...previous, status: 'loading' }))
            try {
                const directory = await fetchForexCurrencies({ signal: controller.signal })
                if (disposed) return
                cache.current = { directory, nextAt: Date.now() + directory.refreshAfterSeconds * 1000 }
                setResult({ directory, status: directory.stale ? 'stale' : 'ready' })
            } catch (error) {
                if (disposed) return
                cache.current.nextAt = Date.now() + RETRY_DELAY_MS
                setResult({ directory: cache.current.directory, status: 'error' })
            } finally {
                if (!disposed) {
                    inFlight.current = false
                    schedule()
                }
            }
        }

        load()
        return () => {
            disposed = true
            clearTimeout(timer)
            controller?.abort()
            inFlight.current = false
        }
    }, [active, attempt])

    const retry = useCallback(() => {
        if (inFlight.current) return
        if (Date.now() >= cache.current.nextAt) setAttempt(value => value + 1)
        else setResult(previous => ({ ...previous, status: 'waiting' }))
    }, [])

    return { ...result, retry }
}
