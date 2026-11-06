"""
Forex prices
Calls the OANDA API to collect ~10 years of historical forex data
for selected currency pairs.
"""

from importlib import resources
from pathlib import Path

from core import call_specific_oanda


def write_data_fo(instruments):
    """
    Get ~175000 lines (35 API calls) worth of data for the given list of instruments
    Using 30 minute intervals.
    The caller will ensure everything is written in chronological order.
    Writes to data/forex/raw/
    """
    path = Path(__file__).resolve().parent / "raw"
    path.mkdir(parents=True, exist_ok=True)

    # OANDA returns max 5000 candles per call
    # 10 years × 365 days × 24 hours × 2 (30-min) = ~175,200 candles
    # ~175,200 / 5000 = ~35 calls
    num_calls = 35

    call_specific_oanda(str(path), instruments=instruments, num_calls=num_calls, json_indent=2)

    # JSON records are written chronologically (oldest to newest)

if __name__ == "__main__":
    # Forex currency pairs from currencies.txt

    print("Collecting forex data...")

    pkg = __package__  # should be 'data.forex'
    txt = resources.files(pkg).joinpath('currencies.txt')
    with txt.open('r') as f:
        currencies = []
        for line in f:
            line = line.split("#")[0].strip()  # Strip inline comments
            if line:
                currencies.append(line)  # OANDA format: EUR_USD, GBP_USD, etc.

    print(f"Found {len(currencies)} currency pairs to collect.")
    write_data_fo(currencies)

    print("Finished collecting forex data.")
