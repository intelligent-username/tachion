"""
Pytest configuration and fixtures
"""

import os
import sys

import pytest

# Ensure the project root is in the path for imports
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)


@pytest.fixture
def sample_candle_data():
    """Sample candle data for testing"""
    return [
        {
            "datetime": "2024-01-01 12:00:00",
            "open": "100.00",
            "high": "101.50",
            "low": "99.50",
            "close": "101.00",
            "volume": "10000"
        },
        {
            "datetime": "2024-01-01 12:30:00",
            "open": "101.00",
            "high": "102.00",
            "low": "100.50",
            "close": "101.75",
            "volume": "8500"
        }
    ]


@pytest.fixture
def mock_env_vars(monkeypatch):
    """Set up mock environment variables for testing"""
    monkeypatch.setenv("TD_KEY", "test_twelvedata_key")
    monkeypatch.setenv("OANDA_KEY", "test_oanda_key")
    monkeypatch.setenv("OANDA_ACCOUNT_ID", "test_account_id")
