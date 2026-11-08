"""
YFinance (Yahoo Finance) API Call Utils.
"""

import datetime
import json
import os
import time

import yfinance as yf


def call_specific_yf(path, symbols, interval="1d", rate_limit=5):
    """
    Fetch YFinance data and write to JSON files.

    path: Directory path to write JSON files to
    symbols (list): List of ticker symbols (e.g., ["ZQ=F", "^TNX"])
    interval (str): Data interval (1m, 2m, 5m, 15m, 30m, 60m, 90m, 1h, 1d, 5d, 1wk, 1mo, 3mo)
    rate_limit (int): Maximum API calls per minute (default 5, be conservative)
    """

    # Rate limiting
    calls_this_minute = 0
    minute_start = time.time()

    # 15 years back from today
    end_date = datetime.datetime.now()
    start_date = end_date - datetime.timedelta(days=15 * 365)

    for symbol in symbols:
        file_path = os.path.join(path, f"{symbol.replace('=', '_').replace('^', '')}.json")

        # Check if file exists and get latest date
        is_fresh = True
        existing_data = []

        if os.path.exists(file_path):
            try:
                with open(file_path, "r") as f:
                    existing_data = json.load(f)

                if existing_data:
                    latest_date = datetime.datetime.strptime(
                        existing_data[-1]["datetime"], "%Y-%m-%d"
                    )
                    print(f"Found existing data for {symbol} up to {latest_date.date()}. Updating...")
                    is_fresh = False
                    fetch_start = latest_date + datetime.timedelta(days=1)
                else:
                    fetch_start = start_date

            except Exception as e:
                print(f"Could not parse existing file for {symbol}. Treating as fresh. Error: {e}")
                os.remove(file_path)
                is_fresh = True
                existing_data = []
                fetch_start = start_date
        else:
            fetch_start = start_date

        # Rate limit check
        calls_this_minute += 1
        if calls_this_minute >= rate_limit:
            elapsed = time.time() - minute_start
            if elapsed < 60:
                sleep_time = 60 - elapsed + 2
                print(f"Rate limit approaching. Sleeping {sleep_time:.1f}s...")
                time.sleep(sleep_time)
            calls_this_minute = 0
            minute_start = time.time()

        data = YFinanceAPI(
            symbol=symbol,
            start_date=fetch_start,
            end_date=end_date,
            interval=interval
        )

        if data.get("status") == "error":
            print(f"Error retrieving data for {symbol}: {data.get('message', '')}")
            continue

        new_values = data.get("values", [])

        if not new_values:
            if is_fresh:
                print(f"No data available for {symbol}")
            else:
                print(f"No updates needed for {symbol}")
            continue

        if is_fresh:
            # Write fresh data (sorted chronologically)
            new_values.sort(key=lambda x: x["datetime"])
            with open(file_path, "w") as f:
                json.dump(new_values, f, indent=4)
            print(f"Wrote {len(new_values)} records for {symbol} to {file_path}")
        else:
            # Append new data to existing
            # Filter out any duplicates
            existing_dates = {d["datetime"] for d in existing_data}
            new_values = [v for v in new_values if v["datetime"] not in existing_dates]

            if new_values:
                new_values.sort(key=lambda x: x["datetime"])
                full_data = existing_data + new_values
                with open(file_path, "w") as f:
                    json.dump(full_data, f, indent=4)
                print(f"Updated {symbol}: added {len(new_values)} new records (total: {len(full_data)})")
            else:
                print(f"No updates needed for {symbol}")


def YFinanceAPI(symbol, start_date=None, end_date=None, interval="1d"):
    """
    Fetch historical data from Yahoo Finance using yfinance.

    symbol (str): Ticker symbol (e.g., "ZQ=F", "^TNX", "AAPL")
    start_date (datetime): Start date for data (datetime object)
    end_date (datetime): End date for data (datetime object)
    interval (str): Data interval (1d, 1wk, 1mo, etc.)
                   Note: intraday data (1m, 5m, etc.) limited to last 60 days

    Returns a Dict with "status" and "values" keys for consistency with other APIs.
             Each value contains: datetime, open, high, low, close, volume
    """

    try:
        ticker = yf.Ticker(symbol)

        # Fetch historical data
        hist = ticker.history(
            start=start_date,
            end=end_date,
            interval=interval
        )

        if hist is None or hist.empty:
            return {
                "status": "ok",
                "values": []
            }

        # Convert DataFrame to list of dicts
        values = []
        intraday = interval.endswith(('m', 'h')) and not interval.endswith('mo')
        for date, row in hist.iterrows():
            # Handle timezone-aware datetime
            if intraday and date.tzinfo is not None:
                date = date.astimezone(datetime.UTC).replace(tzinfo=None)
            elif hasattr(date, 'tz') and date.tz is not None:
                date = date.tz_localize(None)

            values.append({
                "datetime": date.strftime("%Y-%m-%d %H:%M:%S" if intraday else "%Y-%m-%d"),
                "open": float(row["Open"]) if row["Open"] == row["Open"] else None,
                "high": float(row["High"]) if row["High"] == row["High"] else None,
                "low": float(row["Low"]) if row["Low"] == row["Low"] else None,
                "close": float(row["Close"]) if row["Close"] == row["Close"] else None,
                "volume": int(row["Volume"]) if row["Volume"] == row["Volume"] else 0
            })

        return {
            "status": "ok",
            "values": values
        }

    except Exception as e:
        return {
            "status": "error",
            "message": f"YFinance API error: {e!s}"
        }
