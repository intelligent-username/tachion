"""
Model checkpointing utilities (DeepAR).
"""

from pathlib import Path

import torch
from gluonts.model.predictor import Predictor


def load_checkpoint(checkpoint_path: str) -> dict | None:
    """
    
    checkpoint_path: Path to .pth file
    
    Returns Checkpoint dictionary or None if not found
    """
    path = Path(checkpoint_path)
    if not path.exists():
        return None
    return torch.load(path, map_location="cpu")


def save_checkpoint(state_dict: dict, checkpoint_path: str) -> None:
    """
    Saves a PyTorch checkpoint as .pth file.
    
    state_dict: State dictionary to save
    checkpoint_path: Path to save the checkpoint
    """
    path = Path(checkpoint_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(state_dict, path)


def load_predictor(model_dir: str) -> Predictor:
    """
    Load a trained GluonTS predictor from disk.
    
    model_dir: Directory containing the saved predictor
    
    Returns a Loaded Predictor object
    """
    return Predictor.deserialize(Path(model_dir))


def save_predictor(predictor: Predictor, model_dir: str) -> None:
    """
    Save a trained GluonTS predictor to disk.
    
    predictor: Trained Predictor object
    model_dir: Directory to save the predictor
    """
    model_path = Path(model_dir)
    model_path.mkdir(parents=True, exist_ok=True)
    predictor.serialize(model_path)
