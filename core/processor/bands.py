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
    if window < 2 or not np.isfinite(k) or k < 0:
        raise ValueError("window must be at least two and k finite and nonnegative")
    result = {name: np.full(len(closes), np.nan) for name in
              ("middle", "upper", "lower", "percent_b")}
    for index in range(1, len(closes)):
        values = np.asarray(closes[max(0, index + 1 - window):index + 1], dtype=float)
        if not np.isfinite(values).all():
            continue
        middle, deviation = float(np.mean(values)), float(np.std(values, ddof=0))
        lower, upper = middle - k * deviation, middle + k * deviation
        if not np.isfinite([middle, lower, upper]).all():
            continue
        result["middle"][index], result["lower"][index], result["upper"][index] = middle, lower, upper
        result["percent_b"][index] = (values[-1] - lower) / (upper - lower) if upper != lower else 0.5
    ending = np.asarray(closes[max(0, len(closes) - window):], dtype=float)
    window_bars = int(np.isfinite(ending).sum())
    result["stats"] = {"usable_bars": int(np.isfinite(np.asarray(closes, dtype=float)).sum()),
                       "window_bars": window_bars, "is_provisional": window_bars < window}
    result["meta"] = {"minimum_bars": 2, "warmup": window}
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
            self.variance = self._component_variance()

    def _component_variance(self) -> float | None:
        count = len(self.components)
        if not count:
            return None
        values = np.asarray(self.components)
        if count == 1:
            return max(0.0, float(values[0, 0] ** 2 + values[0, 1] ** 2 + values[0, 2]))
        weight = 0.34 / (1.34 + (count + 1) / (count - 1))
        # Same canonical YZ formula; only provisional samples use a shorter span.
        return max(0.0, float(np.var(values[:, 0], ddof=1)
            + weight * np.var(values[:, 1], ddof=1)
            + (1 - weight) * np.mean(values[:, 2])))

    @property
    def provisional_variance(self) -> float | None:
        if self.variance is not None:
            return self.variance
        if self.estimator == "ewma":
            return float(np.mean(self.returns)) if self.returns else None
        return self._component_variance()


def _ohlc(bar: dict) -> tuple[float, float, float, float] | None:
    try:
        values = tuple(float(bar[name]) for name in ("open", "high", "low", "close"))
    except (KeyError, TypeError, ValueError):
        return None
    return values if all(np.isfinite(value) and value > 0 for value in values) else None


def _quantiles(residuals: deque, coverage: float) -> np.ndarray:
    # Early two-sigma scale approximation, not established target coverage.
    if len(residuals) < residuals.maxlen:
        return np.array([-2.0, 2.0])
    tail = (1 - coverage) / 2
    return np.quantile(residuals, [tail, 1 - tail], method="linear")


def _interval(basis: float, variance: float, quantiles: np.ndarray, horizon: int = 1) -> np.ndarray | None:
    sigma = max(np.sqrt(variance), 1e-8) * np.sqrt(horizon)
    bounds = basis * np.exp(quantiles * sigma)
    return bounds if np.isfinite(bounds).all() and bounds[0] > 0 and bounds[1] >= bounds[0] else None


def _initial_variance(values: tuple) -> float:
    opening, high, low, close = values
    price_range = np.log(high) - np.log(low)
    intraday = np.log(close) - np.log(opening)
    return float(price_range ** 2 / (4 * np.log(2)) + intraday ** 2)


def volatility_bands(bars: Sequence[dict], *, estimator: str = "ewma", decay: float = 0.995,
                     window: int = 20, quantile_window: int = 500, coverage: float = 0.95,
                     fan_bars: int = 13) -> dict:
    """Compute causal log-return intervals from positive OHLC bars.

    Two usable observations permit provisional intervals. Their two-sigma scale
    is not empirical coverage and never enters mature residual calibration.
    Public Python stats/meta use snake_case counterparts of the frontend keys.

    >>> volatility_bands([], window=2, quantile_window=2)["basis"].size
    0
    """
    if estimator not in ("ewma", "yang_zhang") or window < 2 or quantile_window < 1:
        raise ValueError("invalid estimator or window")
    if not 0 <= decay <= 1 or not 0 < coverage < 1 or fan_bars < 0:
        raise ValueError("invalid volatility parameters")
    output = {name: np.full(len(bars), np.nan) for name in ("basis", "lower", "upper", "variance")}
    output["quantiles"] = np.full((len(bars), 2), np.nan)
    output["provisional"] = np.ones(len(bars), dtype=bool)
    residuals = deque(maxlen=quantile_window)
    evaluated = deque(maxlen=quantile_window)
    volatility = _Volatility(estimator, decay, window)
    previous = None
    initial_variance = None
    usable_bars = 0
    last_provisional = True
    for index, bar in enumerate(bars):
        values = _ohlc(bar)
        if values is None:
            continue
        usable_bars += 1
        if previous is not None:
            _process_bar(output, index, values, previous, volatility, residuals, evaluated, coverage,
                         initial_variance)
        else:
            initial_variance = _initial_variance(values)
        previous = values[3]
        last_provisional = bool(output["provisional"][index])
    variance = volatility.provisional_variance
    if variance is None:
        variance = initial_variance
    mature = volatility.variance is not None and len(residuals) == quantile_window
    output["stats"] = {
        "realized_coverage": float(np.mean(evaluated)) if evaluated else None,
        "target_coverage": coverage, "calibrated_bars": len(residuals), "coverage_bars": len(evaluated),
        "usable_bars": usable_bars, "is_provisional": not mature or last_provisional,
        "status": "degenerate" if usable_bars >= 2 and variance is not None and variance <= 1e-16
        else "ready" if mature else "calibrating",
    }
    output["meta"] = {"minimum_bars": 2, "warmup": window + quantile_window + 2}
    output["fan"] = _fan(previous, variance, residuals, coverage, usable_bars, fan_bars)
    return output


def _process_bar(output: dict, index: int, values: tuple, previous: float,
                 volatility: _Volatility, residuals: deque, evaluated: deque,
                 coverage: float, initial_variance: float | None) -> None:
    opening, high, low, close = values
    change = np.log(close) - np.log(previous)
    variance = volatility.provisional_variance
    if variance is None:
        variance = initial_variance
    if variance is not None:
        output["variance"][index] = variance
        mature = volatility.variance is not None and len(residuals) == residuals.maxlen
        quantiles = _quantiles(residuals, coverage)
        bounds = _interval(previous, variance, quantiles)
        if bounds is not None:
            output["basis"][index] = previous
            output["lower"][index], output["upper"][index] = bounds
            output["quantiles"][index] = quantiles
            output["provisional"][index] = not mature
            if mature:
                evaluated.append(float(bounds[0] <= close <= bounds[1]))
    if volatility.variance is not None:
        residuals.append(change / max(np.sqrt(volatility.variance), 1e-8))
    overnight, intraday = np.log(opening) - np.log(previous), np.log(close) - np.log(opening)
    rs = ((np.log(high) - np.log(opening)) * (np.log(high) - np.log(close))
          + (np.log(low) - np.log(opening)) * (np.log(low) - np.log(close)))
    volatility.update(change, overnight, intraday, rs)


def _fan(previous: float | None, variance: float | None, residuals: deque,
         coverage: float, usable_bars: int, bars: int) -> dict | None:
    if previous is None or variance is None or usable_bars < 2:
        return None
    quantiles = _quantiles(residuals, coverage)
    bounds = [_interval(previous, variance, quantiles, horizon) for horizon in range(1, bars + 1)]
    if any(bound is None for bound in bounds):
        return None
    return {"lower": np.array([bound[0] for bound in bounds]),
            "upper": np.array([bound[1] for bound in bounds]), "bars": bars}
