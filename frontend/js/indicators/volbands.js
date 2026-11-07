import { VOLBANDS_CFG } from './constants.js'
import { createEwmaVol, SortedWindow, YangZhangRoller } from './stats.js'

const SIGMA_FLOOR = 1e-8
const SEED_RETURNS = 20

function validBar(bar) {
    return bar && [bar.open, bar.high, bar.low, bar.close].every(value => Number.isFinite(value) && value > 0)
}

function interval(basis, variance, quantiles, horizon = 1) {
    const sigma = Math.max(Math.sqrt(variance), SIGMA_FLOOR) * Math.sqrt(horizon)
    const lower = basis * Math.exp(quantiles[0] * sigma)
    const upper = basis * Math.exp(quantiles[1] * sigma)
    return Number.isFinite(lower) && Number.isFinite(upper) ? { lower, upper } : null
}

function quantilesFor(window, coverage) {
    const tail = (1 - coverage) / 2
    return [window.quantile(tail), window.quantile(1 - tail)]
}

function createResult(length, params) {
    return {
        basis: Array(length).fill(null), upper: Array(length).fill(null),
        lower: Array(length).fill(null), quantiles: Array(length).fill(null), fan: null,
        stats: { realizedCoverage: null, targetCoverage: params.coverage, calibratedBars: 0, status: 'calibrating' },
        meta: { warmup: SEED_RETURNS + params.quantileWindow + 1 },
    }
}

function addFan(result, close, variance, quantiles, params) {
    const fan = { upper: [], lower: [], bars: params.fanBars }
    for (let i = 1; i <= params.fanBars; i++) {
        const band = interval(close, variance, quantiles, i)
        if (!band) return
        fan.lower.push(band.lower)
        fan.upper.push(band.upper)
    }
    result.fan = fan
}

/** Compute causal calibrated intervals and a frozen-volatility forward fan.
 * @param {Array<{open:number,high:number,low:number,close:number}>} bars
 * @param {{assetClass:'equities'|'crypto'|'forex'|'comm'}} ctx
 * @param {typeof VOLBANDS_CFG} [params]
 * @returns {{basis:(number|null)[],upper:(number|null)[],lower:(number|null)[],quantiles:([number,number]|null)[],fan:{upper:number[],lower:number[],bars:number}|null,stats:{realizedCoverage:number|null,targetCoverage:number,calibratedBars:number,status:string},meta:{warmup:number}}}
 */
export function computeVolBands(bars, ctx, params = VOLBANDS_CFG) {
    const result = createResult(bars.length, params)
    const observations = new SortedWindow(params.quantileWindow)
    const coverage = new SortedWindow(params.quantileWindow)
    const estimator = params.estimatorByClass[ctx.assetClass] === 'yangZhang'
        ? new YangZhangRoller(params.yangZhangWindow)
        : createEwmaVol(params.ewmaLambda[ctx.assetClass] ?? params.ewmaLambda.equities)
    let previousClose = null
    for (let i = 0; i < bars.length; i++) {
        const bar = bars[i]
        if (!validBar(bar)) continue
        if (previousClose !== null) {
            const variance = estimator.variance
            const ret = Math.log(bar.close) - Math.log(previousClose)
            if (variance !== null && Number.isFinite(variance)) {
                if (observations.size === params.quantileWindow) {
                    const quantiles = quantilesFor(observations, params.coverage)
                    const band = interval(previousClose, variance, quantiles)
                    if (band) {
                        result.basis[i] = previousClose
                        result.lower[i] = band.lower
                        result.upper[i] = band.upper
                        result.quantiles[i] = quantiles
                        coverage.push(bar.close >= band.lower && bar.close <= band.upper ? 1 : 0)
                    }
                }
                observations.push(ret / Math.max(Math.sqrt(variance), SIGMA_FLOOR))
            }
            if (estimator instanceof YangZhangRoller) estimator.push(bar, previousClose)
            else estimator.push(ret)
        }
        previousClose = bar.close
    }
    const variance = estimator.variance
    result.stats.calibratedBars = observations.size
    if (coverage.size) result.stats.realizedCoverage = coverage.values.reduce((sum, value) => sum + value, 0) / coverage.size
    if (observations.size === params.quantileWindow && variance !== null && Number.isFinite(variance)) {
        result.stats.status = variance <= SIGMA_FLOOR ** 2 ? 'degenerate' : 'ready'
        addFan(result, previousClose, variance, quantilesFor(observations, params.coverage), params)
    }
    return result
}
