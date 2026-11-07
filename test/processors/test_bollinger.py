"""Compare the classic bands with pandas rolling statistics."""

import json
from pathlib import Path

import numpy as np
import pandas as pd

from core.processor.bands import bollinger_bands


def test_bollinger_matches_pandas_on_aapl() -> None:
    path = Path(__file__).resolve().parents[2] / "data/equities/raw/AAPL.json"
    with path.open(encoding="utf-8") as source:
        closes = pd.Series([bar["close"] for bar in json.load(source)], dtype=float)
    result = bollinger_bands(closes.to_list())
    middle = closes.rolling(20).mean()
    deviation = closes.rolling(20).std(ddof=0)
    np.testing.assert_allclose(result["middle"], middle, equal_nan=True)
    np.testing.assert_allclose(result["upper"], middle + 2 * deviation, equal_nan=True)
    np.testing.assert_allclose(result["lower"], middle - 2 * deviation, equal_nan=True)
