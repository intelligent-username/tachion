"""Offline snapshot measurements; never a test gate or a provider/data fetch.

Run later, when execution is authorized, with ``python -m train.eval.bands_backtest``.
CSV goes to stdout unless --output names a new file (existing files are not replaced).
No report is produced merely by importing this module.

The plan names four configurations without defining the comparison baselines:
this harness uses descriptive Classic Bollinger, Gaussian EWMA, empirical EWMA,
and empirical Yang-Zhang. Classic includes the current close and is NOT a forecast;
its score is only descriptive, not evidence of predictive coverage. The 95% target
is a nominal scoring reference, not an established coverage guarantee.
The Gaussian baseline uses the same causal EWMA variance as empirical EWMA and
waits for its mature empirical flag, excluding immature variance and residual
warmup alike. Provisional empirical bounds are never scored. Only next-bar
volatility intervals are scored, not the approximate 13-bar fan.

Three asset groups are equities, crypto, and forex/commodities; original asset
classes remain separate in every row. Each snapshot also gets three chronological
thirds and 26,000-bar rolling windows (13,000-bar stride, plus a final full window).
Short snapshots get an explicitly marked partial window. Indicators run once on
the full history: evaluation slices never reset their calibration or use future
observations. Overlapping windows are diagnostic slices, not independent samples.

Calm/turbulent labels compare prior-20-return RMS with the median of the previous
500 such RMS estimates. Both quantities exclude the return being scored. Missing
regime history is reported as unknown, never silently classified as calm. Scores
use the intersection of finite usable intervals across all four configurations,
after both empirical estimators mature and the Gaussian warmup above, keeping
comparisons on identical bars. Per-config post-warmup availability is reported separately.
Prices are used as delivered, with no smoothing, resampling, or adjustment.
"""

import argparse
import csv
import json
import sys
from datetime import datetime
from pathlib import Path
from statistics import NormalDist

import numpy as np
import pandas as pd

from core.processor.bands import bollinger_bands, volatility_bands


ROOT = Path(__file__).resolve().parents[2]
ASSET_GROUPS = {"equities": "equities", "crypto": "crypto",
                "forex": "forex_comm", "comm": "forex_comm"}
COVERAGE = 0.95
ROLLING_BARS = 26_000
ROLLING_STRIDE = 13_000
CONFIGURATIONS = ("classic_bollinger", "gaussian_ewma", "empirical_ewma",
                  "empirical_yang_zhang")
FIELDS = (
    "snapshot", "asset_class", "asset_group", "symbol", "configuration",
    "interpretation", "target_coverage", "ewma_decay", "slice", "start_bar",
    "end_bar_exclusive", "start_time", "end_time", "partial_window", "regime",
    "bars", "valid_ohlc_bars", "available_intervals", "common_intervals",
    "scored_bars", "status", "realized_coverage", "mean_width",
    "mean_relative_width", "mean_winkler", "mean_relative_winkler",
)


def load_snapshot(path: Path) -> list[dict]:
    """Accept the actual raw list/OHLC/datetime schema; reject ambiguous ordering.

    Invalid OHLC stays in place for the reference's skip policy. Timestamps must
    be present, unique, and increasing; no implicit sorting or deduplication.
    """
    with path.open(encoding="utf-8") as source:
        bars = json.load(source)
    if not isinstance(bars, list) or not bars:
        raise ValueError(f"{path}: expected a nonempty JSON row array")
    previous = None
    for index, bar in enumerate(bars):
        if not isinstance(bar, dict) or not isinstance(bar.get("datetime"), str):
            raise ValueError(f"{path}: row {index} needs a datetime string")
        timestamp = datetime.fromisoformat(bar["datetime"])
        if previous is not None and timestamp <= previous:
            raise ValueError(f"{path}: timestamps must be unique and increasing")
        previous = timestamp
    return bars


def ohlc_values(bars: list[dict]) -> np.ndarray:
    """Match the reference's finite, positive OHLC eligibility without dropping rows."""
    values = np.full((len(bars), 4), np.nan)
    for index, bar in enumerate(bars):
        for column, name in enumerate(("open", "high", "low", "close")):
            try:
                values[index, column] = float(bar[name])
            except (KeyError, TypeError, ValueError):
                pass
    return values


def regime_labels(values: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """Label with past data only, bridging invalid OHLC like the reference does."""
    labels = np.full(len(values), "unknown", dtype=object)
    indices = np.flatnonzero(valid)
    if len(indices) < 2:
        return labels
    closes = values[indices, 3]
    returns = pd.Series(np.log(closes[1:]) - np.log(closes[:-1]))
    prior_rms = np.sqrt(returns.pow(2).rolling(20).mean()).shift(1)
    threshold = prior_rms.shift(1).rolling(500).median()
    known = prior_rms.notna() & threshold.notna()
    labels[indices[1:][known.to_numpy()]] = np.where(
        prior_rms[known] <= threshold[known], "calm", "turbulent")
    return labels


def compute_intervals(bars: list[dict], values: np.ndarray,
                      valid: np.ndarray, decay: float) -> dict:
    """Reuse the Python reference; no independently reimplemented band estimators."""
    classic = bollinger_bands(values[:, 3])
    ewma = volatility_bands(bars, estimator="ewma", decay=decay, fan_bars=0)
    yz = volatility_bands(bars, estimator="yang_zhang", fan_bars=0)
    basis = np.full(len(bars), np.nan)
    indices = np.flatnonzero(valid)
    basis[indices[1:]] = values[indices[:-1], 3]
    # Use the empirical EWMA maturity flag for the Gaussian baseline too: this
    # deliberately waits beyond variance seeding until residual calibration matures.
    sigma = np.sqrt(np.maximum(np.where(ewma["provisional"], np.nan, ewma["variance"]), 0))
    sigma = np.maximum(sigma, 1e-8)
    normal_quantile = NormalDist().inv_cdf((1 + COVERAGE) / 2)
    with np.errstate(over="ignore", invalid="ignore"):
        gaussian_lower = basis * np.exp(-normal_quantile * sigma)
        gaussian_upper = basis * np.exp(normal_quantile * sigma)
    empirical = {
        name: tuple(np.where(result["provisional"], np.nan, result[side])
                    for side in ("lower", "upper"))
        for name, result in (("empirical_ewma", ewma), ("empirical_yang_zhang", yz))
    }
    return {
        "classic_bollinger": (classic["lower"], classic["upper"]),
        "gaussian_ewma": (gaussian_lower, gaussian_upper),
        **empirical,
    }


def evaluation_slices(length: int):
    """Yield named half-open slices, preserving full preceding indicator history."""
    yield "full", 0, length, False
    for part, name in enumerate(("early", "middle", "late")):
        start, end = length * part // 3, length * (part + 1) // 3
        if start < end:
            yield f"third_{name}", start, end, False
    if length < ROLLING_BARS:
        yield "rolling_0000", 0, length, True
        return
    starts = list(range(0, length - ROLLING_BARS + 1, ROLLING_STRIDE))
    if starts[-1] != length - ROLLING_BARS:
        starts.append(length - ROLLING_BARS)
    for index, start in enumerate(starts):
        yield f"rolling_{index:04d}", start, start + ROLLING_BARS, False


def interval_metrics(close: np.ndarray, lower: np.ndarray, upper: np.ndarray) -> dict:
    """Winkler = width + 2/alpha times distance outside a central interval.

    Raw widths/scores are in each asset's price units. Relative versions divide
    each observation by its realized close; do not pool raw price-unit scores
    across assets. Empty slices produce blank CSV cells, never fabricated zeros.
    """
    if not len(close):
        return {key: None for key in ("realized_coverage", "mean_width",
                "mean_relative_width", "mean_winkler", "mean_relative_winkler")}
    width = upper - lower
    penalty = np.maximum(lower - close, 0) + np.maximum(close - upper, 0)
    winkler = width + (2 / (1 - COVERAGE)) * penalty
    return {
        "realized_coverage": float(np.mean((lower <= close) & (close <= upper))),
        "mean_width": float(np.mean(width)),
        "mean_relative_width": float(np.mean(width / close)),
        "mean_winkler": float(np.mean(winkler)),
        "mean_relative_winkler": float(np.mean(winkler / close)),
    }


def measure_snapshot(path: Path, asset_class: str):
    """Yield per-asset measurements, not pass/fail judgments or default changes."""
    bars = load_snapshot(path)
    values = ohlc_values(bars)
    valid = np.isfinite(values).all(axis=1) & (values > 0).all(axis=1)
    regimes = regime_labels(values, valid)
    decay = 0.9987 if asset_class == "crypto" else 0.995
    intervals = compute_intervals(bars, values, valid, decay)
    available = {
        name: valid & np.isfinite(lower) & np.isfinite(upper) & (lower <= upper)
        for name, (lower, upper) in intervals.items()
    }
    common = np.logical_and.reduce(list(available.values()))
    for slice_name, start, end, partial in evaluation_slices(len(bars)):
        for regime in ("all", "calm", "turbulent", "unknown"):
            selected = np.ones(end - start, dtype=bool)
            if regime != "all":
                selected &= regimes[start:end] == regime
            scored = selected & common[start:end]
            count = int(np.count_nonzero(scored))
            for name in CONFIGURATIONS:
                lower, upper = intervals[name]
                row = {
                    "snapshot": path.as_posix(), "asset_class": asset_class,
                    "asset_group": ASSET_GROUPS[asset_class], "symbol": path.stem,
                    "configuration": name,
                    "interpretation": ("descriptive_same_bar" if name == "classic_bollinger"
                                       else "causal_next_bar"),
                    "target_coverage": COVERAGE,
                    "ewma_decay": decay if "ewma" in name else None,
                    "slice": slice_name, "start_bar": start, "end_bar_exclusive": end,
                    "start_time": bars[start]["datetime"],
                    "end_time": bars[end - 1]["datetime"],
                    "partial_window": partial, "regime": regime,
                    "bars": int(np.count_nonzero(selected)),
                    "valid_ohlc_bars": int(np.count_nonzero(selected & valid[start:end])),
                    "available_intervals": int(np.count_nonzero(
                        selected & available[name][start:end])),
                    "common_intervals": count, "scored_bars": count,
                    "status": "measured" if count else "unavailable",
                }
                row.update(interval_metrics(values[start:end, 3][scored],
                                            lower[start:end][scored], upper[start:end][scored]))
                yield row


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, default=ROOT / "data")
    parser.add_argument("--asset-classes", nargs="+", choices=tuple(ASSET_GROUPS),
                        default=list(ASSET_GROUPS))
    parser.add_argument("--output", type=Path, help="New CSV file; defaults to stdout")
    args = parser.parse_args()
    snapshots = [(asset_class, path) for asset_class in dict.fromkeys(args.asset_classes)
                 for path in sorted((args.data_root / asset_class / "raw").glob("*.json"))]
    if not snapshots:
        raise FileNotFoundError(f"No supported raw snapshots under {args.data_root}")
    for asset_class in dict.fromkeys(args.asset_classes):
        if not any(asset == asset_class for asset, _ in snapshots):
            print(f"Unavailable asset class (no snapshots): {asset_class}", file=sys.stderr)
    # Complete measurements first: bad input must not leave a plausible partial CSV.
    rows = []
    for asset_class, path in snapshots:
        print(f"Measuring {asset_class}/{path.name}", file=sys.stderr)
        rows.extend(measure_snapshot(path, asset_class))
    if args.output is None:
        writer = csv.DictWriter(sys.stdout, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    else:
        with args.output.open("x", encoding="utf-8", newline="") as output:
            writer = csv.DictWriter(output, fieldnames=FIELDS)
            writer.writeheader()
            writer.writerows(rows)


if __name__ == "__main__":
    main()
