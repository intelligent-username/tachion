"""
FRED (Federal Reserve Economic Data) API Call Utils.

Note that the fredapi doesn't nicely handle rate limits.
The limit is 120 per minute, so let's stop at 119 and calculate the time required to sleep.
The nice thing is that a single call can return 100,000+ observations.
FRED data is typically daily/monthly, so no pagination needed for 15 years.
"""

import datetime
import json
import os
import time

from dotenv import load_dotenv
from fredapi import Fred

load_dotenv()


def call_specific_fred(path, series_ids, rate_limit=119):
    """
    Fetch FRED series data and write to JSON files.

    path: Directory path to write JSON files to
    series_ids (list): List of FRED series IDs (e.g., ["UNRATE", "GS2"])
    rate_limit (int): Maximum API calls per minute (default 119, FRED limit is 120)
    """

    api_key = os.getenv("FRED_KEY")
    if not api_key:
        raise ValueError("FRED_KEY not found in environment variables. Please set it in .env file.")

    fred = Fred(api_key=api_key)

    # Rate limiting
    calls_this_minute = 0
    minute_start = time.time()

    # Date range
    end_date = datetime.datetime.now()

    for series_id in series_ids:
        # Reset start_date for each symbol (15 years back)
        start_date = end_date - datetime.timedelta(days=15 * 365)
        
        file_path = os.path.join(path, f"{series_id}.json")

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
                    print(f"Found existing data for {series_id} up to {latest_date.date()}. Updating...")
                    is_fresh = False
                    start_date = latest_date + datetime.timedelta(days=1)

            except Exception as e:
                print(f"Could not parse existing file for {series_id}. Treating as fresh. Error: {e}")
                os.remove(file_path)
                is_fresh = True
                existing_data = []

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

        data = FredAPI(fred, series_id=series_id, start_date=start_date, end_date=end_date)

        if data.get("status") == "error":
            print(f"Error retrieving data for {series_id}: {data.get('message', '')}")
            continue

        new_values = data.get("values", [])

        if not new_values:
            if is_fresh:
                print(f"No data available for {series_id}")
            else:
                print(f"No updates needed for {series_id}")
            continue

        if is_fresh:
            # Write fresh data
            os.makedirs(os.path.dirname(file_path), exist_ok=True)

            with open(file_path, "w") as f:
                json.dump(new_values, f, indent=4)
            print(f"Wrote {len(new_values)} records for {series_id} to {file_path}")
        else:
            # Append new data to existing
            # Filter out any duplicates
            existing_dates = {d["datetime"] for d in existing_data}
            new_values = [v for v in new_values if v["datetime"] not in existing_dates]

            if new_values:
                full_data = existing_data + new_values
                with open(file_path, "w") as f:
                    json.dump(full_data, f, indent=4)
                print(f"Updated {series_id}: added {len(new_values)} new records (total: {len(full_data)})")
            else:
                print(f"No updates needed for {series_id}")


def FredAPI(fred, series_id, start_date=None, end_date=None):
    """
    Fetch a FRED series using the fredapi library.

    fred: Fred instance (already authenticated)
    series_id (str): FRED series ID (e.g., "UNRATE", "T10Y2Y")
    start_date (datetime): Start date for data (datetime object)
    end_date (datetime): End date for data (datetime object)

    Returns a Dict with "status" and "values" keys for consistency with other APIs.
             Each value contains: datetime, value
    """

    try:
        # Fetch series data
        series = fred.get_series(
            series_id,
            observation_start=start_date,
            observation_end=end_date
        )

        if series is None or series.empty:
            return {
                "status": "ok",
                "values": []
            }

        # Convert pandas Series to list of dicts
        values = []
        for date, value in series.items():
            # Skip NaN values
            if value != value:  # NaN check
                continue

            values.append({
                "datetime": date.strftime("%Y-%m-%d"),
                "value": float(value)
            })

        return {
            "status": "ok",
            "values": values
        }

    except Exception as e:
        return {
            "status": "error",
            "message": f"FRED API error: {e!s}"
        }
