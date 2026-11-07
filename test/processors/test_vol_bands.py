"""Check causal volatility estimates against independent expectations."""

import numpy as np

from core.processor.bands import volatility_bands


def test_ewma_worked_example() -> None:
    # Returns are 0.1, -0.1, 0.2, 0.0, 0.1; seed=(.01+.01)/2.
    # The initial flat OHLC scale is zero; one prior return gives provisional .01.
    # With decay .5, mature prior variances remain .01, .025, .0125.
    closes = np.exp([0.0, 0.1, 0.0, 0.2, 0.2, 0.3])
    bars = [{"open": value, "high": value, "low": value, "close": value} for value in closes]
    result = volatility_bands(bars, decay=0.5, window=2, quantile_window=1)
    np.testing.assert_allclose(result["variance"], [np.nan, 0.0, .01, .01, .025, .0125],
                               equal_nan=True, atol=1e-12)


def test_last_close_does_not_change_earlier_bands() -> None:
    closes = np.exp(np.arange(40) * .01 + np.sin(np.arange(40)) * .005)
    bars = [{"open": value, "high": value * 1.01, "low": value * .99, "close": value}
            for value in closes]
    changed = [dict(bar) for bar in bars]
    changed[-1]["close"] *= 1.2
    for estimator in ("ewma", "yang_zhang"):
        original = volatility_bands(bars, estimator=estimator, window=3, quantile_window=5)
        altered = volatility_bands(changed, estimator=estimator, window=3, quantile_window=5)
        for key in ("basis", "lower", "upper", "variance"):
            np.testing.assert_allclose(original[key][:-1], altered[key][:-1], equal_nan=True)
