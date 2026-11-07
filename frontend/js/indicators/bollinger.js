import { BOLLINGER_CFG } from './constants.js'

const OUTPUT_KEYS = ['middle', 'upper', 'lower', 'percentB', 'provisional']

/** Retained rolling state; batch and cached append use exactly the same math. */
export class BollingerCalculator {
    constructor(params = BOLLINGER_CFG) {
        if (!Number.isInteger(params.window) || params.window < 2 || !Number.isFinite(params.k) || params.k < 0) {
            throw new RangeError('Invalid Bollinger window or multiplier')
        }
        this.params = params
        this.output = Object.fromEntries(OUTPUT_KEYS.map(key => [key, []]))
        this.summaries = []
        this.queue = []
        this.sum = 0
        this.sumSq = 0
        this.invalid = 0
        this.usableBars = 0
    }

    push(bar) {
        const close = bar?.close
        this.queue.push(close)
        if (Number.isFinite(close)) {
            this.sum += close
            this.sumSq += close * close
            this.usableBars++
        } else this.invalid++
        if (this.queue.length > this.params.window) {
            const old = this.queue.shift()
            if (Number.isFinite(old)) { this.sum -= old; this.sumSq -= old * old } else this.invalid--
        }
        for (const key of OUTPUT_KEYS) this.output[key].push(key === 'provisional' ? true : null)
        const span = this.queue.length
        this.summaries.push({ usableBars: this.usableBars, windowBars: span - this.invalid,
            isProvisional: span < this.params.window || this.invalid > 0 })
        if (span < 1 || this.invalid) return
        const mean = this.sum / span
        const deviation = Math.sqrt(Math.max(0, this.sumSq / span - mean * mean))
        const upper = mean + this.params.k * deviation
        const lower = mean - this.params.k * deviation
        if (![mean, upper, lower].every(Number.isFinite)) return
        const index = this.output.middle.length - 1
        this.output.middle[index] = mean
        this.output.upper[index] = upper
        this.output.lower[index] = lower
        this.output.percentB[index] = upper === lower ? 0.5 : (close - lower) / (upper - lower)
        this.output.provisional[index] = this.summaries[index].isProvisional
    }

    resultAt(index = this.summaries.length - 1) {
        const stats = this.summaries[index] ?? { usableBars: 0, windowBars: 0, isProvisional: true }
        return { ...this.output, stats: { ...stats }, meta: { minimumBars: 1, warmup: this.params.window } }
    }

    clone() {
        const copy = new BollingerCalculator(this.params)
        copy.output = Object.fromEntries(OUTPUT_KEYS.map(key => [key, this.output[key].slice()]))
        copy.summaries = this.summaries.slice()
        copy.queue = this.queue.slice()
        copy.sum = this.sum
        copy.sumSq = this.sumSq
        copy.invalid = this.invalid
        copy.usableBars = this.usableBars
        return copy
    }

    trimPrefix(count) {
        for (const key of OUTPUT_KEYS) this.output[key] = this.output[key].slice(count)
        this.summaries = this.summaries.slice(count)
    }
}

/** Population-SD bands: progressive from one close, exact fixed window when mature.
 * @param {Array<{close:number}>} bars
 * @param {typeof BOLLINGER_CFG} [params]
 * @returns {{middle:(number|null)[],upper:(number|null)[],lower:(number|null)[],percentB:(number|null)[],provisional:boolean[],stats:{usableBars:number,windowBars:number,isProvisional:boolean},meta:{minimumBars:number,warmup:number}}}
 */
export function computeBollinger(bars, params = BOLLINGER_CFG) {
    const calculator = new BollingerCalculator(params)
    for (const bar of bars) calculator.push(bar)
    return calculator.resultAt()
}
