"""
Shared utilities for training configuration and interactive CLI.
"""

import sys
from typing import Any


def set_training_defaults(defaults: dict[str, Any]) -> dict[str, Any]:
    """
    Update training configuration from defaults and CLI arguments.

    defaults: Dictionary of default configuration values.

    Returns an updated configuration dictionary.
    """
    config = defaults.copy()
    
    skip_modify = False
    valid_assets = ["crypto", "equities", "forex", "comm", "interest"]
    valid_models = ["deepar", "tft"]
    
    # Parse CLI arguments
    for arg in sys.argv[1:]:
        arg_lower = arg.lower()
        if arg_lower == "-n":
            skip_modify = True
        elif arg_lower in valid_assets:
            config["asset"] = arg_lower
        elif arg_lower in valid_models:
            config["model"] = arg_lower
        # Skip unknown args silently (already warned in parse_args)
    
    print(f"Training Config - Defaults: {', '.join([f'{k}={v}' for k, v in config.items()])}")
    
    if skip_modify:
        modify = "n"
    else:
        modify = input("Modify defaults? (y/n): ").strip().lower()
    
    if modify in ["y", "yes", "ya", "yeah", "yep", "yea"]:
        for key, value in config.items():
            prompt = f"{key.replace('_', ' ').capitalize()} ({value}): "
            user_input = input(prompt).strip()
            
            if not user_input:
                continue
                
            # Type casting based on default value type
            if isinstance(value, bool):
                config[key] = user_input.lower() in ["y", "yes", "true", "1"]
            elif isinstance(value, int):
                if user_input.isdigit():
                    config[key] = int(user_input)
            elif isinstance(value, float):
                try:
                    config[key] = float(user_input)
                except ValueError:
                    pass
            else:
                config[key] = user_input
                
    print(f"\nFinal configuration: {', '.join([f'{k}={v}' for k, v in config.items()])}\n")
    return config
