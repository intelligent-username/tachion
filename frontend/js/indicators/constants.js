export const BOLLINGER_CFG = { window: 20, k: 2, source: 'close', middle: 'SMA' }

export const VOLBANDS_CFG = {
    coverage: 0.95,
    quantileWindow: 500,
    horizon: 1,
    ewmaLambda: { equities: 0.995, forex: 0.995, comm: 0.995, crypto: 0.9987 },
    yangZhangWindow: 20,
    estimatorByClass: { equities: 'yangZhang', crypto: 'yangZhang', forex: 'ewma', comm: 'ewma' },
}
