/** Maintain a bounded, sorted window of finite observations. */
export class SortedWindow {
    constructor(capacity) {
        this.capacity = capacity
        this.values = []
        this.queue = new Array(capacity)
        this.head = 0
        this.size = 0
    }

    indexOf(value) {
        let low = 0
        let high = this.values.length
        while (low < high) {
            const mid = (low + high) >>> 1
            if (this.values[mid] < value) low = mid + 1
            else high = mid
        }
        return low
    }

    push(value) {
        if (!Number.isFinite(value) || this.capacity < 1) return
        if (this.size === this.capacity) this.removeOldest()
        this.queue[(this.head + this.size) % this.capacity] = value
        this.size++
        this.values.splice(this.indexOf(value), 0, value)
    }

    removeOldest() {
        if (!this.size) return null
        const value = this.queue[this.head]
        this.head = (this.head + 1) % this.capacity
        this.size--
        this.values.splice(this.indexOf(value), 1)
        return value
    }

    quantile(p) {
        if (!this.size || !Number.isFinite(p) || p < 0 || p > 1) return null
        const index = (this.size - 1) * p
        const low = Math.floor(index)
        const fraction = index - low
        return this.values[low] * (1 - fraction) + this.values[Math.ceil(index)] * fraction
    }
}

/** Seed from the first 20 observed returns, then update variance causally. */
export function createEwmaVol(lambda, seedWindow = 20) {
    let count = 0
    let sum = 0
    let variance = null
    return {
        get variance() { return variance },
        push(value) {
            if (!Number.isFinite(value) || !Number.isFinite(value * value)) return variance
            const squared = value * value
            if (count < seedWindow) {
                sum += squared
                count++
                if (count === seedWindow) variance = sum / seedWindow
            } else variance = lambda * variance + (1 - lambda) * squared
            return variance
        },
    }
}

/** Roll canonical Yang-Zhang variance over valid OHLC returns. */
export class YangZhangRoller {
    constructor(window) {
        this.window = window
        this.rows = []
        this.head = 0
        this.sums = [0, 0, 0, 0, 0]
    }

    push(bar, previousClose) {
        const { open, high, low, close } = bar
        if (![open, high, low, close, previousClose].every(x => Number.isFinite(x) && x > 0)) return this.variance
        const overnight = Math.log(open) - Math.log(previousClose)
        const intraday = Math.log(close) - Math.log(open)
        const rs = (Math.log(high) - Math.log(open)) * (Math.log(high) - Math.log(close))
            + (Math.log(low) - Math.log(open)) * (Math.log(low) - Math.log(close))
        const row = [overnight, overnight * overnight, intraday, intraday * intraday, rs]
        if (!row.every(Number.isFinite)) return this.variance
        if (this.rows.length === this.window) {
            const old = this.rows[this.head]
            for (let i = 0; i < 5; i++) this.sums[i] -= old[i]
            this.rows[this.head] = row
            this.head = (this.head + 1) % this.window
        } else this.rows.push(row)
        for (let i = 0; i < 5; i++) this.sums[i] += row[i]
        return this.variance
    }

    get variance() {
        const m = this.window
        if (m < 2 || this.rows.length < m) return null
        const [dx, dx2, co, co2, rs] = this.sums
        const overnight = Math.max(0, (dx2 - dx * dx / m) / (m - 1))
        const intraday = Math.max(0, (co2 - co * co / m) / (m - 1))
        const k = 0.34 / (1.34 + (m + 1) / (m - 1))
        // Canonical YZ weights close/open variance by k and mean RS by 1-k.
        return Math.max(0, overnight + k * intraday + (1 - k) * rs / m)
    }
}
