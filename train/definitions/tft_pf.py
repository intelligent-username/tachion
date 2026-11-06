"""
Temporal Fusion Transformer using pytorch-forecasting.

This is significantly faster than GluonTS TFT due to pre-batched data pipelines.
"""

from pathlib import Path

import lightning.pytorch as pl
import torch
from core.training.constants import (
    DEFAULT_DEVICE,
    TFT_DROPOUT_RATE,
    TFT_EPOCHS,
    TFT_HIDDEN_DIM,
    TFT_LEARNING_RATE,
    TFT_NUM_HEADS,
)
from core.training.progress import CleanProgressBar
from lightning.pytorch.callbacks import EarlyStopping, ModelCheckpoint
from pytorch_forecasting import TemporalFusionTransformer, TimeSeriesDataSet
from pytorch_forecasting.metrics import QuantileLoss


def create_tft_pf_model(
    training_dataset: TimeSeriesDataSet,
    hidden_size: int = TFT_HIDDEN_DIM,
    attention_head_size: int = TFT_NUM_HEADS,
    dropout: float = TFT_DROPOUT_RATE,
    lr: float = TFT_LEARNING_RATE,
    quantiles: list[float] | None = None,
) -> TemporalFusionTransformer:
    """
    Create a pytorch-forecasting TFT model from a dataset.
    """
    if quantiles is None:
        quantiles = [0.025, 0.1, 0.25, 0.5, 0.75, 0.9, 0.975]
    
    model = TemporalFusionTransformer.from_dataset(
        training_dataset,
        learning_rate=lr,
        hidden_size=hidden_size,
        attention_head_size=attention_head_size,
        dropout=dropout,
        hidden_continuous_size=hidden_size // 2,
        loss=QuantileLoss(quantiles=quantiles),
        reduce_on_plateau_patience=4,
        optimizer="AdamW",
    )
    
    return model


def create_trainer(
    epochs: int = TFT_EPOCHS,
    device: str = DEFAULT_DEVICE,
    checkpoint_dir: Path | None = None,
    gradient_clip_val: float = 0.5,
) -> pl.Trainer:
    """
    Create a PyTorch Lightning trainer for TFT.
    
    Uses float32 precision to avoid overflow in attention masks.
    """
    # Device selection
    if device == "auto":
        accelerator = "gpu" if torch.cuda.is_available() else "cpu"
    else:
        accelerator = "gpu" if device.startswith("cuda") else "cpu"
    
    callbacks = [
        CleanProgressBar(),
        EarlyStopping(monitor="val_loss", patience=10, mode="min"),
    ]
    
    if checkpoint_dir:
        checkpoint_dir.mkdir(parents=True, exist_ok=True)
        callbacks.append(
            ModelCheckpoint(
                dirpath=str(checkpoint_dir),
                filename="tft-{epoch:02d}-{val_loss:.4f}",
                save_top_k=3,
                monitor="val_loss",
                mode="min",
                save_weights_only=True,
            )
        )
    
    trainer = pl.Trainer(
        max_epochs=epochs,
        accelerator=accelerator,
        devices=1,
        precision="32-true",
        gradient_clip_val=gradient_clip_val,
        callbacks=callbacks,
        enable_model_summary=False,
        log_every_n_steps=50,
        enable_progress_bar=False,
        logger=True,
        val_check_interval=77,
    )
    
    return trainer


class TFTPFPredictor:
    """
    Predictor wrapper to match GluonTS predictor interface.
    """
    
    def __init__(self, model: TemporalFusionTransformer, training_dataset: TimeSeriesDataSet, asset_type: str):
        self.model = model
        self.training_dataset = training_dataset
        self.prediction_length = training_dataset.max_prediction_length
        self.quantiles = model.loss.quantiles
        self.asset_type = asset_type
    
    def predict(self, dataloader) -> dict:
        """
        Generate predictions from a DataLoader.
        
        Returns dict with 'mean', 'lower', 'upper' arrays.
        """
        # Get predictions - mode="quantiles" returns shape (batch, horizon, num_quantiles)
        predictions = self.model.predict(dataloader, return_x=False, mode="quantiles")
        
        # Handle different tensor shapes
        if predictions.dim() == 2:
            # Shape: (batch, horizon) - point predictions only
            pred_np = predictions.cpu().numpy()
            return {
                "mean": pred_np,
                "lower": pred_np,
                "upper": pred_np,
                "all_quantiles": pred_np,
            }
        elif predictions.dim() == 3:
            # Shape: (batch, horizon, num_quantiles)
            q_idx_lower = 0  # 2.5%
            q_idx_median = len(self.quantiles) // 2  # 50%
            q_idx_upper = -1  # 97.5%
            
            return {
                "mean": predictions[:, :, q_idx_median].cpu().numpy(),
                "lower": predictions[:, :, q_idx_lower].cpu().numpy(),
                "upper": predictions[:, :, q_idx_upper].cpu().numpy(),
                "all_quantiles": predictions.cpu().numpy(),
            }
        else:
            raise ValueError(f"Unexpected prediction shape: {predictions.shape}")
    
    def save(self, path: Path):
        """Save model checkpoint."""
        path = Path(path)
        path.mkdir(parents=True, exist_ok=True)
        torch.save({
            "model_state_dict": self.model.state_dict(),
            "model_hparams": self.model.hparams,
        }, path / f"{self.asset_type}_model.pt")
    
    @classmethod
    def load(cls, path: Path, training_dataset: TimeSeriesDataSet, asset_type: str):
        """Load model from checkpoint."""
        checkpoint = torch.load(path / f"{asset_type}_model.pt", weights_only=False)
        model = TemporalFusionTransformer.from_dataset(
            training_dataset,
            **checkpoint["model_hparams"],
        )
        model.load_state_dict(checkpoint["model_state_dict"])
        return cls(model, training_dataset, asset_type)
