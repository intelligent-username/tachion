import { BOLLINGER_CFG } from './constants.js'

/** Compute aligned population-standard-deviation bands from consecutive valid closes.
 * @param {Array<{close:number}>} bars
 * @param {typeof BOLLINGER_CFG} [params]
 * @returns {{middle:(number|null)[],upper:(number|null)[],lower:(number|null)[],percentB:(number|null)[],bandwidth:(number|null)[],meta:{warmup:number}}}
 */
export function computeBollinger(bars, params = BOLLINGER_CFG) {
    const { window, k } = params
    const result = Object.fromEntries(['middle', 'upper', 'lower', 'percentB', 'bandwidth']
        .map(key => [key, Array(bars.length).fill(null)]))
    result.meta = { warmup: window }
    let sum = 0
    let sumSq = 0
    let invalid = 0
    for (let i = 0; i < bars.length; i++) {
        const close = bars[i]?.close
        if (Number.isFinite(close)) { sum += close; sumSq += close * close } else invalid++
        if (i >= window) {
            const old = bars[i - window]?.close
            if (Number.isFinite(old)) { sum -= old; sumSq -= old * old } else invalid--
        }
        if (i < window - 1 || invalid) continue
        const mean = sum / window
        const sd = Math.sqrt(Math.max(0, sumSq / window - mean * mean))
        const upper = mean + k * sd
        const lower = mean - k * sd
        if (![mean, upper, lower].every(Number.isFinite)) continue
        result.middle[i] = mean
        result.upper[i] = upper
        result.lower[i] = lower
        result.percentB[i] = upper === lower ? 0.5 : (close - lower) / (upper - lower)
        result.bandwidth[i] = mean === 0 ? null : (upper - lower) / mean
    }
    return result
}
