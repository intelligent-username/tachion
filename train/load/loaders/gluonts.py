"""GluonTS data loader."""


import numpy as np
import pandas as pd
from gluonts.dataset.common import ListDataset

# Try to import CachingDataset for in-memory caching
try:
    from gluonts.dataset.common import CachingDataset
    HAS_CACHING = True
except ImportError:
    HAS_CACHING = False

from .common import extract_features, get_feature_columns, load_parquet_as_dataframe
from .config import ASSET_CONFIG


def load_gluonts_dataset(
    asset_type: str,
    prediction_length: int = 24,
    val_split: float = 0.1,
) -> tuple[ListDataset, ListDataset]:
    """
    Load parquet data and convert to GluonTS ListDataset format.
    
    Returns train and test datasets where test includes the full series
    and train has the last prediction_length steps removed.
    
    :param asset_type: Asset type to load
    :param prediction_length: Forecast horizon (also determines test hold-out)
    :param val_split: Fraction of data to use for validation
    
    Returns a tuple of (train_dataset, test_dataset)
    """
    config = ASSET_CONFIG.get(asset_type)
    if config is None:
        raise ValueError(f"Unknown asset type: {asset_type}")
    
    freq = config["freq"]
    target_col = config["target_col"]
    item_id_col = config.get("item_id_col")
    
    df = load_parquet_as_dataframe(asset_type)
    
    # Drop NaN in target
    df = df.dropna(subset=[target_col])
    
    # Feature columns
    unknown_reals, known_reals, known_categoricals = get_feature_columns(config, df)

    # Pre-encode categoricals efficiently
    for c in known_categoricals:
        df[c] = df[c].astype('category')
    
    if item_id_col and item_id_col in df.columns:
        # Multiple time series
        series_list = []
        for item_id, group in df.groupby(item_id_col):
            group = group.sort_index()
            target = group[target_col].values
            start = group.index[0]
            
            fdr, pfdr = extract_features(group, known_reals, known_categoricals, unknown_reals)
            
            entry = {
                "target": target,
                "start": pd.Period(start, freq=freq),
                "item_id": str(item_id),
            }
            if fdr.size > 0: entry["feat_dynamic_real"] = fdr
            if pfdr.size > 0: entry["past_feat_dynamic_real"] = pfdr
            series_list.append(entry)
    else:
        # Single time series
        df = df.sort_index()
        target = df[target_col].values
        start = df.index[0]
        
        fdr, pfdr = extract_features(df, known_reals, known_categoricals, unknown_reals)
        
        entry = {
            "target": target,
            "start": pd.Period(start, freq=freq),
            "item_id": "main",
        }
        if fdr.size > 0: entry["feat_dynamic_real"] = fdr
        if pfdr.size > 0: entry["past_feat_dynamic_real"] = pfdr
        series_list = [entry]
    
    # Split: train has last prediction_length removed from each series
    train_data = []
    test_data = []
    
    for series in series_list:
        full_target = series["target"]
        n = len(full_target)
        
        # For very short series, skip
        if n < prediction_length * 2:
            continue
        
        # Optimize: use contiguous float32 arrays for faster GPU transfer
        full_target_opt = np.ascontiguousarray(full_target, dtype=np.float32)
        train_target_opt = np.ascontiguousarray(full_target[:-prediction_length], dtype=np.float32)
        
        # Train removes the last prediction_length points
        # Slice features for train
        train_entry = {
            "target": train_target_opt,
            "start": series["start"],
            "item_id": series["item_id"],
        }
        test_entry = {
            "target": full_target_opt,
            "start": series["start"],
            "item_id": series["item_id"],
        }
        
        if "feat_dynamic_real" in series:
            fdr = series["feat_dynamic_real"]
            test_entry["feat_dynamic_real"] = fdr
            # Train needs full future features (if known)? Usually standard DeepAR uses future known features
            # But the 'target' is cut short. The features should match the target length + prediction_length?
            # Actually standard practice: provide full features, cut target.
            train_entry["feat_dynamic_real"] = fdr[:, :-prediction_length] # Cut to match target length for now to be safe
            
        if "past_feat_dynamic_real" in series:
            pfdr = series["past_feat_dynamic_real"]
            test_entry["past_feat_dynamic_real"] = pfdr
            train_entry["past_feat_dynamic_real"] = pfdr[:, :-prediction_length]

        test_data.append(test_entry)
        train_data.append(train_entry)
    
    train_ds = ListDataset(train_data, freq=freq)
    test_ds = ListDataset(test_data, freq=freq)
    
    # Wrap with CachingDataset if available - caches transformed data in memory
    if HAS_CACHING:
        train_ds = CachingDataset(train_ds)
        test_ds = CachingDataset(test_ds)
        print("  Dataset caching: ENABLED")
    
    return train_ds, test_ds
