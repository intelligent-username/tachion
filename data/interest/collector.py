"""
Interest Rate and Macroeconomic Indicators Collector

Collects data from two sources:
1. FRED (Federal Reserve Economic Data) - for economic indicators like:
   - PCEPILFE: Personal Consumption Expenditures (inflation measure)
   - UNRATE: Unemployment Rate
   - NROU: Noncyclical Rate of Unemployment  
   - GS3M: 3-Month Treasury yield
   - GS2: 2-Year Treasury yield
   - GS10: 10-Year Treasury yield
   - NFCI: National Financial Conditions Index
   - DFEDTARU: Federal Funds Target Rate Upper Bound

Also computes:
   - Spread_3M_2Y = GS3M - GS2
   - Spread_2Y_10Y = GS2 - GS10
"""

import json
from pathlib import Path

import pandas as pd
from core import call_specific_fred


def collect_fred_data(series_ids):
    path = Path(__file__).resolve().parent / "raw"
    path.mkdir(parents=True, exist_ok=True)

    call_specific_fred(str(path), series_ids=series_ids)

    gs3m_file = path / "GS3M.json"
    gs2_file = path / "GS2.json"
    gs10_file = path / "GS10.json"

    if all(f.exists() for f in [gs3m_file, gs2_file, gs10_file]):
        with gs3m_file.open("r") as f:
            df_3m = pd.DataFrame(json.load(f))
            df_3m['DATE'] = pd.to_datetime(df_3m['datetime'])
            df_3m.set_index('DATE', inplace=True)
            df_3m.rename(columns={'value':'GS3M'}, inplace=True)

        with gs2_file.open("r") as f:
            df_2y = pd.DataFrame(json.load(f))
            df_2y['DATE'] = pd.to_datetime(df_2y['datetime'])
            df_2y.set_index('DATE', inplace=True)
            df_2y.rename(columns={'value':'GS2'}, inplace=True)

        with gs10_file.open("r") as f:
            df_10y = pd.DataFrame(json.load(f))
            df_10y['DATE'] = pd.to_datetime(df_10y['datetime'])
            df_10y.set_index('DATE', inplace=True)
            df_10y.rename(columns={'value':'GS10'}, inplace=True)

        # Align on dates
        df = pd.concat([df_3m, df_2y, df_10y], axis=1, join='inner')

        # Compute spreads
        df['Spread_3M_2Y'] = df['GS3M'] - df['GS2']
        df['Spread_2Y_10Y'] = df['GS2'] - df['GS10']

        df[['Spread_3M_2Y', 'Spread_2Y_10Y']].to_csv(path / "YieldCurveSpreads.csv")
        print("Yield curve spreads computed and saved.")


def collect_clevelandfed_inflation():
    """
    Fetch expected inflation and real interest rates from Cleveland Fed.
    Originally provided as an Excel Sheet.
    Saves two CSVs in raw/ as csv.
    """
    url = "https://www.clevelandfed.org/-/media/files/webcharts/inflationexpectations/inflation-expectations.xlsx?sc_lang=en&hash=C27818913D96CEDD80E3136B9946CFA7"
    path = Path(__file__).resolve().parent / "raw"
    path.mkdir(parents=True, exist_ok=True)

    # Expected Inflation
    expected_inflation = pd.read_excel(url, sheet_name="Expected Inflation")
    expected_inflation.to_csv(path / "Expected_Inflation.csv", index=False)

    # Real Interest Rate
    real_rate = pd.read_excel(url, sheet_name="Real Interest Rate")
    real_rate.to_csv(path / "Real_Interest_Rate.csv", index=False)

    print("Cleveland Fed expected inflation and real rate CSVs saved.")


def compute_cpi_surprise(pce_json_path, expected_csv_path, out_json_path):
    """
    Compute CPI Surprise Proxy = Actual YoY PCE inflation - Expected 1Y inflation
    Saves JSON records with 'date' and 'CPI_Surprise_Proxy'.
    """
    # --- Actual PCE ---
    with open(pce_json_path, "r") as f:
        df_actual = pd.DataFrame(json.load(f))
    df_actual["datetime"] = pd.to_datetime(df_actual["datetime"])
    df_actual = df_actual.set_index("datetime").resample("M").last()
    df_actual.index = df_actual.index.to_period("M").to_timestamp("M")
    df_actual["YoY"] = df_actual["value"].pct_change(12)

    # --- Expected 1Y inflation ---
    df_exp = pd.read_csv(expected_csv_path)
    df_exp.columns = df_exp.columns.str.strip()  # remove leading/trailing spaces
    df_exp = df_exp[["Model Output Date", "1 year Expected Inflation"]]
    df_exp["Model Output Date"] = pd.to_datetime(df_exp["Model Output Date"])
    df_exp = df_exp.set_index("Model Output Date")
    df_exp = df_exp.rename(columns={"1 year Expected Inflation": "Exp_Infl_1Y"})
    df_exp.index = df_exp.index.to_period("M").to_timestamp("M")

    # --- Align and compute ---
    df = df_actual.join(df_exp, how="inner")
    df["CPI_Surprise_Proxy"] = df["YoY"] - df["Exp_Infl_1Y"]

    # --- Save JSON ---
    records = (
        df[["CPI_Surprise_Proxy"]]
        .dropna()
        .reset_index()
        .rename(columns={"datetime": "date"})
        .to_dict(orient="records")
    )

    out_json_path = Path(out_json_path)
    out_json_path.parent.mkdir(parents=True, exist_ok=True)

    with out_json_path.open("w") as f:
        json.dump(records, f, indent=2, default=str)


def collect():
    """
    Gather all interest rate and macro data.
    Reads tickers from fred_tickers.txt
    """
    # Tickers
    fred_tickers = []
    tickers_file = Path(__file__).resolve().parent / "fred_tickers.txt"
    with tickers_file.open("r") as f:
        for line in f:
            line = line.split("#")[0].strip()  # Strip inline comments
            if line:
                fred_tickers.append(line)

    print(f"Collecting {len(fred_tickers)} FRED series...")
    collect_fred_data(fred_tickers)

    collect_clevelandfed_inflation()

    compute_cpi_surprise(
        pce_json_path=Path(__file__).resolve().parent / "raw" / "PCEPILFE.json",
        expected_csv_path=Path(__file__).resolve().parent / "raw" / "Expected_Inflation.csv",
        out_json_path=Path(__file__).resolve().parent / "raw" / "CPI_Surprise_Proxy.json"
    )


if __name__ == "__main__":
    print("Collecting macroeconomic data from FRED...")
    collect()
