"""Shared utilities for data loading."""

from pathlib import Path

import numpy as np
import pandas as pd

from .config import ASSET_CONFIG


def get_asset_freq(asset_type: str) -> str:
    """Get the frequency string for a given asset type."""
    if asset_type not in ASSET_CONFIG:
        raise ValueError(f"Unknown asset type: {asset_type}")
    return ASSET_CONFIG[asset_type]["freq"]


def get_asset_path(asset_type: str) -> Path:
    """Find the processed parquet file for a given asset type."""
    data_dir = Path(__file__).resolve().parents[3] / "data" / asset_type / "processed"
    
    if not data_dir.exists():
        raise FileNotFoundError(f"Processed data directory not found: {data_dir}")
    
    parquet_files = list(data_dir.glob("*.parquet"))
    if not parquet_files:
        raise FileNotFoundError(f"No parquet files found in {data_dir}")
    
    return parquet_files[0]


def load_parquet_as_dataframe(asset_type: str) -> pd.DataFrame:
    """Load parquet data for an asset type."""
    path = get_asset_path(asset_type)
    df = pd.read_parquet(path)
    
    # Ensure datetime index
    if "datetime" in df.columns:
        df["datetime"] = pd.to_datetime(df["datetime"])
        df = df.set_index("datetime")
    elif "date" in df.columns:
        df["date"] = pd.to_datetime(df["date"])
        df = df.set_index("date")
    elif "timestamp" in df.columns:
        df["timestamp"] = pd.to_datetime(df["timestamp"])
        df = df.set_index("timestamp")
    
    return df


def get_feature_columns(
    config: dict,
    df: pd.DataFrame,
) -> tuple[list[str], list[str], list[str]]:
    """
    Get feature columns that exist in the dataframe.
    
    Returns:
        Tuple of (unknown_reals, known_reals, known_categoricals)
    """
    unknown_reals = [c for c in config.get("unknown_reals", []) if c in df.columns]
    known_reals = [c for c in config.get("known_reals", []) if c in df.columns]
    known_categoricals = [c for c in config.get("known_categoricals", []) if c in df.columns]
    
    return unknown_reals, known_reals, known_categoricals


def prepare_dataframe(
    df: pd.DataFrame,
    config: dict,
    target_col: str,
) -> pd.DataFrame:
    """
    Prepare dataframe for modeling:
    - Drop NaNs in target
    - Replace infinities
    - Cast floats to float32
    - Ensure lagged known-reals exist (auto-derive if needed)
    
    :param df: DataFrame to prepare
    :param config: Asset config with feature lists
    :param target_col: Target column name
    
    Returns:
        Prepared DataFrame
    """
    # Drop NaN in target
    df = df.dropna(subset=[target_col])
    
    # Ensure configured lagged known-reals exist. If missing, derive from base column.
    # This keeps volatility/volume_change explicitly lagged without requiring immediate
    # parquet regeneration.
    item_id_col = config.get("item_id_col")
    configured_known_reals = list(config.get("known_reals", []))
    
    cols_to_shift = []
    base_cols = []
    for col in configured_known_reals:
        if not col.endswith("_lag1") or col in df.columns:
            continue
        base_col = col[:-5]
        if base_col in df.columns:
            cols_to_shift.append(col)
            base_cols.append(base_col)
            
    if cols_to_shift:
        if item_id_col and item_id_col in df.columns:
            shifted = df.groupby(item_id_col, observed=True)[base_cols].shift(1)
            df[cols_to_shift] = shifted.to_numpy()
        else:
            shifted = df[base_cols].shift(1)
            df[cols_to_shift] = shifted.to_numpy()
    
    # Replace infinity with NaN
    df = df.replace([np.inf, -np.inf], np.nan)
    
    # Cast floats to float32 to save memory
    float_cols = df.select_dtypes(include=['float64']).columns
    df[float_cols] = df[float_cols].astype('float32')
    
    return df


def extract_features(
    group_df: pd.DataFrame,
    known_reals: list[str],
    known_categoricals: list[str],
    unknown_reals: list[str],
) -> tuple[np.ndarray, np.ndarray]:
    """
    Extract feature arrays from a group dataframe.
    
    :param group_df: DataFrame for a single time series
    :param known_reals: List of known real feature columns
    :param known_categoricals: List of known categorical feature columns
    :param unknown_reals: List of unknown real feature columns
    
    Returns:
        Tuple of (feat_dynamic_real, past_feat_dynamic_real)
        - feat_dynamic_real: Shape (num_features, length) - future-known features
        - past_feat_dynamic_real: Shape (num_features, length) - past-known features
    """
    # Known features (future known): reals + encoded categoricals
    # Shape: (num_features, length)
    feat_dynamic_real = []
    for c in known_reals:
        feat_dynamic_real.append(group_df[c].values)
    for c in known_categoricals:
        # We already converted to category in preprocessing
        feat_dynamic_real.append(group_df[c].cat.codes.values.astype(np.float32))
    
    # Unknown features (past known only): reals
    # Shape: (num_features, length)
    past_feat_dynamic_real = []
    for c in unknown_reals:
        past_feat_dynamic_real.append(group_df[c].values)
        
    return np.array(feat_dynamic_real, dtype=np.float32), np.array(past_feat_dynamic_real, dtype=np.float32)
