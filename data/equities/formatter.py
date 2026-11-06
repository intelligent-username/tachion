"""
Process raw data for equities to output a format that's ready to train on.

Creates the following features:
- Ticker
- Timestamp
- log_return_{t-1}
- volume_change: log(volume_t / volume_{t-1})
- 5_day_MA (the 5 day moving average)
- 50_day_MA
- rolling_volatility_5 (the rolling volatility over the past 5 days)
- rolling_volatility_50
- S&P_log_return_{t-1}
- ΔVIX_{t-1} (the change in VIX index)
- day_of_week: 0 to 6
- day_of_month: 1 to 31
- quarter: 1 to 4
- S&P_log_return
- log_return

Note that alll these features (except the date, ticker, and known covariates) are aligned such that they can be used to predict log_return at time t.

Once processed, we'll write parquet files to the processed/ folder, which will contain all of these features, ordered by date (different tickers interleaved). The model will handle data separation by ticker internally.
"""

# Might have to implement "dynamic lagging" when increasing the prediction horizon.

import sys
from importlib import resources
from pathlib import Path

import numpy as np
import pandas as pd
from core import (
    add_date_features,
    log_return,
    moving_average,
    rolling_volatility,
    volume_change,
)
from core.processor.pw import ProgressWriter


def load_company(symbol, package):
    """
    Loads in all raw JSON data for a given ticker.
    Returns a DataFrame with datetime parsed.
    """

    raw_path = resources.files(package) / 'raw' / f'{symbol}.json'
    df = pd.read_json(raw_path)
    df['datetime'] = pd.to_datetime(df['datetime'])
    df = df.sort_values('datetime').reset_index(drop=True)
    return df


def process_company_data(symbol, package, sp500_df, vix_delta_df):
    """
    Process a single company's data to create all features for DeepAR.
    Returns a DataFrame with: ticker, timestamp, target, lagged covariates, known covariates.
    """
    df = load_company(symbol, package)

    # Replace zero volumes with last known non-zero to avoid log(0) explosions
    df['volume'] = df['volume'].replace(0, np.nan).ffill()

    # --- Target: log_return ---
    df['log_return'] = log_return(df['close'])

    # --- Lagged covariates ---
    df['log_return_lag1'] = df['log_return'].shift(1)
    df['volume_change'] = volume_change(df['volume'])
    df['5_day_MA'] = moving_average(df['close'], window=5)
    df['50_day_MA'] = moving_average(df['close'], window=50)
    df['rolling_volatility_5'] = rolling_volatility(df['log_return'], window=5)
    df['rolling_volatility_50'] = rolling_volatility(df['log_return'], window=50)

    # Merge S&P log return (lagged by 1)
    sp = sp500_df[['datetime', 'sp_log_return']].copy()
    sp['sp_log_return_lag1'] = sp['sp_log_return'].shift(1)
    df = df.merge(sp[['datetime', 'sp_log_return', 'sp_log_return_lag1']], on='datetime', how='left')

    # Merge VIX delta (lagged by 1)
    vix = vix_delta_df[['date', 'delta_vix']].copy()
    vix['delta_vix_lag1'] = vix['delta_vix'].shift(1)
    df['date'] = df['datetime'].dt.date
    vix['date'] = pd.to_datetime(vix['date']).dt.date
    df = df.merge(vix[['date', 'delta_vix_lag1']], on='date', how='left')
    df.drop(columns=['date'], inplace=True)

    # --- Known covariates (date-based) ---
    df = add_date_features(df, date_col='datetime')

    df['ticker'] = symbol

    df.rename(columns={'datetime': 'timestamp'}, inplace=True)

    # Correct order
    cols = [
        'ticker',
        'timestamp',
        'log_return',              # target
        'log_return_lag1',         # lagged
        'volume_change',
        '5_day_MA',
        '50_day_MA',
        'rolling_volatility_5',
        'rolling_volatility_50',
        'sp_log_return_lag1',
        'delta_vix_lag1',
        'day_of_week',             # known
        'day_of_month',
        'quarter',
        'sp_log_return',
    ]
    df = df[cols]

    return df


def process_all_data(symbols, package):
    """
    Process all companies' data and write to a single parquet file, ordered by date.
    """
    total = len(symbols)
    if total == 0:
        print("No symbols provided; nothing to process.")
        return

    # Load S&P500 data
    sp500_path = resources.files(package) / 'raw' / 'SPY.json'
    sp500_df = pd.read_json(sp500_path)
    sp500_df['datetime'] = pd.to_datetime(sp500_df['datetime'])
    sp500_df = sp500_df.sort_values('datetime').reset_index(drop=True)
    sp500_df['sp_log_return'] = log_return(sp500_df['close'])

    # Load VIX delta data
    vix_delta_path = resources.files(package) / 'raw' / 'vix' / 'VIX_Delta.json'
    vix_delta_df = pd.read_json(vix_delta_path)
    vix_delta_df['date'] = pd.to_datetime(vix_delta_df['date'])

    all_dfs = []
    for idx, symbol in enumerate(symbols, 1):
        try:
            df = process_company_data(symbol, package, sp500_df, vix_delta_df)
            all_dfs.append(df)
            ProgressWriter(idx, total)
        except Exception as e:
            # Print the error on its own line, then redraw progress
            sys.stdout.write(f"\nError processing {symbol}: {e}\n")
            ProgressWriter(idx, total)

    # Aggregate and order by timestamp
    combined = pd.concat(all_dfs, ignore_index=True)
    combined = combined.sort_values(by=['timestamp', 'ticker']).reset_index(drop=True)

    # Write to the processed/ folder
    out_path = Path(resources.files(package) / 'processed' / 'equities_processed.parquet')
    out_path.parent.mkdir(parents=True, exist_ok=True)

    combined.to_parquet(
                        out_path,
                        index=False,
                        engine='pyarrow',
                        compression='zstd')
    
    print(f"Wrote {len(combined)} rows to {out_path}")


if __name__ == "__main__":
    pkg = __package__  # should be 'data.equities'
    txt = resources.files(pkg).joinpath('companies.txt')
    with txt.open('r') as f:
        companies = [line.rstrip("\n") for line in f if line.strip() and not line.lstrip().startswith('#')]
    
    process_all_data(companies, pkg)

