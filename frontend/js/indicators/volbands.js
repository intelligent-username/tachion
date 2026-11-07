import { VOLBANDS_CFG } from './constants.js'
import { createEwmaVol, SortedWindow, YangZhangRoller } from './stats.js'

const SIGMA_FLOOR = 1e-8
const SEED_RETURNS = 20
// A two-sigma scale approximation, NOT an empirical coverage guarantee. Keep
// these early estimates out of the mature standardized-residual window.
const PROVISIONAL_QUANTILES = Object.freeze([-2, 2])
const OUTPUT_KEYS = ['basis', 'upper', 'lower', 'quantiles', 'provisional']

function validBar(bar) {
    return bar && [bar.open, bar.high, bar.low, bar.close].every(value => Number.isFinite(value) && value > 0)
}

function initialVariance(bar) {
    const range = Math.log(bar.high) - Math.log(bar.low)
    const intraday = Math.log(bar.close) - Math.log(bar.open)
    return range * range / (4 * Math.LN2) + intraday * intraday
}

function interval(basis, variance, quantiles, horizon = 1) {
    const sigma = Math.max(Math.sqrt(variance), SIGMA_FLOOR) * Math.sqrt(horizon)
    const lower = basis * Math.exp(quantiles[0] * sigma)
    const upper = basis * Math.exp(quantiles[1] * sigma)
    return Number.isFinite(lower) && Number.isFinite(upper) && lower > 0 && upper >= lower
        ? { lower, upper } : null
}

function quantilesFor(window, coverage) {
    const tail = (1 - coverage) / 2
    return [window.quantile(tail), window.quantile(1 - tail)]
}

function fanFor(summary, params) {
    if (!summary || summary.stats.usableBars < 2 || !Number.isFinite(summary.variance)) return null
    const fan = { upper: [], lower: [], bars: params.fanBars }
    for (let i = 1; i <= params.fanBars; i++) {
        const band = interval(summary.close, summary.variance, summary.quantiles, i)
        if (!band) return null
        fan.lower.push(band.lower)
        fan.upper.push(band.upper)
    }
    return fan
}

/** Causal rolling state shared by batch calculations and transactional appends. */
export class VolBandsCalculator {
    constructor(ctx, params = VOLBANDS_CFG) {
        if (!Number.isInteger(params.quantileWindow) || params.quantileWindow < 1
            || !Number.isInteger(params.yangZhangWindow) || params.yangZhangWindow < 2
            || !(params.coverage > 0 && params.coverage < 1)
            || !Number.isInteger(params.fanBars) || params.fanBars < 0) {
            throw new RangeError('Invalid volatility-band parameters')
        }
        this.ctx = ctx
        this.params = params
        this.output = Object.fromEntries(OUTPUT_KEYS.map(key => [key, []]))
        this.summaries = []
        this.observations = new SortedWindow(params.quantileWindow)
        this.coverage = new SortedWindow(params.quantileWindow)
        this.coverageHits = 0
        this.estimator = params.estimatorByClass[ctx.assetClass] === 'yangZhang'
            ? new YangZhangRoller(params.yangZhangWindow)
            : createEwmaVol(params.ewmaLambda[ctx.assetClass] ?? params.ewmaLambda.equities)
        this.previousClose = null
        this.initialVariance = null
        this.usableBars = 0
    }

    get effectiveVariance() {
        return this.estimator.variance ?? this.estimator.provisionalVariance ?? this.initialVariance
    }

    push(bar) {
        const index = this.output.basis.length
        for (const key of OUTPUT_KEYS) this.output[key].push(key === 'provisional' ? true : null)
        if (!validBar(bar)) {
            this.summaries.push(this.summaries[index - 1] ?? null)
            return
        }
        this.usableBars++
        if (this.previousClose !== null) this.processBar(bar, index)
        else this.initialVariance = initialVariance(bar)
        this.previousClose = bar.close
        this.summaries.push(this.snapshot(index))
    }

    processBar(bar, index) {
        // Emit against information available BEFORE this bar updates either
        // volatility or residuals. The first valid OHLC supplies the initial scale.
        const variance = this.effectiveVariance
        const isMature = this.estimator.variance !== null && this.observations.size === this.params.quantileWindow
        const quantiles = isMature ? quantilesFor(this.observations, this.params.coverage) : PROVISIONAL_QUANTILES
        const band = Number.isFinite(variance) ? interval(this.previousClose, variance, quantiles) : null
        if (band) {
            this.output.basis[index] = this.previousClose
            this.output.lower[index] = band.lower
            this.output.upper[index] = band.upper
            this.output.quantiles[index] = quantiles
            this.output.provisional[index] = !isMature
            if (isMature) {
                if (this.coverage.size === this.coverage.capacity) this.coverageHits -= this.coverage.removeOldest()
                const hit = bar.close >= band.lower && bar.close <= band.upper ? 1 : 0
                this.coverage.push(hit)
                this.coverageHits += hit
            }
        }
        const change = Math.log(bar.close) - Math.log(this.previousClose)
        const matureVariance = this.estimator.variance
        if (matureVariance !== null && Number.isFinite(matureVariance)) {
            this.observations.push(change / Math.max(Math.sqrt(matureVariance), SIGMA_FLOOR))
        }
        if (this.estimator instanceof YangZhangRoller) this.estimator.push(bar, this.previousClose)
        else this.estimator.push(change)
    }

    snapshot(index) {
        const variance = this.effectiveVariance
        const isMature = this.estimator.variance !== null && this.observations.size === this.params.quantileWindow
        const isProvisional = !isMature || this.output.provisional[index]
        return {
            close: this.previousClose, variance,
            quantiles: isMature ? quantilesFor(this.observations, this.params.coverage) : PROVISIONAL_QUANTILES,
            stats: {
                realizedCoverage: this.coverage.size ? this.coverageHits / this.coverage.size : null,
                targetCoverage: this.params.coverage, calibratedBars: this.observations.size,
                coverageBars: this.coverage.size, usableBars: this.usableBars, isProvisional,
                status: this.usableBars >= 2 && Number.isFinite(variance) && variance <= SIGMA_FLOOR ** 2
                    ? 'degenerate' : isMature ? 'ready' : 'calibrating',
            },
        }
    }

    resultAt(index = this.summaries.length - 1) {
        const summary = this.summaries[index]
        const stats = summary?.stats ?? { realizedCoverage: null, targetCoverage: this.params.coverage,
            calibratedBars: 0, coverageBars: 0, usableBars: 0, isProvisional: true, status: 'calibrating' }
        const seed = this.estimator instanceof YangZhangRoller ? this.params.yangZhangWindow : SEED_RETURNS
        // Count bars to the first mature historical interval, not to the first
        // full residual window: that window completes one observation earlier.
        return { ...this.output, fan: fanFor(summary, this.params), stats: { ...stats },
            meta: { minimumBars: 2, warmup: seed + this.params.quantileWindow + 2 } }
    }

    clone() {
        const copy = new VolBandsCalculator(this.ctx, this.params)
        copy.output = Object.fromEntries(OUTPUT_KEYS.map(key => [key, this.output[key].slice()]))
        copy.summaries = this.summaries.slice()
        copy.observations = this.observations.clone()
        copy.coverage = this.coverage.clone()
        copy.coverageHits = this.coverageHits
        copy.estimator = this.estimator.clone()
        copy.previousClose = this.previousClose
        copy.initialVariance = this.initialVariance
        copy.usableBars = this.usableBars
        return copy
    }

    trimPrefix(count) {
        for (const key of OUTPUT_KEYS) this.output[key] = this.output[key].slice(count)
        this.summaries = this.summaries.slice(count)
    }
}

/** Progressive causal intervals; mature empirical math is unchanged.
 * `provisional[i]` labels each historical interval. `stats` and `fan` describe
 * the requested endpoint; coverage includes only emitted mature intervals.
 * @param {Array<{open:number,high:number,low:number,close:number}>} bars
 * @param {{assetClass:string}} ctx
 * @param {typeof VOLBANDS_CFG} [params]
 * @returns {{basis:(number|null)[],upper:(number|null)[],lower:(number|null)[],quantiles:([number,number]|null)[],provisional:boolean[],fan:object|null,stats:{realizedCoverage:number|null,targetCoverage:number,calibratedBars:number,coverageBars:number,usableBars:number,isProvisional:boolean,status:string},meta:{minimumBars:number,warmup:number}}}
 */
export function computeVolBands(bars, ctx, params = VOLBANDS_CFG) {
    const calculator = new VolBandsCalculator(ctx, params)
    for (const bar of bars) calculator.push(bar)
    return calculator.resultAt()
}
