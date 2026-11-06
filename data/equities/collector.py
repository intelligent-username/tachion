"""
Stock prices and S&P500 data collector
Calls the TwelveData API to collect information for the past ~15000 lines (about 5 years of TRADING DAYS)
(or less if not available) for the 79 stocks selected stocks.
It then collects the past ~15000 lines of S&P500 index data.
All data is written into CSVs in the raw/ directory.
"""

from importlib import resources
from pathlib import Path

from core import call_specific_td


def write_data_eq(symbols):
    """
    Writes data for equities and S&P500 index.
    Get ~15000 lines (3 API calls) worth of data for the given list of symbols and S&P500 index
    Using 30 minute intervals.
    The caller will ensure everything is written in chronological order.
    Writes to data/equities/raw/
    """
    path = Path(__file__).resolve().parent / "raw"
    path.mkdir(parents=True, exist_ok=True)

    # This is for equities specifically, need ~15k
    num_calls = 3

    call_specific_td(str(path), symbols=["SPY"], num_calls = num_calls, json_indent=2)
    call_specific_td(str(path), symbols=symbols, num_calls = num_calls, json_indent=2)

    # note that the JSON records are written chronologically from newest to oldest
    # In the feature engineering (CSVs), remember to read backwards

if __name__ == "__main__":
    # 5 companies from each of the 11 S&P sectors
    # 9 more "important" large S&P companies for broader market conditions
    # And 15 "smaller" companies for variance injection
    # And of course the S&P data

    # For a total of 80

    print("Collecting data...")

    # Load companies.txt from package resources
    pkg = __package__  # should be 'data.equities'
    txt = resources.files(pkg).joinpath('companies.txt')
    with txt.open('r') as f:
        companies = [line.rstrip("\n") for line in f if line.strip() and not line.lstrip().startswith('#')]

    write_data_eq(companies)

    print("Finished collecting data.")
    