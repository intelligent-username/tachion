"""
DeepAR model wrapper using GluonTS.
"""

from pathlib import Path

import torch
from core.training.constants import (
    DEEPAR_BATCH_SIZE,
    DEEPAR_DROPOUT_RATE,
    DEEPAR_EPOCHS,
    DEEPAR_HIDDEN_SIZE,
    DEEPAR_LEARNING_RATE,
    DEEPAR_NUM_BATCHES_PER_EPOCH,
    DEEPAR_NUM_LAYERS,
    DEEPAR_NUM_PARALLEL_SAMPLES,
    DEEPAR_WEIGHT_DECAY,
    DEFAULT_DEVICE,
)
from core.training.progress import CleanProgressBar
from gluonts.torch.distributions import StudentTOutput
from gluonts.torch.model.deepar import DeepAREstimator


def create_deepar_estimator(
    prediction_length: int,
    freq: str = "1H",
    context_length: int | None = None,
    num_layers: int = DEEPAR_NUM_LAYERS,
    hidden_size: int = DEEPAR_HIDDEN_SIZE,
    dropout_rate: float = DEEPAR_DROPOUT_RATE,
    lr: float = DEEPAR_LEARNING_RATE,
    weight_decay: float = DEEPAR_WEIGHT_DECAY,
    batch_size: int = DEEPAR_BATCH_SIZE,
    num_batches_per_epoch: int = DEEPAR_NUM_BATCHES_PER_EPOCH,
    epochs: int = DEEPAR_EPOCHS,
    num_parallel_samples: int = DEEPAR_NUM_PARALLEL_SAMPLES,
    device: str = DEFAULT_DEVICE,
    checkpoint_dir: Path | None = None,
) -> DeepAREstimator:
    """
    Create a configured DeepAREstimator with Student-t distribution.
    """
    if context_length is None:
        context_length = prediction_length
    
    # Hopefully GPU stops buggin
    if device == "auto":
        is_cuda = torch.cuda.is_available()
        accelerator = "gpu" if is_cuda else "cpu"
        device_name = torch.cuda.get_device_name(0) if is_cuda else "CPU"
        print(f"  Device: {accelerator.upper()} ({device_name})")
    else:
        accelerator = "gpu" if device.startswith("cuda") else "cpu"
        print(f"  Device: {accelerator.upper()} (Forced)")

    callbacks = [CleanProgressBar()]
    
    checkpoint_root = str(checkpoint_dir.parent) if checkpoint_dir else None
    if checkpoint_dir:
        checkpoint_dir.parent.mkdir(parents=True, exist_ok=True)
        print(f"  Checkpoints: {checkpoint_dir.parent}/lightning_logs/")

    trainer_kwargs = {
        "max_epochs": epochs,
        "accelerator": accelerator,
        "devices": 1,
        "precision": "16-mixed",
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
    
    return DeepAREstimator(
        freq=freq,
        prediction_length=prediction_length,
        context_length=context_length,
        num_layers=num_layers,
        hidden_size=hidden_size,
        dropout_rate=dropout_rate,
        lr=lr,
        weight_decay=weight_decay,
        batch_size=batch_size,
        num_batches_per_epoch=num_batches_per_epoch,
        num_parallel_samples=num_parallel_samples,
        distr_output=StudentTOutput(),
        scaling=True,
        # Enable features
        use_feat_dynamic_real=True,
        use_feat_static_cat=True, 
        cardinality=[1], # Placeholder if we used static cat, but we use dynamic
        trainer_kwargs=trainer_kwargs,
    )
