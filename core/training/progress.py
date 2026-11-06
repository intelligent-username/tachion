"""
Custom progress bar for PyTorch Lightning training.
"""

import sys
import time

from lightning.pytorch.callbacks import Callback

HOLD_WIDTH = 100

class CleanProgressBar(Callback):
    """Clean progress bar with box-drawing characters."""
    
    def __init__(self, width: int = 30):
        self.width = width
        self.epoch = 0
        self.max_epochs = 0
        self.start_time = 0
        self.last_print_time = 0
    
    
    def on_train_start(self, trainer, pl_module):
        self.max_epochs = trainer.max_epochs
        self.ema_loss = None
        self.alpha = 0.1  # Smoothing factor
        print("\n┌" + "─" * HOLD_WIDTH + "┐")
    
    def on_train_epoch_start(self, trainer, pl_module):
        self.epoch = trainer.current_epoch + 1
        self.start_time = time.time()  # FIX: Initialize timer
    
    def on_train_batch_end(self, trainer, pl_module, outputs, batch, batch_idx):
        total = trainer.num_training_batches
        step = batch_idx + 1
        
        # Update EMA loss
        current_loss = float(outputs.get("loss", 0))
        if self.ema_loss is None:
            self.ema_loss = current_loss
        else:
            self.ema_loss = self.alpha * current_loss + (1 - self.alpha) * self.ema_loss
        
        pct = step / total if total else 0
        filled = int(self.width * pct)
        bar = "█" * filled + "░" * (self.width - filled)
        
        # Calculate speed
        now = time.time()
        elapsed = now - self.start_time
        speed = step / elapsed if elapsed > 0 else 0.0
        
        val_loss = trainer.callback_metrics.get("val_loss", 0)
        
        metrics = f"{speed:.1f}it/s | L: {current_loss:.4f} EMA: {self.ema_loss:.4f} V: {float(val_loss):.4f}"
        
        output = f"\r│ Epoch {self.epoch}/{self.max_epochs} {bar} {pct*100:3.0f}% │ {metrics}  \t\t│"
        sys.stdout.write(output.ljust(HOLD_WIDTH))
        sys.stdout.flush()
    
    def on_validation_end(self, trainer, pl_module):
        
        total_batches = trainer.num_training_batches
        current_batch = trainer.global_step % total_batches if total_batches > 0 else 0
        
        # If we're NOT at the end (allow some simple margin for last batch), just return
        # PL sometimes runs val slightly before the absolute last batch index
        if total_batches - current_batch > 2:
            return

        loss = trainer.callback_metrics.get("train_loss_epoch", 0)
        val = trainer.callback_metrics.get("val_loss", 0)
        
        sys.stdout.write("\r" + " " * 100 + "\r")
        sys.stdout.flush()
        
        bar = "█" * self.width
        print(f"│ Ep {self.epoch}/{self.max_epochs} {bar} 100% │ L: {float(loss):.4f} V: {float(val):.4f} │ Done       │")
        
        # Epoch separator
        if self.epoch < self.max_epochs:
            print("├" + "─" * HOLD_WIDTH + "┤")
    
    def on_train_end(self, trainer, pl_module):
        print("└" + "─" * HOLD_WIDTH + "┘\n")
