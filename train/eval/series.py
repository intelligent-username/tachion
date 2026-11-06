"""
Evaluate trained time series models.

Usage:
    python -m train.eval.evaluate [asset] [model]
    
Examples:
    python -m train.eval.evaluate crypto tft2
    python -m train.eval.evaluate forex deepar
"""

import sys
import warnings
from pathlib import Path

import numpy as np
import torch

# Suppress noisy warnings
warnings.filterwarnings("ignore", category=UserWarning, module="sklearn")
warnings.filterwarnings("ignore", message=".*InconsistentVersionWarning.*")
warnings.filterwarnings("ignore", message=".*tensorboardX.*")
warnings.filterwarnings("ignore", message=".*Attribute.*is an instance of.*")
warnings.filterwarnings("ignore", message=".*Consider setting.*persistent_workers.*")

# Use Tensor Cores efficiently on supported GPUs
torch.set_float32_matmul_precision("medium")

from core import load_predictor
from core.training.constants import (
    DEEPAR_PREDICTION_LENGTH,
    DEFAULT_ASSET,
    DEFAULT_MODEL,
    TFT_CONTEXT_LENGTH,
    TFT_PREDICTION_LENGTH,
)
from gluonts.evaluation import Evaluator, make_evaluation_predictions

from train.definitions.tft_pf import TFTPFPredictor
from train.load.loader import (
    load_gluonts_dataset,
    load_pf_dataset,
)


def evaluate_gluonts_model(
    asset: str,
    model_type: str,
    prediction_length: int,
) -> dict:
    """
    Evaluate a GluonTS model (DeepAR or TFT).
    
    Returns dict with metrics including directional accuracy.
    """
    models_dir = Path(__file__).resolve().parents[2] / "models"
    model_dir = models_dir / f"{model_type}_{asset}"
    
    if not model_dir.exists():
        raise FileNotFoundError(f"Model not found: {model_dir}")
    
    print(f"Loading model from: {model_dir}")
    predictor = load_predictor(str(model_dir))
    
    print("Loading test dataset...")
    _, test_ds = load_gluonts_dataset(
        asset_type=asset,
        prediction_length=prediction_length,
    )
    
    print("Generating predictions...")
    forecast_it, ts_it = make_evaluation_predictions(
        dataset=test_ds,
        predictor=predictor,
        num_samples=100,
    )
    
    forecasts = list(forecast_it)
    actuals = list(ts_it)
    
    # Calculate directional accuracy
    correct_directions = 0
    total_predictions = 0
    
    for forecast, actual in zip(forecasts, actuals):
        # Get the forecast period from actual
        actual_values = actual[-prediction_length:].values
        predicted_values = forecast.mean
        
        # Compare directions (positive = up, negative = down)
        for pred, act in zip(predicted_values, actual_values):
            pred_dir = 1 if pred > 0 else -1
            act_dir = 1 if act > 0 else -1
            if pred_dir == act_dir:
                correct_directions += 1
            total_predictions += 1
    
    directional_accuracy = (correct_directions / total_predictions * 100) if total_predictions > 0 else 0
    
    # Standard metrics
    evaluator = Evaluator(quantiles=[0.025, 0.5, 0.975])
    agg_metrics, _ = evaluator(actuals, forecasts)
    
    return {
        "directional_accuracy": directional_accuracy,
        "total_predictions": total_predictions,
        "correct_predictions": correct_directions,
        "crps": agg_metrics.get("CRPS", None),
        "rmse": agg_metrics.get("RMSE", None),
        "mase": agg_metrics.get("MASE", None),
    }


def evaluate_tft2_model(
    asset: str,
    prediction_length: int,
    context_length: int,
) -> dict:
    """
    Evaluate a pytorch-forecasting TFT model (tft2).
    
    Returns dict with metrics including directional accuracy.
    """
    models_dir = Path(__file__).resolve().parents[2] / "models"
    model_dir = models_dir / f"tft2_{asset}"
    model_path = model_dir / f"{asset}_model.pt"
    
    if not model_path.exists():
        raise FileNotFoundError(f"Model not found: {model_path}")
    
    print("Loading dataset for model reconstruction...")
    training_ds, validation_ds = load_pf_dataset(
        asset_type=asset,
        prediction_length=prediction_length,
        context_length=context_length,
    )
    
    print(f"Loading model from: {model_path}")
    predictor = TFTPFPredictor.load(model_dir, training_ds, asset)
    
    # Create validation dataloader
    val_loader = validation_ds.to_dataloader(
        train=False,
        batch_size=64,
        num_workers=3,
        persistent_workers=True,
    )
    
    print("Generating predictions...")
    # predict() returns a Prediction named tuple with fields:
    # (output, x, index, decoder_lengths, y)
    result = predictor.model.predict(
        val_loader, return_x=True, mode="prediction"
    )
    
    predicted = result.output.cpu().numpy()
    
    # Inverse-transform actuals: original = normalized * scale + center
    decoder_target = result.x["decoder_target"]    # normalized targets
    target_scale = result.x["target_scale"]        # (center, scale) per sample
    center = target_scale[:, 0:1]                  # shape (batch, 1)
    scale = target_scale[:, 1:2]                   # shape (batch, 1)
    actuals = (decoder_target * scale + center).cpu().numpy()
    
    # Ensure shapes match
    min_len = min(len(actuals), len(predicted))
    actuals = actuals[:min_len]
    predicted = predicted[:min_len]
    
    # Calculate directional accuracy
    correct_directions = 0
    total_predictions = 0
    
    for pred_seq, act_seq in zip(predicted, actuals):
        for pred, act in zip(pred_seq.flatten(), act_seq.flatten()):
            pred_dir = 1 if pred > 0 else -1
            act_dir = 1 if act > 0 else -1
            if pred_dir == act_dir:
                correct_directions += 1
            total_predictions += 1
    
    directional_accuracy = (correct_directions / total_predictions * 100) if total_predictions > 0 else 0
    
    # RMSE
    rmse = np.sqrt(np.mean((predicted.flatten() - actuals.flatten()) ** 2))
    
    return {
        "directional_accuracy": directional_accuracy,
        "total_predictions": total_predictions,
        "correct_predictions": correct_directions,
        "rmse": rmse,
    }


def evaluate(
    asset: str = DEFAULT_ASSET,
    model: str = DEFAULT_MODEL,
) -> dict:
    """
    Evaluate a trained model on test data.
    
    Returns dict with evaluation metrics.
    """
    print(f"\n{'='*60}")
    print(f"  Evaluating {model.upper()} for {asset.upper()}")
    print(f"{'='*60}\n")
    
    if model == "tft2":
        metrics = evaluate_tft2_model(
            asset=asset,
            prediction_length=TFT_PREDICTION_LENGTH,
            context_length=TFT_CONTEXT_LENGTH,
        )
    else:
        # GluonTS models (deepar, tft)
        prediction_length = TFT_PREDICTION_LENGTH if model == "tft" else DEEPAR_PREDICTION_LENGTH
        metrics = evaluate_gluonts_model(
            asset=asset,
            model_type=model,
            prediction_length=prediction_length,
        )
    
    # Print results
    print(f"\n{'='*60}")
    print("  RESULTS")
    print(f"{'='*60}")
    print(f"\n  Directional Accuracy: {metrics['directional_accuracy']:.2f}%")
    print(f"  ({metrics['correct_predictions']:,} / {metrics['total_predictions']:,} correct)")
    
    if metrics.get("rmse") is not None:
        print(f"\n  RMSE: {metrics['rmse']:.6f}")
    if metrics.get("crps") is not None:
        print(f"  CRPS: {metrics['crps']:.6f}")
    if metrics.get("mase") is not None:
        print(f"  MASE: {metrics['mase']:.6f}")
    
    print()
    
    return metrics


def parse_args():
    """Parse command line arguments."""
    asset = DEFAULT_ASSET
    model = DEFAULT_MODEL
    
    valid_assets = ["crypto", "equities", "forex", "comm", "interest"]
    valid_models = ["deepar", "tft", "tft2"]
    
    args = sys.argv[1:]
    
    for arg in args:
        if arg.lower() in valid_assets:
            asset = arg.lower()
        elif arg.lower() in valid_models:
            model = arg.lower()
        elif arg.lower() in ["-h", "--help"]:
            print(__doc__)
            sys.exit(0)
        else:
            print(f"Warning: Unrecognized argument '{arg}'")
    
    return asset, model


if __name__ == "__main__":
    asset, model = parse_args()
    evaluate(asset=asset, model=model)
