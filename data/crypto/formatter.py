"""
Preprocess raw cryptocurrency data so it's suitable for training.

Creates the following features:
- symbol (item_id)
- timestamp
- log_return (target)
- log_return_lag1
- volume_change: log(volume_t / volume_{t-1})
- 5_period_MA
- 20_period_MA
- rolling_volatility_5
- rolling_volatility_20
- btc_log_return_lag1 (systemic market driver)
- hour_of_day: 0-23 (important for crypto)
- day_of_week: 0-6
- day_of_month: 1-31
- is_weekend: 0 or 1
- btc_log_return (known covariate, lagged)

Crypto trades 24/7, so intra-day seasonality is captured via hour_of_day.
"""

import sys
from importlib import resources
from pathlib import Path

import pandas as pd
from core import (
    log_return,
    moving_average,
    rolling_volatility,
    volume_change,
)
from core.processor.dw import add_crypto_date_features
from core.processor.pw import ProgressWriter


def load_coin(symbol, package):
    """
    Loads in all raw JSON data for a given coin.
    Returns a DataFrame with datetime parsed.
    """
    raw_path = resources.files(package) / 'raw' / f'{symbol}.json'
    df = pd.read_json(raw_path)
    df['datetime'] = pd.to_datetime(df['datetime'])
    df = df.sort_values('datetime').reset_index(drop=True)
    return df


def process_coin_data(symbol, package, btc_df):
    """
    Process a single coin's data to create all features for DeepAR.
    Returns a DataFrame with: symbol, timestamp, target, lagged covariates, known covariates.
    """
    df = load_coin(symbol, package)

    # --- Target: log_return ---
    df['log_return'] = log_return(df['close'])

    # --- Lagged covariates ---
    df['log_return_lag1'] = df['log_return'].shift(1)
    df['volume_change'] = volume_change(df['volume'])
    df['5_period_MA'] = moving_average(df['close'], window=5)
    df['20_period_MA'] = moving_average(df['close'], window=20)
    df['rolling_volatility_5'] = rolling_volatility(df['log_return'], window=5)
    df['rolling_volatility_20'] = rolling_volatility(df['log_return'], window=20)

    # Merge BTC log return (lagged by 1)
    btc = btc_df[['datetime', 'btc_log_return']].copy()
    btc['btc_log_return_lag1'] = btc['btc_log_return'].shift(1)
    df = df.merge(btc[['datetime', 'btc_log_return', 'btc_log_return_lag1']], on='datetime', how='left')

    # --- Known covariates (date-based, crypto-specific) ---
    df = add_crypto_date_features(df, date_col='datetime')

    # Add symbol column
    df['symbol'] = symbol

    # Rename for clarity
    df.rename(columns={'datetime': 'timestamp'}, inplace=True)

    # Select and order columns
    cols = [
        'symbol',
        'timestamp',
        'log_return',              # target
        'log_return_lag1',         # lagged
        'volume_change',
        '5_period_MA',
        '20_period_MA',
        'rolling_volatility_5',
        'rolling_volatility_20',
        'btc_log_return_lag1',
        'hour_of_day',             # known
        'day_of_week',
        'day_of_month',
        'is_weekend',
        'btc_log_return',
    ]
    df = df[cols]

    return df


def process_all_data(symbols, package):
    """
    Process all coins' data and write to a single parquet file, ordered by timestamp.
    """
    total = len(symbols)
    if total == 0:
        print("No symbols provided; nothing to process.")
        return

    def _render_progress(done: int) -> None:
        bar_width = 30
        filled = int(bar_width * done / total)
        green = "\033[92m"
        reset = "\033[0m"
        bar = f"{green}{'=' * filled}{reset}{' ' * (bar_width - filled)}"
        sys.stdout.write(f"\rProcessed [{bar}] {done}/{total}")
        sys.stdout.flush()
        if done == total:
            sys.stdout.write("\n")
    # Load BTC data as the market driver
    btc_path = resources.files(package) / 'raw' / 'BTC.json'
    btc_df = pd.read_json(btc_path)
    btc_df['datetime'] = pd.to_datetime(btc_df['datetime'])
    btc_df = btc_df.sort_values('datetime').reset_index(drop=True)
    btc_df['btc_log_return'] = log_return(btc_df['close'])

    # Process each symbol
    all_dfs = []
    for idx, symbol in enumerate(symbols, 1):
        try:
            df = process_coin_data(symbol, package, btc_df)
            all_dfs.append(df)
            ProgressWriter(idx, total)
        except Exception as e:
            sys.stdout.write(f"\nError processing {symbol}: {e}\n")
            ProgressWriter(idx, total)

    # Aggregate and order by timestamp
    combined = pd.concat(all_dfs, ignore_index=True)
    combined = combined.sort_values(by=['timestamp', 'symbol']).reset_index(drop=True)

    # Write to processed/ folder
    out_path = Path(resources.files(package) / 'processed' / 'crypto_processed.parquet')
    out_path.parent.mkdir(parents=True, exist_ok=True)
    combined.to_parquet(out_path, index=False)
    print(f"Wrote {len(combined)} rows to {out_path}")


if __name__ == "__main__":
    pkg = __package__  # should be 'data.crypto'
    txt = resources.files(pkg).joinpath('coins.txt')
    with txt.open('r') as f:
        coins = [line.split('#')[0].strip() for line in f if line.strip() and not line.lstrip().startswith('#')]

    process_all_data(coins, pkg)
