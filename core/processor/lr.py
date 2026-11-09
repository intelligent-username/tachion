"""Log Returns calculator"""

import numpy as np
import pandas as pd


def log_return(series: pd.Series) -> pd.Series:
    """
    Compute log return: log(price_t / price_{t-1}).
    First value will be NaN.
    """
    with np.errstate(divide='ignore', invalid='ignore'):
        return np.log(series / series.shift(1))


def volume_change(series: pd.Series) -> pd.Series:
    """
    Compute log volume change: log(volume_t / volume_{t-1}).
    First value will be NaN.
    """
    return log_return(series)
