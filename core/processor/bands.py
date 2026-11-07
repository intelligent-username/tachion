"""Offline reference implementations of price and calibrated volatility bands."""

from collections import deque
from collections.abc import Sequence
from dataclasses import dataclass, field

import numpy as np


def bollinger_bands(closes: Sequence[float], window: int = 20, k: float = 2) -> dict:
    """Calculate population-standard-deviation bands for consecutive closes.

    >>> bollinger_bands([2, 4, 6, 8], window=4)["middle"][-1]
    5.0
    """
    if window < 1:
        raise ValueError("window must be positive")
    result = {name: np.full(len(closes), np.nan) for name in
              ("middle", "upper", "lower", "percent_b", "bandwidth")}
    for index in range(window - 1, len(closes)):
        values = np.asarray(closes[index + 1 - window:index + 1], dtype=float)
        if not np.isfinite(values).all():
            continue
        middle, deviation = float(np.mean(values)), float(np.std(values, ddof=0))
        lower, upper = middle - k * deviation, middle + k * deviation
        result["middle"][index], result["lower"][index], result["upper"][index] = middle, lower, upper
        result["percent_b"][index] = (values[-1] - lower) / (upper - lower) if upper != lower else 0.5
        result["bandwidth"][index] = (upper - lower) / middle if middle else np.nan
    return result


@dataclass
class _Volatility:
    estimator: str
    decay: float
    window: int
    returns: deque = field(default_factory=deque)
    components: deque = field(default_factory=deque)
    variance: float | None = None

    def update(self, change: float, overnight: float, intraday: float, rs: float) -> None:
        if self.estimator == "ewma":
            self._update_ewma(change)
        else:
            self._update_yz(overnight, intraday, rs)

    def _update_ewma(self, change: float) -> None:
        if self.variance is None:
            self.returns.append(change * change)
            if len(self.returns) == self.window:
                self.variance = float(np.mean(self.returns))
        else:
            self.variance = self.decay * self.variance + (1 - self.decay) * change * change

    def _update_yz(self, overnight: float, intraday: float, rs: float) -> None:
        self.components.append((overnight, intraday, rs))
        if len(self.components) > self.window:
            self.components.popleft()
        if len(self.components) == self.window:
            values = np.asarray(self.components)
            weight = 0.34 / (1.34 + (self.window + 1) / (self.window - 1))
            # Canonical YZ weights close/open variance and mean Rogers-Satchell.
            self.variance = max(0.0, float(np.var(values[:, 0], ddof=1)
                + weight * np.var(values[:, 1], ddof=1)
                + (1 - weight) * np.mean(values[:, 2])))


def _ohlc(bar: dict) -> tuple[float, float, float, float] | None:
    try:
        values = tuple(float(bar[name]) for name in ("open", "high", "low", "close"))
    except (KeyError, TypeError, ValueError):
        return None
    return values if all(np.isfinite(value) and value > 0 for value in values) else None


def _interval(basis: float, variance: float, residuals: deque, coverage: float) -> tuple:
    tail = (1 - coverage) / 2
    quantiles = np.quantile(residuals, [tail, 1 - tail], method="linear")
    sigma = max(np.sqrt(variance), 1e-8)
    return basis * np.exp(quantiles * sigma), quantiles


def volatility_bands(bars: Sequence[dict], *, estimator: str = "ewma", decay: float = 0.995,
                     window: int = 20, quantile_window: int = 500, coverage: float = 0.95,
                     fan_bars: int = 13) -> dict:
    """Compute causal log-return intervals from positive OHLC bars.

    >>> volatility_bands([], window=2, quantile_window=2)["basis"].size
    0
    """
    if estimator not in ("ewma", "yang_zhang") or window < 2 or quantile_window < 1:
        raise ValueError("invalid estimator or window")
    if not 0 <= decay <= 1 or not 0 < coverage < 1 or fan_bars < 0:
        raise ValueError("invalid volatility parameters")
    output = {name: np.full(len(bars), np.nan) for name in ("basis", "lower", "upper", "variance")}
    residuals = deque(maxlen=quantile_window)
    volatility = _Volatility(estimator, decay, window)
    previous = None
    for index, bar in enumerate(bars):
        values = _ohlc(bar)
        if values is None:
            continue
        if previous is not None:
            _process_bar(output, index, values, previous, volatility, residuals, coverage)
        previous = values[3]
    output["fan"] = _fan(previous, volatility.variance, residuals, coverage, quantile_window, fan_bars)
    return output


def _process_bar(output: dict, index: int, values: tuple, previous: float,
                 volatility: _Volatility, residuals: deque, coverage: float) -> None:
    opening, high, low, close = values
    change = np.log(close / previous)
    variance = volatility.variance
    if variance is not None:
        output["variance"][index] = variance
        if len(residuals) == residuals.maxlen:
            bounds, _ = _interval(previous, variance, residuals, coverage)
            output["basis"][index] = previous
            output["lower"][index], output["upper"][index] = bounds
        residuals.append(change / max(np.sqrt(variance), 1e-8))
    overnight, intraday = np.log(opening / previous), np.log(close / opening)
    rs = np.log(high / opening) * np.log(high / close) + np.log(low / opening) * np.log(low / close)
    volatility.update(change, overnight, intraday, rs)


def _fan(previous: float | None, variance: float | None, residuals: deque,
         coverage: float, window: int, bars: int) -> dict | None:
    if previous is None or variance is None or len(residuals) < window:
        return None
    _, quantiles = _interval(previous, variance, residuals, coverage)
    scale = max(np.sqrt(variance), 1e-8) * np.sqrt(np.arange(1, bars + 1))
    return {"lower": previous * np.exp(quantiles[0] * scale),
            "upper": previous * np.exp(quantiles[1] * scale), "bars": bars}
