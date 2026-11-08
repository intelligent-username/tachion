from concurrent.futures import ThreadPoolExecutor
from threading import Event
from unittest.mock import Mock

import pytest
import requests
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

PAIRS = [{'symbol': 'EUR_USD', 'base': 'EUR', 'quote': 'USD'}]


@pytest.fixture
def directory(forex_modules, monkeypatch):
    module = forex_modules.load('_test_forex_route', 'api/forex.py')
    clock = Mock(return_value=100)
    monkeypatch.setattr(module.time, 'monotonic', clock)
    fetch = Mock(return_value=PAIRS)
    monkeypatch.setattr(module, 'get_oanda_forex_instruments', fetch)
    return module, clock, fetch


def test_schema_and_fresh_cache(directory):
    module, clock, fetch = directory
    app = FastAPI()
    app.include_router(module.router, prefix='/api')
    with TestClient(app) as client:
        result = client.get('/api/forex/currencies')
        assert result.status_code == 200
        assert result.json() == {
            'currencies': ['EUR', 'USD'], 'pairs': PAIRS,
            'stale': False, 'refreshAfterSeconds': 3600,
        }
        clock.return_value = 110
        assert client.get('/api/forex/currencies').json()['refreshAfterSeconds'] == 3590
    fetch.assert_called_once()


def test_expiry_stale_failure_and_recovery(directory):
    module, clock, fetch = directory
    module.get_currencies()
    clock.return_value = 3700
    fetch.side_effect = requests.HTTPError('secret token/account')
    assert module.get_currencies()['stale'] is True
    assert module.get_currencies()['pairs'] == PAIRS
    assert fetch.call_count == 2
    clock.return_value = 3760
    fetch.side_effect = None
    assert module.get_currencies()['stale'] is False
    assert fetch.call_count == 3


@pytest.mark.parametrize('error,code', [(requests.Timeout('secret'), 504), (requests.HTTPError('secret'), 502), (ValueError('secret'), 502)])
def test_cold_failure_is_sanitized_and_throttled(directory, error, code):
    module, _, fetch = directory
    fetch.side_effect = error
    for _ in range(2):
        with pytest.raises(HTTPException) as caught:
            module.get_currencies()
        assert caught.value.status_code == code
        assert 'secret' not in caught.value.detail
        assert caught.value.headers['Retry-After'] == '60'
    fetch.assert_called_once()


def test_configuration_change_invalidates_cache(directory, monkeypatch):
    module, _, fetch = directory
    module.get_currencies()
    monkeypatch.setenv('OANDA_KEY', 'changed')
    module.get_currencies()
    assert fetch.call_count == 2
    monkeypatch.delenv('OANDA_ACCOUNT_ID')
    with pytest.raises(HTTPException) as caught:
        module.get_currencies()
    assert caught.value.status_code == 503
    assert fetch.call_count == 2


def test_cold_concurrent_calls_share_fetch(directory):
    module, _, fetch = directory
    started, release = Event(), Event()

    def blocked():
        started.set()
        assert release.wait(5)
        return PAIRS

    fetch.side_effect = blocked
    with ThreadPoolExecutor(2) as pool:
        first = pool.submit(module.get_currencies)
        assert started.wait(5)
        second = pool.submit(module.get_currencies)
        release.set()
        assert first.result()['pairs'] == second.result()['pairs'] == PAIRS
    fetch.assert_called_once()


def test_concurrent_refresh_serves_stale(directory):
    module, clock, fetch = directory
    module.get_currencies()
    clock.return_value = 3700
    started, release = Event(), Event()

    def blocked():
        started.set()
        assert release.wait(5)
        return PAIRS

    fetch.side_effect = blocked
    with ThreadPoolExecutor(1) as pool:
        refresh = pool.submit(module.get_currencies)
        assert started.wait(5)
        try:
            assert module.get_currencies()['stale'] is True
        finally:
            release.set()
        assert refresh.result()['stale'] is False


def test_app_preserves_retry_after_header(directory, forex_modules, monkeypatch):
    import sys
    import types

    from fastapi import APIRouter

    module, _, _ = directory
    monkeypatch.setitem(sys.modules, 'api.forex', module)
    for name in ('api.predict', 'api.search'):
        stub = types.ModuleType(name)
        stub.router = APIRouter()
        monkeypatch.setitem(sys.modules, name, stub)
    main = forex_modules.load('_test_main', 'api/main.py')
    monkeypatch.delenv('OANDA_KEY')
    with TestClient(main.app) as client:
        response = client.get('/api/forex/currencies')
    assert response.status_code == 503
    assert response.headers['Retry-After'] == '60'
