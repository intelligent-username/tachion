"""
Crypto prices
Calls the Binance API to collect information for the past 5 years
(or less if not available) for selected cryptocurrencies.
BTC will be used as a lagging covariate for broader market crypto conditions.
"""

# Careful in the model definition to not let BTC leak future information into other cryptos

from importlib import resources
from pathlib import Path

from core import call_specific_binance


def write_data_cr(symbols):
    """
    Get ~87000 lines (87 API calls) worth of data for the given list of symbols
    Using 30 minute intervals.
    The caller will ensure everything is written in chronological order.
    Writes to data/crypto/raw/
    """
    path = Path(__file__).resolve().parent / "raw"
    path.mkdir(parents=True, exist_ok=True)

    # Binance returns max 1000 candles per call, need 87 calls for 87k
    num_calls = 87

    # Note that the API limits are WAY higher (6000 weights per minute, aka 100 weights per second. Each call is 2 weights, so 50 calls per second)
    # So we won't HAVE TO wait at all.

    call_specific_binance(str(path), symbols=symbols, num_calls=num_calls, json_indent=2)

    # JSON records are written chronologically (oldest to newest)


if __name__ == "__main__":
    # A total of 30 coins

    print("Collecting data...")

    pkg = __package__  # should be 'data.crypto'
    txt = resources.files(pkg).joinpath('coins.txt')
    with txt.open('r') as f:
        coins = []
        for line in f:
            line = line.split("#")[0].strip()  # Strip inline comments
            if line:
                coins.append(line)  # Binance format: just the symbol (BTC, ETH, etc.)

    write_data_cr(coins)

    print("Finished collecting data.")
