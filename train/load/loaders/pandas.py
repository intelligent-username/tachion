"""Pandas-based data loader."""


from gluonts.dataset.pandas import PandasDataset

from .common import load_parquet_as_dataframe
from .config import ASSET_CONFIG


def load_pandas_dataset(
    asset_type: str,
    prediction_length: int = 24,
) -> PandasDataset:
    """
    Load data as a GluonTS PandasDataset.
    
    This is an alternative to ListDataset that works directly with pandas.
    
    :param asset_type: Asset type to load
    :param prediction_length: Forecast horizon
    
    Returns a PandasDataset
    """
    config = ASSET_CONFIG.get(asset_type)
    if config is None:
        raise ValueError(f"Unknown asset type: {asset_type}")
    
    freq = config["freq"]
    target_col = config["target_col"]
    item_id_col = config.get("item_id_col")
    
    df = load_parquet_as_dataframe(asset_type)
    df = df.dropna(subset=[target_col])
    
    # PandasDataset expects:
    # - DataFrame with DatetimeIndex
    # - target column specified
    # - optionally item_id for multiple series
    
    if item_id_col and item_id_col in df.columns:
        # For multiple series, we need the item_id as a column
        df = df.reset_index()
        df = df.rename(columns={df.columns[0]: "timestamp"})
        df = df.set_index("timestamp")
        
        return PandasDataset.from_long_dataframe(
            df,
            target=target_col,
            item_id=item_id_col,
            freq=freq,
        )
    else:
        # Single series
        return PandasDataset(
            {None: df[[target_col]]},
            target=target_col,
            freq=freq,
        )
