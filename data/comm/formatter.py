"""
Format Commodities data for training.

Minimal high-signal features for commodities (Gold, Silver, Oil):
- symbol (item_id)
- timestamp
- log_return (target)
- log_return_lag1
- MA_50 (50-period simple moving average)
- MA_200 (200-period simple moving average)
- rolling_vol_50 (50-period rolling volatility)
- rolling_vol_200 (200-period rolling volatility)
- day_of_week (0-6)
- day_of_month (1-31)
- quarter (1-4)

Focuses on long-term trends and seasonality.
Commodity prices are driven by political/supply-demand shocks; we capture
gradual trends via long-term MAs and volatility.
"""

import sys
from importlib import resources
from pathlib import Path

import pandas as pd
from core import (
    add_date_features,
    log_return,
    moving_average,
    rolling_volatility,
)
from core.processor.pw import ProgressWriter


def load_commodity(symbol, package):
    """
    Load raw JSON data for a commodity.
    Returns a DataFrame with datetime parsed and sorted.
    """
    raw_path = resources.files(package) / 'raw' / f'{symbol}.json'
    df = pd.read_json(raw_path)
    df['datetime'] = pd.to_datetime(df['datetime'])
    df = df.sort_values('datetime').reset_index(drop=True)
    return df


def process_commodity_data(symbol, package):
    """
    Process a single commodity's data with minimal high-signal features.
    Returns a DataFrame ready for DeepAR.
    """
    df = load_commodity(symbol, package)

    # --- Target: log_return ---
    df['log_return'] = log_return(df['close'])

    # --- Lagged covariates ---
    df['log_return_lag1'] = df['log_return'].shift(1)
    df['MA_50'] = moving_average(df['close'], window=50)
    df['MA_200'] = moving_average(df['close'], window=200)
    df['rolling_vol_50'] = rolling_volatility(df['log_return'], window=50)
    df['rolling_vol_200'] = rolling_volatility(df['log_return'], window=200)

    # --- Known covariates (date-based) ---
    df = add_date_features(df, date_col='datetime')

    # Add symbol column
    df['symbol'] = symbol

    # Rename for clarity
    df.rename(columns={'datetime': 'timestamp'}, inplace=True)

    # Select and order columns
    cols = [
        'symbol',
        'timestamp',
        'log_return',           # target
        'log_return_lag1',      # lagged
        'MA_50',
        'MA_200',
        'rolling_vol_50',
        'rolling_vol_200',
        'day_of_week',          # known
        'day_of_month',
        'quarter',
    ]
    df = df[cols]

    return df


def process_all_data(symbols, package):
    """
    Process all commodities and write to a single parquet file, ordered by timestamp.
    """
    total = len(symbols)
    if total == 0:
        print("No symbols provided; nothing to process.")
        return

    all_dfs = []
    for idx, symbol in enumerate(symbols, 1):
        try:
            df = process_commodity_data(symbol, package)
            all_dfs.append(df)
            ProgressWriter(idx, total)
        except Exception as e:
            sys.stdout.write(f"\nError processing {symbol}: {e}\n")
            ProgressWriter(idx, total)

    # Aggregate and order by timestamp
    combined = pd.concat(all_dfs, ignore_index=True)
    combined = combined.sort_values(by=['timestamp', 'symbol']).reset_index(drop=True)

    # Write to processed/ folder
    out_path = Path(resources.files(package) / 'processed' / 'comm_processed.parquet')
    out_path.parent.mkdir(parents=True, exist_ok=True)
    combined.to_parquet(out_path, index=False)
    print(f"Wrote {len(combined)} rows to {out_path}")


if __name__ == "__main__":
    pkg = __package__  # should be 'data.comm'
    txt = resources.files(pkg).joinpath('comms.txt')
    with txt.open('r') as f:
        commodities = [line.split('#')[0].strip() for line in f if line.strip() and not line.lstrip().startswith('#')]

    process_all_data(commodities, pkg)
