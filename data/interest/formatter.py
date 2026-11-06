import json
from pathlib import Path

import pandas as pd


def load_json_monthly(path, value_col):
    """
    Load JSON time series, resample to month-end, and rename value column.
    """
    with open(path, "r") as f:
        df = pd.DataFrame(json.load(f))
    df["datetime"] = pd.to_datetime(df["datetime"])
    df = df.set_index("datetime").resample("M").last()
    df.index = df.index.to_period("M").to_timestamp("M")
    return df.rename(columns={"value": value_col})


def load_csv_monthly(path, date_col, value_col):
    """
    Load CSV time series, keep only month-end values, and rename column.
    """
    df = pd.read_csv(path)
    df.columns = df.columns.str.strip()
    df[date_col] = pd.to_datetime(df[date_col])
    df = df[[date_col, value_col]]
    df = df.set_index(date_col).resample("M").last()
    df.index = df.index.to_period("M").to_timestamp("M")
    return df.rename(columns={value_col: value_col})


def process_interest_features(raw_dir, out_path):
    """
    Construct the final 7 interest and macro features plus Fed target class.
    Saves merged features as Parquet for ML.
    """
    raw_dir = Path(raw_dir)

    # Core PCE 1-month annualized
    pce = load_json_monthly(raw_dir / "PCEPILFE.json", "PCE_Index")
    pce["Core_PCE_1M_Ann"] = pce["PCE_Index"].pct_change(1) * 12

    # Unemployment gap
    unrate = load_json_monthly(raw_dir / "UNRATE.json", "UNRATE")
    nrou = load_json_monthly(raw_dir / "NROU.json", "NROU")
    unrate["Unemployment_Gap"] = unrate["UNRATE"] - nrou["NROU"]

    # CPI surprise
    df_exp = load_csv_monthly(raw_dir / "Expected_Inflation.csv",
                              "Model Output Date", "1 year Expected Inflation")
    df_actual = load_json_monthly(raw_dir / "PCEPILFE.json", "PCE_Index")
    df_actual["YoY"] = df_actual["PCE_Index"].pct_change(12)
    df_exp = df_exp.rename(columns={"1 year Expected Inflation": "Exp_Infl_1Y"})
    cpi_surprise = df_actual.join(df_exp, how="inner")
    cpi_surprise["CPI_Surprise_Proxy"] = cpi_surprise["YoY"] - cpi_surprise["Exp_Infl_1Y"]

    # Yield curve spreads
    gs3m = load_json_monthly(raw_dir / "GS3M.json", "GS3M")
    gs2 = load_json_monthly(raw_dir / "GS2.json", "GS2")
    gs10 = load_json_monthly(raw_dir / "GS10.json", "GS10")
    spreads = gs3m.join(gs2, how="inner").join(gs10, how="inner")
    spreads["Spread_3M_2Y"] = spreads["GS3M"] - spreads["GS2"]
    spreads["Spread_2Y_10Y"] = spreads["GS2"] - spreads["GS10"]

    # Financial conditions index (NFCI)
    nfci = load_json_monthly(raw_dir / "NFCI.json", "Fin_Cond_Ind")

    # Fed's neutral rate estimate
    dfedtaru = load_json_monthly(raw_dir / "DFEDTARU.json", "DFEDTARU")

    # Compute Fed target class: cut/hold/hike
    fed_target = dfedtaru[["DFEDTARU"]].copy()
    fed_target["delta"] = fed_target["DFEDTARU"].diff()
    fed_target["Fed_Target"] = fed_target["delta"].apply(
        lambda x: "cut" if x < 0 else "hike" if x > 0 else "hold"
    )

    # Merge all features in chronological order
    df_final = pd.concat([
        pce["Core_PCE_1M_Ann"],
        unrate["Unemployment_Gap"],
        cpi_surprise["CPI_Surprise_Proxy"],
        spreads[["Spread_3M_2Y", "Spread_2Y_10Y"]],
        nfci["Fin_Cond_Ind"],
        dfedtaru["DFEDTARU"],
        fed_target["Fed_Target"]
    ], axis=1, join="inner").dropna()

    # Sort by date ascending
    df_final = df_final.sort_index()

    # Save as Parquet
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    df_final.reset_index().rename(columns={"datetime": "date"}).to_parquet(
        out_path, index=False
    )

    print(f"Interest features with Fed target saved to {out_path}")


if __name__ == "__main__":

    pkg = __package__  # e.g., 'data.interest'
    raw_dir = Path(__file__).resolve().parent / "raw"
    out_path = Path(__file__).resolve().parent / "processed" / "interest_processed.parquet"

    process_interest_features(raw_dir, out_path)
