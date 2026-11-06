

"""
Commodity prices
Calls the OANDA API to collect ~10 years of historical commodity data
for Gold, Silver, and Oil.
"""

from importlib import resources
from pathlib import Path

from core import call_specific_oanda


def write_data_co(instruments):
    """
    Get ~175000 lines (35 API calls) worth of data for the given list of instruments
    Using 30 minute intervals (M30 granularity).
    The caller will ensure everything is written in chronological order.
    Writes to data/comm/raw/
    """
    path = Path(__file__).resolve().parent / "raw"
    path.mkdir(parents=True, exist_ok=True)

    # 5000 candles per call
    # 15 years × 260 days × 23 hours × 2 (30-min) = ~180,000 candles
    # ~180,000 / 5000 = ~36 calls
    num_calls = 36

    call_specific_oanda(str(path), instruments=instruments, num_calls=num_calls, json_indent=2)

    # JSON records are written chronologically (oldest to newest)


if __name__ == "__main__":
    # Commodity instruments from comms.txt

    print("Collecting commodity data...")

    pkg = __package__  # should be 'data.comm'
    txt = resources.files(pkg).joinpath('comms.txt')
    with txt.open('r') as f:
        commodities = []
        for line in f:
            line = line.split("#")[0].strip()
            if line:
                commodities.append(line)

    print(f"Found {len(commodities)} commodities to collect: {commodities}")
    write_data_co(commodities)

