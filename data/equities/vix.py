"""
Collect VIX data from FRED and compute daily log changes.
"""

import datetime
import json
import math
import os
from pathlib import Path

from dotenv import load_dotenv
from fredapi import Fred

load_dotenv()

def write_vix_delta():
    """
    Fetch VIX data from FRED, compute ΔVIX = log(VIX_t / VIX_t-1),
    and write to data/raw/vix/VIX_Delta.json
    """

    path = Path(__file__).resolve().parent.parent / "raw" / "vix"
    path.mkdir(parents=True, exist_ok=True)
    file_path = path / "VIX_Delta.json"

    api_key = os.getenv("FRED_KEY")
    if not api_key:
        raise ValueError("FRED_KEY (the api key) not found in environment variables.")

    fred = Fred(api_key=api_key)

    # Series ID for VIX
    series_id = "VIXCLS"

    # Start from May 1, 2021
    start_date = datetime.datetime(2021, 5, 1)
    end_date = datetime.datetime.now()

    # Fetch series
    series = fred.get_series(series_id, observation_start=start_date, observation_end=end_date)

    if series is None or series.empty:
        raise ValueError("No VIX data returned from FRED.")

    # Ensure chronological order
    series = series.sort_index()

    # Compute ΔVIX = log(VIX_t / VIX_t-1)
    records = []
    prev_value = None
    for date, value in series.items():
        if value != value:  # skip NaN
            continue
        if prev_value is None:
            prev_value = value
            continue
        delta_vix = math.log(value / prev_value)
        records.append({
            "ticker": "VIX",
            "date": date.strftime("%Y-%m-%d"),
            "delta_vix": delta_vix
        })
        prev_value = value

    # Write JSON
    with file_path.open("w") as f:
        json.dump(records, f, indent=4)

    print(f"Wrote {len(records)} ΔVIX records to {file_path}")


if __name__ == "__main__":
    write_vix_delta()
