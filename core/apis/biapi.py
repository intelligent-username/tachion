"""
Binance API Call Utils
Note that Cryptos trade 24/7, so we need more total lines to cover ~5 years
"""

import datetime
import json
import os
import time

import requests

from core.apis.provider_errors import InvalidSymbolError, is_invalid_symbol

# For consistent API calls, I'm still going to use 30 minute intervals
# But don't want to type it as milliseconds
INTERVAL_MS = {
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    "30m": 1_800_000,
    "1h": 3_600_000,
    "4h": 14_400_000,
    "1d": 86_400_000,
    "1w": 604_800_000,
    "1M": 2_592_000_000,
}


def call_specific_binance(path, symbols, num_calls, rate_limit=50, json_indent=4, raise_on_invalid_symbol=False):
    """
    Make Specific Calls to the Binance API

    path: Directory path to write JSON files to
    symbols (list): List of symbols to fetch (e.g., ["BTC", "ETH"])
    num_calls (int): Number of API calls per symbol (each returns up to 1000 candles)
    rate_limit (int): Maximum API calls per minute (default 50)
    """

    # Rate limiting: calls per minute max
    calls_this_minute = 0
    minute_start = time.time()

    for symbol in symbols:
        curr_time = int(datetime.datetime.now().timestamp() * 1000)  # Binance uses milliseconds
        details = []

        # Binance returns max 1000 candles per call
        file_path = os.path.join(path, f"{symbol}.json")

        is_fresh = True

        if os.path.exists(file_path):
            try:
                with open(file_path, "r") as f:
                    data = json.load(f)

                if data:
                    latest_update_date = datetime.datetime.strptime(
                        data[-1]["datetime"], "%Y-%m-%d %H:%M:%S"
                    )
                    print(f"Found existing data for {symbol} up to {latest_update_date}. Updating...")
                    is_fresh = False

            except Exception as e:
                print(f"Could not parse existing file for {symbol}. Treating as fresh. Error: {e}")
                os.remove(file_path)
                is_fresh = True

        if is_fresh:
            for _ in range(num_calls):
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

                data = BinanceAPI(symbol=symbol, end_time=curr_time)

                if data.get("status") == "error":
                    if raise_on_invalid_symbol and data.get('error_kind') == 'invalid_symbol':
                        raise InvalidSymbolError(data.get('message', 'Invalid symbol'))
                    print(f"Error retrieving data for {symbol}: {data.get('message', '')}")
                    break

                batch = data.get("values", [])
                if not batch:
                    break

                details.extend(batch)

                # Move end_time back by 30 minutes before the oldest candle in batch
                oldest_dt = datetime.datetime.strptime(batch[0]["datetime"], "%Y-%m-%d %H:%M:%S")
                curr_time = int(oldest_dt.timestamp() * 1000) - 1

                if len(batch) < 1000:
                    break

            if details:
                # Sort chronologically (oldest first) and remove duplicates
                details.sort(key=lambda x: x["datetime"])
                seen = set()
                unique_details = []
                for d in details:
                    if d["datetime"] not in seen:
                        seen.add(d["datetime"])
                        unique_details.append(d)

                with open(file_path, "w") as f:
                    json.dump(unique_details, f, indent=json_indent)
                print(f"Wrote {len(unique_details)} records for {symbol} to {file_path}")
            else:
                print(f"No data collected for {symbol}")
        else:
            # Update existing data
            with open(file_path, "r") as f:
                existing_data = json.load(f)

            fmt = "%Y-%m-%d %H:%M:%S"
            last_dt = datetime.datetime.strptime(existing_data[-1]["datetime"], fmt)
            start_time = int(last_dt.timestamp() * 1000) + 1  # 1ms after last candle

            new_data = []

            while True:
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

                data = BinanceAPI(
                    symbol=symbol,
                    start_time=start_time
                )

                if data.get("status") == "error":
                    msg = data.get("message", "")
                    if msg and "no data" not in msg.lower():
                        print(f"Error fetching {symbol}: {msg}")
                    break

                batch = data.get("values", [])
                if not batch:
                    break

                # Keep only rows after last saved datetime
                batch = [row for row in batch if datetime.datetime.strptime(row["datetime"], fmt) > last_dt]

                if not batch:
                    break

                new_data.extend(batch)

                # Update start_time to after the newest candle
                newest_dt = datetime.datetime.strptime(batch[-1]["datetime"], fmt)
                start_time = int(newest_dt.timestamp() * 1000) + 1

                if len(batch) < 1000:
                    break

            # Append new data to existing and write
            if new_data:
                full_data = existing_data + new_data
                with open(file_path, "w") as f:
                    json.dump(full_data, f, indent=json_indent)
                print(f"Updated {symbol}: added {len(new_data)} new records (total: {len(full_data)})")
            else:
                print(f"No updates needed for {symbol}")


def BinanceAPI(url="https://api.binance.com/api/v3/klines",
               interval="30m", limit=1000, start_time=None, end_time=None, symbol=None):
    """
    Make a call to the Binance Klines (Candlestick) API

    url (str): Binance's REST API Endpoint for klines
    interval (str): Time interval for candlesticks.
            Must be one of the following values:
                1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M
    limit (int): How many data points to return. Maximum is 1000.
    start_time (int): Start time in milliseconds (Unix timestamp * 1000).
            If not provided, returns most recent candles.
    end_time (int): End time in milliseconds (Unix timestamp * 1000).
            Defaults to current time if not provided.
    symbol (str): The trading pair symbol (e.g., "BTC" will be converted to "BTCUSDT").
            For crypto, just input the base symbol (BTC, ETH, etc.)

    Returns a dict with "status" and "values" keys, matching TwelveData format for consistency.
            Each value contains: datetime, open, high, low, close, volume
    """

    if symbol is None:
        raise ValueError("Symbol can't be blank. Please provide a valid symbol.")

    # Convert symbol to Binance format (e.g., BTC -> BTCUSDT)
    binance_symbol = f"{symbol.upper()}USDT"

    params = {
        "symbol": binance_symbol,
        "interval": interval,
        "limit": limit,
    }

    if start_time is not None:
        params["startTime"] = start_time
    if end_time is not None:
        params["endTime"] = end_time

    try:
        response = requests.get(url, params=params, timeout=(3.05, 10))
        try:
            payload = response.json()
        except ValueError:
            payload = None
        if is_invalid_symbol('binance', response.status_code, payload):
            return {'status': 'error', 'message': payload.get('msg', 'Invalid symbol'),
                    'error_kind': 'invalid_symbol', 'provider_code': payload['code']}
        response.raise_for_status()
        raw_data = payload if payload is not None else response.json()

        # Check for Binance error response
        if isinstance(raw_data, dict) and "code" in raw_data:
            return {
                "status": "error",
                "message": raw_data.get("msg", "Unknown Binance API error")
            }

        # Transform Binance kline format to match TwelveData format
        # Binance kline: [open_time, open, high, low, close, volume, close_time, ...]
        values = []
        for candle in raw_data:
            open_time_ms = candle[0]
            dt = datetime.datetime.fromtimestamp(open_time_ms / 1000)

            values.append({
                "datetime": dt.strftime("%Y-%m-%d %H:%M:%S"),
                "open": float(candle[1]),
                "high": float(candle[2]),
                "low": float(candle[3]),
                "close": float(candle[4]),
                "volume": float(candle[5])
            })

        return {
            "status": "ok",
            "values": values
        }

    except requests.exceptions.HTTPError as e:
        return {
            "status": "error",
            "message": f"HTTP error: {e!s}"
        }
    except requests.exceptions.RequestException as e:
        return {
            "status": "error",
            "message": f"Request error: {e!s}"
        }
    except Exception as e:
        return {
            "status": "error",
            "message": f"Unexpected error: {e!s}"
        }
