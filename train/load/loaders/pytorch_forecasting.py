"""PyTorch-Forecasting data loader."""



from .common import get_feature_columns, load_parquet_as_dataframe, prepare_dataframe
from .config import ASSET_CONFIG

try:
    from pytorch_forecasting import TimeSeriesDataSet
    from pytorch_forecasting.data import GroupNormalizer
    HAS_PF = True
except ImportError:
    HAS_PF = False
    TimeSeriesDataSet = None
    GroupNormalizer = None


def load_pf_dataset(
    asset_type: str,
    prediction_length: int = 24,
    context_length: int = 48,
) -> tuple:
    """
    Load data as pytorch-forecasting TimeSeriesDataSet.
    
    This creates pre-tensorized datasets that are significantly faster
    to train than GluonTS datasets.
    
    :param asset_type: Asset type to load
    :param prediction_length: Forecast horizon
    :param context_length: Encoder length (lookback window)
    
    Returns a tuple of (training_dataset, validation_dataset)
    """
    if not HAS_PF:
        raise ImportError(
            "pytorch-forecasting is not installed. "
            "Install with: pip install pytorch-forecasting"
        )
    
    config = ASSET_CONFIG.get(asset_type)
    if config is None:
        raise ValueError(f"Unknown asset type: {asset_type}")
    
    target_col = config["target_col"]
    item_id_col = config.get("item_id_col", "symbol")
    
    # Use existing loader
    df = load_parquet_as_dataframe(asset_type)
    
    # Prepare dataframe: drop NaNs, ensure lagged columns exist, clean infinities
    df = prepare_dataframe(df, config, target_col)
    
    # Clean data: drop rows with NaN in any used column
    unknown_reals, known_reals, known_categoricals = get_feature_columns(config, df)
    all_feature_cols = [target_col] + unknown_reals + known_reals + known_categoricals
    all_feature_cols = [c for c in all_feature_cols if c in df.columns]
    df = df.dropna(subset=all_feature_cols)
    
    # Prepare for TimeSeriesDataSet
    df = df.reset_index()
    df = df.rename(columns={df.columns[0]: "datetime"})
    
    # Add time index (required by pytorch-forecasting)
    if item_id_col in df.columns:
        df["time_idx"] = df.groupby(item_id_col).cumcount()
    else:
        df["time_idx"] = range(len(df))
        df[item_id_col] = "main"
    
    # Training cutoff: leave room for validation
    training_cutoff = df["time_idx"].max() - prediction_length
    
    print(f"  Samples: {len(df):,}")
    print(f"  Series: {df[item_id_col].nunique()}")
    
    # Determine which feature columns actually exist in the data
    unknown_reals, known_reals, known_categoricals = get_feature_columns(config, df)
    
    # Convert categoricals to strings (required for embeddings)
    for c in known_categoricals:
        df[c] = df[c].astype(str)
    
    # Target is always an unknown real
    all_unknown = [target_col] + unknown_reals
    # time_idx is always a known real
    all_known = ["time_idx"] + known_reals
    
    print(f"  Unknown reals: {all_unknown}")
    print(f"  Known reals: {all_known}")
    print(f"  Known categoricals: {known_categoricals}")
    
    # Create training dataset
    training = TimeSeriesDataSet(
        df[df["time_idx"] <= training_cutoff],
        time_idx="time_idx",
        target=target_col,
        group_ids=[item_id_col],
        min_encoder_length=context_length // 2,
        max_encoder_length=context_length,
        min_prediction_length=1,
        max_prediction_length=prediction_length,
        static_categoricals=[item_id_col],
        time_varying_known_reals=all_known,
        time_varying_unknown_reals=all_unknown,
        time_varying_known_categoricals=known_categoricals,
        target_normalizer=GroupNormalizer(groups=[item_id_col]),
        add_relative_time_idx=True,
        add_target_scales=True,
        add_encoder_length=True,
        allow_missing_timesteps=True,
    )
    
    # Validation dataset uses same params as training
    validation = TimeSeriesDataSet.from_dataset(
        training,
        df,
        predict=True,
        stop_randomization=True,
    )
    
    return training, validation
