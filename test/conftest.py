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


@pytest.fixture
def forex_modules(monkeypatch):
    """Load real FOREX leaves without eager model imports or external I/O."""
    import importlib.util
    import types
    from pathlib import Path
    from unittest.mock import Mock

    import dotenv
    import requests

    root = Path(project_root)
    monkeypatch.setattr(dotenv, 'load_dotenv', lambda: None)
    monkeypatch.setenv('OANDA_KEY', 'test-token')
    monkeypatch.setenv('OANDA_ACCOUNT_ID', 'test-account')

    def unexpected(*args, **kwargs):
        raise AssertionError('Unexpected external call in isolated FOREX test')

    monkeypatch.setattr(requests.sessions.Session, 'send', unexpected)
    for name in ('core', 'core.apis', 'core.processor'):
        package = types.ModuleType(name)
        package.__path__ = [str(root.joinpath(*name.split('.')))]
        monkeypatch.setitem(sys.modules, name, package)

    def stub(name, names):
        module = types.ModuleType(name)
        for attribute in names:
            setattr(module, attribute, unexpected)
        monkeypatch.setitem(sys.modules, name, module)
        return module

    stub('core.apis.biapi', ('BinanceAPI', 'call_specific_binance'))
    stub('core.apis.tdapi', ('TwelveDataAPI', 'call_specific_td'))
    stub('core.processor.dw', ('add_crypto_date_features', 'add_date_features'))
    stub('core.processor.lr', ('log_return', 'volume_change'))
    stub('core.processor.ma', ('moving_average',))
    stub('core.processor.rv', ('rolling_volatility',))
    yahoo = stub('yfinance', ('Ticker',))
    yahoo.Ticker = Mock(side_effect=unexpected)

    def load(name, relative_path):
        spec = importlib.util.spec_from_file_location(name, root / relative_path)
        module = importlib.util.module_from_spec(spec)
        monkeypatch.setitem(sys.modules, name, module)
        spec.loader.exec_module(module)
        return module

    oa = load('core.apis.oaapi', 'core/apis/oaapi.py')
    yf = load('core.apis.yfapi', 'core/apis/yfapi.py')
    utils = load('core.processor.history_utils', 'core/processor/history_utils.py')
    ip = load('core.processor.ip', 'core/processor/ip.py')
    return types.SimpleNamespace(oa=oa, yf=yf, utils=utils, ip=ip, load=load)
