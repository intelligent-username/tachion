"""
Temporal Fusion Transformer (TFT) model wrapper using GluonTS.
"""

from pathlib import Path

import torch
from core.training.constants import (
    DEFAULT_DEVICE,
    TFT_BATCH_SIZE,
    TFT_DROPOUT_RATE,
    TFT_EPOCHS,
    TFT_HIDDEN_DIM,
    TFT_LEARNING_RATE,
    TFT_NUM_BATCHES_PER_EPOCH,
    TFT_NUM_HEADS,
    TFT_VARIABLE_DIM,
    TFT_WEIGHT_DECAY,
)
from core.training.progress import CleanProgressBar
from gluonts.torch.model.tft import TemporalFusionTransformerEstimator


def create_tft_estimator(
    prediction_length: int,
    freq: str = "1H",
    context_length: int | None = None,
    num_heads: int = TFT_NUM_HEADS,
    hidden_dim: int = TFT_HIDDEN_DIM,
    variable_dim: int = TFT_VARIABLE_DIM,
    dropout_rate: float = TFT_DROPOUT_RATE,
    lr: float = TFT_LEARNING_RATE,
    weight_decay: float = TFT_WEIGHT_DECAY,
    batch_size: int = TFT_BATCH_SIZE,
    num_batches_per_epoch: int = TFT_NUM_BATCHES_PER_EPOCH,
    epochs: int = TFT_EPOCHS,
    quantiles: list[float] | None = None,
    device: str = DEFAULT_DEVICE,
    checkpoint_dir: Path | None = None,
) -> TemporalFusionTransformerEstimator:
    """
    Create a configured TFT Estimator.
    
    TFT uses attention mechanisms and can parallelize across time steps,
    making it significantly faster to train than DeepAR on GPU.
    """
    if context_length is None:
        context_length = prediction_length
    
    if quantiles is None:
        quantiles = [0.1, 0.25, 0.5, 0.75, 0.9]
    
    # Device selection
    if device == "auto":
        is_cuda = torch.cuda.is_available()
        accelerator = "gpu" if is_cuda else "cpu"
        device_name = torch.cuda.get_device_name(0) if is_cuda else "CPU"
        print(f"  Device: {accelerator.upper()} ({device_name})")
    else:
        accelerator = "gpu" if device.startswith("cuda") else "cpu"
        print(f"  Device: {accelerator.upper()} (Forced)")

    callbacks = [CleanProgressBar()]
    
    # Set checkpoint root directory
    checkpoint_root = str(checkpoint_dir.parent) if checkpoint_dir else None
    if checkpoint_dir:
        checkpoint_dir.parent.mkdir(parents=True, exist_ok=True)
        print(f"  Checkpoints: {checkpoint_dir.parent}/lightning_logs/")

    # Trainer config
    trainer_kwargs = {
        "max_epochs": epochs,
        "accelerator": accelerator,
        "devices": 1,
        "precision": "16-mixed",  # Mixed precision for (hopefully) ~1.5x speedup
        "gradient_clip_val": 1.0,
        "enable_model_summary": True,
        "enable_checkpointing": True,
        "callbacks": callbacks,
        "enable_progress_bar": True,
        "log_every_n_steps": 10,
        "limit_train_batches": num_batches_per_epoch,
        "default_root_dir": checkpoint_root,
        "val_check_interval": 77,
    }
    
    return TemporalFusionTransformerEstimator(
        freq=freq,
        prediction_length=prediction_length,
        context_length=context_length,
        quantiles=quantiles,
        num_heads=num_heads,
        hidden_dim=hidden_dim,
        variable_dim=variable_dim,
        dropout_rate=dropout_rate,
        lr=lr,
        weight_decay=weight_decay,
        batch_size=batch_size,
        num_batches_per_epoch=num_batches_per_epoch,
        trainer_kwargs=trainer_kwargs,
    )
