"""
Train time series models using GluonTS or pytorch-forecasting.

Models:
    deepar - GluonTS DeepAR (LSTM-based)
    tft    - GluonTS TFT (slow, research-grade)
    tft2   - pytorch-forecasting TFT (fast, production-grade)

Usage:
    python -m train.loops.train_deep [asset] [model] [-n]
    
Examples:
    python -m train.loops.train_deep crypto tft2 -n   # Fast TFT on crypto
    python -m train.loops.train_deep forex deepar -n  # DeepAR on forex
"""

import os
import sys
import time
import traceback
from pathlib import Path

import torch

torch.set_float32_matmul_precision('medium')
torch.backends.cudnn.benchmark = True
os.environ['TOKENIZERS_PARALLELISM'] = 'false'

try:
    import resource
    soft, hard = resource.getrlimit(resource.RLIMIT_NOFILE)
    resource.setrlimit(resource.RLIMIT_NOFILE, (min(65536, hard), hard))
except (ImportError, ValueError):
    pass  # Not on Linux or can't change limit

from core import save_predictor, set_training_defaults
from core.training.constants import (
    DEEPAR_BATCH_SIZE,
    DEEPAR_CONTEXT_LENGTH,
    DEEPAR_EPOCHS,
    DEEPAR_LEARNING_RATE,
    DEEPAR_NUM_BATCHES_PER_EPOCH,
    # DeepAR
    DEEPAR_PREDICTION_LENGTH,
    DEFAULT_ASSET,
    # Shared
    DEFAULT_DEVICE,
    DEFAULT_MODEL,
    TFT_BATCH_SIZE,
    TFT_CONTEXT_LENGTH,
    TFT_EPOCHS,
    TFT_HIDDEN_DIM,
    TFT_LEARNING_RATE,
    TFT_NUM_BATCHES_PER_EPOCH,
    # TFT
    TFT_PREDICTION_LENGTH,
)
from gluonts.evaluation import Evaluator, make_evaluation_predictions

from train.definitions.deep import create_deepar_estimator
from train.definitions.tft import create_tft_estimator
from train.definitions.tft_pf import TFTPFPredictor, create_tft_pf_model, create_trainer
from train.load.loader import get_asset_freq, load_gluonts_dataset, load_pf_dataset


def train(
    asset: str = DEFAULT_ASSET,
    model: str = DEFAULT_MODEL,
    prediction_length: int | None = None,
    context_length: int | None = None,
    batch_size: int | None = None,
    num_batches_per_epoch: int | None = None,
    epochs: int | None = None,
    lr: float | None = None,
    device: str = DEFAULT_DEVICE,
):
    """Train a time series model for specified asset type."""
    
    # Set model-specific defaults
    if model in ("tft", "tft2"):
        prediction_length = prediction_length or TFT_PREDICTION_LENGTH
        context_length = context_length or TFT_CONTEXT_LENGTH
        batch_size = batch_size or TFT_BATCH_SIZE
        num_batches_per_epoch = num_batches_per_epoch or TFT_NUM_BATCHES_PER_EPOCH
        epochs = epochs or TFT_EPOCHS
        lr = lr or TFT_LEARNING_RATE
    else:  # deepar
        prediction_length = prediction_length or DEEPAR_PREDICTION_LENGTH
        context_length = context_length or DEEPAR_CONTEXT_LENGTH
        batch_size = batch_size or DEEPAR_BATCH_SIZE
        num_batches_per_epoch = num_batches_per_epoch or DEEPAR_NUM_BATCHES_PER_EPOCH
        epochs = epochs or DEEPAR_EPOCHS
        lr = lr or DEEPAR_LEARNING_RATE
    
    model_names = {"tft": "TFT (GluonTS)", "tft2": "TFT (pytorch-forecasting)", "deepar": "DeepAR"}
    model_name = model_names.get(model, model)
    
    print(f"\n{'='*60}")
    print(f"  Training {model_name} for {asset.upper()}")
    print(f"{'='*60}")
    
    # Setup paths
    models_dir = Path(__file__).resolve().parents[2] / "models"
    models_dir.mkdir(parents=True, exist_ok=True)
    final_model_dir = models_dir / f"{model}_{asset}"
    checkpoint_dir = models_dir / f"{model}_{asset}_checkpoints"
    
    # Get frequency for this asset type
    freq = get_asset_freq(asset)
    
    # =========================================================================
    # TFT2: pytorch-forecasting (fast, pre-tensorized)
    # =========================================================================
    if model == "tft2":
        print("\nLoading data for pytorch-forecasting...")
        
        # Use existing loader with pytorch-forecasting support
        training_ds, validation_ds = load_pf_dataset(
            asset_type=asset,
            prediction_length=prediction_length,
            context_length=context_length,
        )
        
        # Create dataloaders (use a few workers since data is in memory)
        train_loader = training_ds.to_dataloader(
            train=True,
            batch_size=batch_size,
            num_workers=3,
            pin_memory=True,
            persistent_workers=True,
        )
        val_loader = validation_ds.to_dataloader(
            train=False,
            batch_size=batch_size * 2,
            num_workers=3,
            pin_memory=True,
            persistent_workers=True,
        )
        
        # Create model and trainer
        tft_model = create_tft_pf_model(
            training_ds,
            hidden_size=TFT_HIDDEN_DIM,
            lr=lr,
        )
        
        trainer = create_trainer(
            epochs=epochs,
            device=device,
            checkpoint_dir=checkpoint_dir,
        )
        
        print(f"\nModel parameters: {sum(p.numel() for p in tft_model.parameters()):,}")
        
        if torch.cuda.is_available():
            print(f"GPU: {torch.cuda.get_device_name(0)}")
            print(f"GPU Memory: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")
        
        print(f"\nStarting training ({epochs} epochs)...\n")
        train_start = time.time()
        
        try:
            trainer.fit(tft_model, train_dataloaders=train_loader, val_dataloaders=val_loader)
        except KeyboardInterrupt:
            print("\n\nTraining interrupted. Saving current model state...")
            # Fall through to save logic
        except Exception as e:
            print(f"\n\nTraining failed: {e}")
            print(traceback.format_exc())
            sys.exit(1)
        
        train_time = time.time() - train_start
        print(f"\nTraining complete! ({train_time/60:.2f} min)")
        
        # Create predictor wrapper and save
        predictor = TFTPFPredictor(tft_model, training_ds, asset)
        predictor.save(final_model_dir)
        print(f"\nModel saved to: {final_model_dir}")
        
        return predictor, {}
    
    # =========================================================================
    # GluonTS models (TFT & DeepAR)
    # =========================================================================
    print("\nLoading data...")
    train_ds, test_ds = load_gluonts_dataset(
        asset_type=asset,
        prediction_length=prediction_length,
    )
    print(f"  Train series: {len(list(train_ds))}")
    
    # Create estimator based on model choice
    if model == "tft":
        estimator = create_tft_estimator(
            prediction_length=prediction_length,
            freq=freq,
            context_length=context_length,
            lr=lr,
            batch_size=batch_size,
            num_batches_per_epoch=num_batches_per_epoch,
            epochs=epochs,
            device=device,
            checkpoint_dir=checkpoint_dir,
        )
    else:  # deepar
        estimator = create_deepar_estimator(
            prediction_length=prediction_length,
            freq=freq,
            context_length=context_length,
            lr=lr,
            batch_size=batch_size,
            num_batches_per_epoch=num_batches_per_epoch,
            epochs=epochs,
            device=device,
            checkpoint_dir=checkpoint_dir,
        )
    
    if torch.cuda.is_available():
        print("\nWarming up GPU...")
        torch.cuda.init()
        warmup = torch.randn(1024, 1024, device='cuda')
        _ = torch.matmul(warmup, warmup)
        del warmup
        torch.cuda.empty_cache()
        torch.cuda.synchronize()
        print(f"  GPU Memory: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")
    
    num_workers = min(6, os.cpu_count() or 4)
    
    print(f"\nStarting training ({epochs} epochs, {num_batches_per_epoch} batches/epoch)...")
    print(f"  DataLoader workers: {num_workers}")
    print("  Prefetch factor: 2\n")
    train_start = time.time()
    predictor = None
    
    try:
        # Linux: use multiple workers with prefetching for parallel data loading
        predictor = estimator.train(
            train_ds,
            num_workers=num_workers,
            prefetch_factor=2,
            persistent_workers=True,
            pin_memory=True,
        )
        
    except KeyboardInterrupt:
        print("\n\nTraining interrupted. No model saved.")
        return None, None
    
    except Exception as e:
        print(f"\n\nTraining failed: {e}")
        print(traceback.format_exc())
        sys.exit(1)
    
    train_time = time.time() - train_start
    print(f"\nTraining complete! ({train_time/60:.2f} min)")
    
    # Evaluate
    print("\nEvaluating...")
    forecast_it, ts_it = make_evaluation_predictions(
        dataset=test_ds,
        predictor=predictor,
        num_samples=100,
    )
    
    evaluator = Evaluator(quantiles=[0.025, 0.5, 0.975])
    agg_metrics, _ = evaluator(list(ts_it), list(forecast_it))
    
    print(f"\n  CRPS: {agg_metrics.get('CRPS', 'N/A'):.6f}")
    print(f"  RMSE: {agg_metrics.get('RMSE', 'N/A'):.6f}")
    
    # Save
    save_predictor(predictor, str(final_model_dir))
    print(f"\nModel saved to: {final_model_dir}")
    
    return predictor, agg_metrics


def parse_args():
    """Parse command line arguments."""
    asset = DEFAULT_ASSET
    model = DEFAULT_MODEL
    skip_modify = False
    
    valid_assets = ["crypto", "equities", "forex", "comm", "interest"]
    valid_models = ["deepar", "tft", "tft2"]
    
    args = sys.argv[1:]
    
    for arg in args:
        if arg.lower() == "-n":
            skip_modify = True
        elif arg.lower() in valid_assets:
            asset = arg.lower()
        elif arg.lower() in valid_models:
            model = arg.lower()
        else:
            print(f"Warning: Unrecognized argument '{arg}'")
    
    return asset, model, skip_modify


if __name__ == "__main__":
    asset, model, skip_modify = parse_args()
    
    # Use model-specific defaults
    if model in ("tft", "tft2"):
        defaults = {
            "asset": asset,
            "model": model,
            "epochs": TFT_EPOCHS,
            "prediction_length": TFT_PREDICTION_LENGTH,
            "context_length": TFT_CONTEXT_LENGTH,
            "batch_size": TFT_BATCH_SIZE,
            "num_batches_per_epoch": TFT_NUM_BATCHES_PER_EPOCH,
            "lr": TFT_LEARNING_RATE,
            "device": DEFAULT_DEVICE,
        }
    else:  # deepar
        defaults = {
            "asset": asset,
            "model": model,
            "epochs": DEEPAR_EPOCHS,
            "prediction_length": DEEPAR_PREDICTION_LENGTH,
            "context_length": DEEPAR_CONTEXT_LENGTH,
            "batch_size": DEEPAR_BATCH_SIZE,
            "num_batches_per_epoch": DEEPAR_NUM_BATCHES_PER_EPOCH,
            "lr": DEEPAR_LEARNING_RATE,
            "device": DEFAULT_DEVICE,
        }
    
    if skip_modify:
        config = defaults
        print(f"Training Config: {', '.join([f'{k}={v}' for k, v in config.items()])}\n")
    else:
        config = set_training_defaults(defaults)
    
    train(
        asset=config["asset"],
        model=config.get("model", model),
        prediction_length=config["prediction_length"],
        context_length=config["context_length"],
        num_batches_per_epoch=config["num_batches_per_epoch"],
        epochs=config["epochs"],
        batch_size=config["batch_size"],
        lr=config["lr"],
        device=config["device"],
    )

