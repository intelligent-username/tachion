"""
This loader file used to contain ALL the logic. Now it just imports the actual individual loaders and makes use of them. It's basically only necessary for backwards-compatibility.

The actual implementation has been moved to train.load.loaders/ subpackage.
"""

# Re-export everything from the new loaders package
from train.load.loaders import (
    ASSET_CONFIG,
    get_asset_freq,
    get_asset_path,
    load_gluonts_dataset,
    load_pandas_dataset,
    load_parquet_as_dataframe,
    load_pf_dataset,
)

__all__ = [
    "ASSET_CONFIG",
    "get_asset_freq",
    "get_asset_path",
    "load_gluonts_dataset",
    "load_pandas_dataset",
    "load_parquet_as_dataframe",
    "load_pf_dataset",
]

