"""
OANDA API Call Utils
For Forex and Commodity data collection - 10 years and 15 years of historical data respectively
"""

import datetime
import json
import os
import re
import time

import requests
from dotenv import load_dotenv

load_dotenv()


def get_oanda_forex_instruments():
    """Return only currency-pair identities from the configured account."""
    token = os.getenv('OANDA_KEY', '').strip()
    account_id = os.getenv('OANDA_ACCOUNT_ID', '').strip()
    if not token or not account_id:
        raise ValueError('Currency directory is not configured.')

    response = requests.get(
        f'https://api-fxpractice.oanda.com/v3/accounts/{account_id}/instruments',
        headers={'Authorization': f'Bearer {token}'},
        timeout=(3.05, 10),
    )
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict) or not isinstance(payload.get('instruments'), list):
        raise TypeError('Invalid currency directory response.')

    pairs = {}
    for instrument in payload['instruments']:
        if not isinstance(instrument, dict) or instrument.get('type') != 'CURRENCY':
            continue
        symbol = instrument.get('name')
        if not isinstance(symbol, str) or not re.fullmatch(r'[A-Z]{3}_[A-Z]{3}', symbol):
            continue
        base, quote = symbol.split('_')
        if base != quote:
            pairs[symbol] = {'symbol': symbol, 'base': base, 'quote': quote}
    if not pairs:
        raise ValueError('No currency instruments in directory.')
    return [pairs[symbol] for symbol in sorted(pairs)]


def call_specific_oanda(path, instruments, num_calls, rate_limit=30, json_indent=4):
    """
    Make Specific Calls to the OANDA API using a persistent session

    path: Directory path to write JSON files to
    instruments (list): List of instruments to fetch (e.g., ["EUR_USD", "GBP_USD"])
    num_calls (int): Number of API calls per instrument (each returns up to 5000 candles)
    rate_limit (int): Maximum API calls per second (default 30, conservative for OANDA)
    """

    # Get token once
    token = os.getenv("OANDA_KEY")
    if not token:
        raise ValueError("OANDA_KEY not found in environment. Please set it in your .env file.")

    # Create persistent session with auth headers
    session = requests.Session()
    session.headers.update({
        "Authorization": f"Bearer {token}",
        "Accept-Datetime-Format": "RFC3339"
    })

    # Rate limiting: calls per second
    calls_this_second = 0
    second_start = time.time()

    for instrument in instruments:
        curr_time = datetime.datetime.now(datetime.UTC)
        details = []

        # OANDA returns max 5000 candles per call
        file_path = os.path.join(path, f"{instrument}.json")

        is_fresh = True

        if os.path.exists(file_path):
            try:
                with open(file_path, "r") as f:
                    data = json.load(f)

                if data:
                    latest_update_date = datetime.datetime.strptime(
                        data[-1]["datetime"], "%Y-%m-%d %H:%M:%S"
                    )
                    print(f"Found existing data for {instrument} up to {latest_update_date}. Updating...")
                    is_fresh = False

            except Exception as e:
                print(f"Could not parse existing file for {instrument}. Treating as fresh. Error: {e}")
                os.remove(file_path)
                is_fresh = True

        if is_fresh:
            for i in range(num_calls):
                # Rate limit check (per second for OANDA)
                calls_this_second += 1
                if calls_this_second >= rate_limit:
                    elapsed = time.time() - second_start
                    if elapsed < 1:
                        sleep_time = 1 - elapsed + 0.1
                        time.sleep(sleep_time)
                    calls_this_second = 0
                    second_start = time.time()

                data = OandaAPI(instrument=instrument, to_time=curr_time, session=session)

                if data.get("status") == "error":
                    print(f"Error retrieving data for {instrument}: {data.get('message', '')}")
                    break

                batch = data.get("values", [])
                if not batch:
                    break

                details.extend(batch)

                # Move to_time back before the oldest candle in batch
                oldest_dt = datetime.datetime.strptime(batch[0]["datetime"], "%Y-%m-%d %H:%M:%S")
                curr_time = oldest_dt.replace(tzinfo=datetime.UTC) - datetime.timedelta(minutes=1)

                # Progress indicator every 10 calls
                if (i + 1) % 10 == 0:
                    print(f"  {instrument}: {i + 1}/{num_calls} calls completed...")

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
                print(f"Wrote {len(unique_details)} records for {instrument} to {file_path}")
            else:
                print(f"No data collected for {instrument}")
        else:
            # Update existing data
            with open(file_path, "r") as f:
                existing_data = json.load(f)

            fmt = "%Y-%m-%d %H:%M:%S"
            last_dt = datetime.datetime.strptime(existing_data[-1]["datetime"], fmt)
            from_time = last_dt.replace(tzinfo=datetime.UTC) + datetime.timedelta(minutes=1)

            new_data = []

            while True:
                # Rate limit check
                calls_this_second += 1
                if calls_this_second >= rate_limit:
                    elapsed = time.time() - second_start
                    if elapsed < 1:
                        sleep_time = 1 - elapsed + 0.1
                        time.sleep(sleep_time)
                    calls_this_second = 0
                    second_start = time.time()

                data = OandaAPI(
                    instrument=instrument,
                    from_time=from_time,
                    session=session
                )

                if data.get("status") == "error":
                    msg = data.get("message", "")
                    if msg and "no data" not in msg.lower():
                        print(f"Error fetching {instrument}: {msg}")
                    break

                batch = data.get("values", [])
                if not batch:
                    break

                # Keep only rows after last saved datetime
                batch = [row for row in batch if datetime.datetime.strptime(row["datetime"], fmt) > last_dt]

                if not batch:
                    break

                new_data.extend(batch)

                # Update from_time to after the newest candle
                newest_dt = datetime.datetime.strptime(batch[-1]["datetime"], fmt)
                from_time = newest_dt.replace(tzinfo=datetime.UTC) + datetime.timedelta(minutes=1)

                if len(batch) < 5000:
                    break

            # Append new data to existing and write
            if new_data:
                full_data = existing_data + new_data
                with open(file_path, "w") as f:
                    json.dump(full_data, f, indent=json_indent)
                print(f"Updated {instrument}: added {len(new_data)} new records (total: {len(full_data)})")
            else:
                print(f"No updates needed for {instrument}")


def OandaAPI(url_base="https://api-fxpractice.oanda.com/v3/instruments",
             granularity="M30", count=5000, from_time=None, to_time=None, 
             token=None, instrument=None, session=None):
    """
    Make a call to the OANDA Candles API

    url_base (str): OANDA's REST API base endpoint for instruments
    granularity (str): Time interval for candlesticks.
            Must be one of the following values:
                S5, S10, S15, S30 (seconds)
                M1, M2, M4, M5, M10, M15, M30 (minutes)
                H1, H2, H3, H4, H6, H8, H12 (hours)
                D (day), W (week), M (month)
    count (int): How many data points to return. Maximum is 5000.
    from_time (datetime): Start time as datetime object (UTC).
            If not provided, returns most recent candles.
    to_time (datetime): End time as datetime object (UTC).
            Defaults to current time if not provided.
    token (str): OANDA API token. Will use environment variable OANDA_KEY if not provided.
    instrument (str): The currency pair (e.g., "EUR_USD", "GBP_USD").

    Returns a Dict with "status" and "values" keys, matching TwelveData format for consistency.
            Each value contains: datetime, open, high, low, close, volume
    """

    if instrument is None:
        raise ValueError("Instrument can't be blank. Please provide a valid instrument (e.g., EUR_USD).")

    url = f"{url_base}/{instrument}/candles"

    params = {
        "granularity": granularity,
        "count": count,
        "price": "M"  # Midpoint prices
    }

    if from_time is not None:
        params["from"] = from_time.strftime("%Y-%m-%dT%H:%M:%SZ")
    if to_time is not None:
        params["to"] = to_time.strftime("%Y-%m-%dT%H:%M:%SZ")

    try:
        # Use provided session for persistent connection, or create new request
        if session is not None:
            response = session.get(url, params=params)
        else:
            # Fallback: create headers and make single request
            if token is None:
                token = os.getenv("OANDA_KEY")
            if not token:
                raise ValueError("OANDA_KEY not found in environment. Please set it in your .env file.")
            headers = {
                "Authorization": f"Bearer {token}",
                "Accept-Datetime-Format": "RFC3339"
            }
            response = requests.get(url, headers=headers, params=params)
        
        # Handle rate limiting
        if response.status_code == 429:
            return {
                "status": "error",
                "message": "Rate limit exceeded. Please slow down requests."
            }
        
        response.raise_for_status()
        raw_data = response.json()

        # Check for OANDA error response
        if "errorMessage" in raw_data:
            return {
                "status": "error",
                "message": raw_data.get("errorMessage", "Unknown OANDA API error")
            }

        candles = raw_data.get("candles", [])
        
        # Transform OANDA candle format to match TwelveData format
        values = []
        for candle in candles:
            if not candle.get("complete", False):
                continue  # Skip incomplete candles
                
            time_str = candle["time"]
            # Parse RFC3339 format
            dt = datetime.datetime.fromisoformat(time_str)
            
            mid = candle.get("mid", {})
            
            values.append({
                "datetime": dt.strftime("%Y-%m-%d %H:%M:%S"),
                "open": float(mid.get("o", 0.0)),
                "high": float(mid.get("h", 0.0)),
                "low": float(mid.get("l", 0.0)),
                "close": float(mid.get("c", 0.0)),
                "volume": float(candle.get("volume", 0.0))
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
    except ValueError:
        raise
    # except Exception as e:
    #     return {
    #         "status": "error",
    #         "message": f"Unexpected error: {str(e)}"
    #     }
