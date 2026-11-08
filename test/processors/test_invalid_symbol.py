"""Invalid-symbol early exits do not require external provider calls."""

from unittest.mock import Mock

import pytest


def test_binance_invalid_response_and_collector_opt_in(forex_modules, monkeypatch, tmp_path):
    bi = forex_modules.load('core.apis.biapi', 'core/apis/biapi.py')
    response = Mock(status_code=400)
    response.json.return_value = {'code': -1121, 'msg': 'Invalid symbol.'}
    monkeypatch.setattr(bi.requests, 'get', Mock(return_value=response))
    result = bi.BinanceAPI(symbol='FAKE')
    assert result['error_kind'] == 'invalid_symbol'
    response.raise_for_status.assert_not_called()
    with pytest.raises(bi.InvalidSymbolError):
        bi.call_specific_binance(str(tmp_path), ['FAKE'], 87, raise_on_invalid_symbol=True)
    bi.call_specific_binance(str(tmp_path), ['FAKE'], 87)


def test_invalid_crypto_is_cached_and_expires(forex_modules, monkeypatch, tmp_path):
    ip = forex_modules.ip
    monkeypatch.setattr(ip, 'raw_file_path', lambda asset, symbol: tmp_path / f'{symbol}.json')
    clock = [100.0]
    monkeypatch.setattr(ip.time, 'monotonic', lambda: clock[0])
    bootstrap = Mock(side_effect=ip.InvalidSymbolError('invalid'))
    monkeypatch.setattr(ip, '_collect_fresh_symbol_history', bootstrap)
    for symbol in ('fake', 'FAKEUSDT'):
        with pytest.raises(ip.InferenceProcessorError) as error:
            ip.get_historical_data(symbol, 'crypto')
        assert error.value.status_code == 404
    assert bootstrap.call_count == 1
    clock[0] += 60
    with pytest.raises(ip.InferenceProcessorError):
        ip.get_historical_data('FAKE', 'crypto')
    # An empty local cache entry must not prevent retrying the bootstrap.
    assert bootstrap.call_count == 2


def test_empty_history_fetches_range_once(forex_modules, monkeypatch, tmp_path):
    ip = forex_modules.ip
    monkeypatch.setattr(ip, 'raw_file_path', lambda asset, symbol: tmp_path / f'{symbol}.json')
    monkeypatch.setattr(ip, '_collect_fresh_symbol_history', Mock(return_value=[]))
    fetch = Mock(return_value=[])
    monkeypatch.setattr(ip, '_fetch_range_with_pagination', fetch)
    assert ip.get_historical_data('MISSING', 'interest') == []
    assert fetch.call_count == 1


def test_invalid_cache_is_bounded(forex_modules, monkeypatch, tmp_path):
    ip = forex_modules.ip
    monkeypatch.setattr(ip, 'raw_file_path', lambda asset, symbol: tmp_path / f'{symbol}.json')
    monkeypatch.setattr(ip, 'INVALID_SYMBOL_CACHE_LIMIT', 2)
    bootstrap = Mock(side_effect=ip.InvalidSymbolError('invalid'))
    monkeypatch.setattr(ip, '_collect_fresh_symbol_history', bootstrap)
    for symbol in ('AAA', 'BBB', 'CCC', 'AAA'):
        with pytest.raises(ip.InferenceProcessorError):
            ip.get_historical_data(symbol, 'crypto')
    assert bootstrap.call_count == 4
    assert len(ip.INVALID_SYMBOL_CACHE) == 2


def test_binance_non_symbol_error_is_not_classified(forex_modules, monkeypatch):
    bi = forex_modules.load('core.apis.biapi', 'core/apis/biapi.py')
    response = Mock(status_code=400)
    response.json.return_value = {'code': -1003, 'msg': 'Too many requests'}
    monkeypatch.setattr(bi.requests, 'get', Mock(return_value=response))
    assert 'error_kind' not in bi.BinanceAPI(symbol='BTC')


@pytest.mark.parametrize('asset,provider', [('equities', 'twelvedata'), ('comm', 'oanda')])
def test_bootstrap_failure_goes_directly_to_fallback(forex_modules, monkeypatch, tmp_path, asset, provider):
    ip = forex_modules.ip
    monkeypatch.setattr(ip, 'raw_file_path', lambda asset, symbol: tmp_path / f'{symbol}.json')
    monkeypatch.setattr(ip, '_collect_fresh_symbol_history', Mock(return_value={'status': 'error', 'message': 'unavailable'}))
    primary = Mock(side_effect=AssertionError(f'{provider} called again'))
    monkeypatch.setattr(ip, '_fetch_from_twelvedata' if asset == 'equities' else 'OandaAPI', primary)
    yahoo = Mock(return_value={'status': 'ok', 'values': []})
    monkeypatch.setattr(ip, '_fetch_from_yahoo', yahoo)
    assert ip.get_historical_data('MISSING', asset) == []
    primary.assert_not_called()
    assert yahoo.call_count == 1


def test_interactive_twelvedata_quota_failure_does_not_sleep(forex_modules, monkeypatch, tmp_path):
    td = forex_modules.load('core.apis.tdapi', 'core/apis/tdapi.py')
    monkeypatch.setattr(td, 'TwelveDataAPI', Mock(return_value={
        'status': 'error', 'message': 'run out of API credits'
    }))
    monkeypatch.setattr(td.time, 'sleep', Mock(side_effect=AssertionError('unexpected sleep')))
    result = td.call_specific_td(str(tmp_path), ['FAKE'], 3, return_on_error=True)
    assert result['status'] == 'error'
    assert td.TwelveDataAPI.call_count == 1


@pytest.mark.parametrize('asset', ['equities', 'comm'])
def test_fallback_can_return_valid_history(forex_modules, monkeypatch, tmp_path, asset):
    ip = forex_modules.ip
    monkeypatch.setattr(ip, 'raw_file_path', lambda asset, symbol: tmp_path / f'{symbol}.json')
    monkeypatch.setattr(ip, '_collect_fresh_symbol_history', Mock(return_value={'status': 'error'}))
    now = ip._effective_history_end(asset, ip.datetime.datetime.now())
    candle = {'datetime': (now - ip.datetime.timedelta(minutes=30)).strftime('%Y-%m-%d %H:%M:%S'),
              'open': 1, 'high': 1, 'low': 1, 'close': 1, 'volume': 0}
    monkeypatch.setattr(ip, '_fetch_from_yahoo', Mock(return_value={'status': 'ok', 'values': [candle]}))
    monkeypatch.setattr(ip, 'write_raw_data', Mock())
    assert len(ip.get_historical_data('VALID', asset)) == 1
