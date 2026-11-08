import datetime
from copy import deepcopy
from unittest.mock import Mock

import pytest


def candle(at='2026-11-06 12:00:00', **prices):
    return {'datetime': str(at), 'open': 2.0, 'high': 4.0, 'low': 1.0, 'close': 2.5, 'volume': 123, **prices}


def test_reciprocal_prices_copy_and_round_trip(forex_modules):
    utils = forex_modules.utils
    rows = [candle()]
    original = deepcopy(rows)
    inverse = utils.normalize_forex_values(rows, inverse=True)
    assert inverse == [candle(open=0.5, high=1.0, low=0.25, close=0.4)]
    assert rows == original
    restored = utils.normalize_forex_values(inverse, inverse=True)
    for key in ('open', 'high', 'low', 'close', 'volume'):
        assert restored[0][key] == pytest.approx(rows[0][key])
    assert utils.inverse_forex_symbol('EUR_USD') == 'USD_EUR'


@pytest.mark.parametrize('symbol', ['EUR_EUR', 'EURUSD', 'eur_usd', '../USD'])
def test_invalid_inverse_symbol(forex_modules, symbol):
    with pytest.raises(ValueError):
        forex_modules.utils.inverse_forex_symbol(symbol)


@pytest.mark.parametrize('price', [0, -1, float('nan'), float('inf'), None, 'bad', 1e-320])
def test_unusable_reciprocal_prices(forex_modules, price):
    assert forex_modules.utils.normalize_forex_values([candle(close=price)], inverse=True) == []


def test_sort_deduplicate_and_window(forex_modules):
    utils = forex_modules.utils
    rows = [None, {}, candle('2026-11-06 12:30:00'), candle(), candle(close=3)]
    result = utils.normalize_forex_values(rows, start=datetime.datetime(2026, 11, 6, 12))
    assert len(result) == 2
    assert result[0]['close'] == 3
    assert result[1]['datetime'].endswith('12:30:00')


@pytest.fixture
def history(forex_modules, monkeypatch):
    from types import SimpleNamespace

    ip = forex_modules.ip
    now = datetime.datetime(2026, 11, 6, 12)
    disk = {}
    monkeypatch.setattr(ip, '_effective_history_end', lambda *args: now)
    monkeypatch.setattr(ip, 'raw_file_path', lambda asset, symbol: SimpleNamespace(
        symbol=symbol, parent='memory', exists=lambda: symbol in disk,
    ))
    monkeypatch.setattr(ip, 'read_raw_data', lambda path: deepcopy(disk.get(path.symbol, [])))
    writer = Mock()
    monkeypatch.setattr(ip, 'write_raw_data', writer)
    return SimpleNamespace(ip=ip, now=now, disk=disk, writer=writer)


def covered_rows(now, age=10):
    return [candle(now - datetime.timedelta(days=1)), candle(now - datetime.timedelta(minutes=age))]


@pytest.mark.parametrize('location', ['memory', 'disk'])
def test_opposite_history_avoids_providers(history, monkeypatch, location):
    ip = history.ip
    rows = covered_rows(history.now)
    if location == 'memory':
        ip.RAW_HISTORY_CACHE['forex:USD_EUR'] = {'rows': rows}
    else:
        history.disk['USD_EUR'] = rows
    fetch = Mock(side_effect=AssertionError('No price call expected'))
    monkeypatch.setattr(ip, '_fetch_range_with_pagination', fetch)
    monkeypatch.setattr(ip, '_collect_fresh_symbol_history', fetch)
    result = ip.get_historical_data('EUR_USD', 'forex', '1d')
    assert result[0]['open'] == 0.5
    assert rows[0]['open'] == 2
    assert ip.RAW_HISTORY_CACHE['forex:EUR_USD']['rows'] == result
    history.writer.assert_not_called()
    fetch.assert_not_called()


def test_direct_rows_win_collision(history):
    ip = history.ip
    ip.RAW_HISTORY_CACHE['forex:USD_EUR'] = {'rows': covered_rows(history.now)}
    direct = covered_rows(history.now)
    direct[0]['close'] = 3
    ip.RAW_HISTORY_CACHE['forex:EUR_USD'] = {'rows': direct}
    assert ip.get_historical_data('EUR_USD', 'forex', '1d')[0]['close'] == 3


@pytest.mark.parametrize('age,expected_calls', [(24, 0), (25, 0), (31, 1)])
def test_forward_refresh_threshold(history, monkeypatch, age, expected_calls):
    # At age 25 the policy requests refresh, but the next 30m candle isn't due yet.
    ip = history.ip
    ip.RAW_HISTORY_CACHE['forex:EUR_USD'] = {'rows': covered_rows(history.now, age)}
    fetch = Mock(return_value=[])
    monkeypatch.setattr(ip, '_fetch_range_with_pagination', fetch)
    ip.get_historical_data('EUR_USD', 'forex', '1d')
    assert fetch.call_count == expected_calls


def test_expanded_range_backfills(history, monkeypatch):
    ip = history.ip
    ip.RAW_HISTORY_CACHE['forex:USD_EUR'] = {'rows': covered_rows(history.now)}
    fetch = Mock(return_value=[candle(history.now - datetime.timedelta(days=7))])
    monkeypatch.setattr(ip, '_fetch_range_with_pagination', fetch)
    ip.get_historical_data('EUR_USD', 'forex', '7d')
    fetch.assert_called_once()
    assert history.writer.call_args.args[0].symbol == 'EUR_USD'


@pytest.mark.parametrize('failure', [{'status': 'error'}, {'status': 'ok', 'values': []}, {'status': 'ok', 'values': [candle(close=0)]}])
def test_provider_order_and_inverse(forex_modules, monkeypatch, failure):
    ip = forex_modules.ip
    calls = []
    start = datetime.datetime(2026, 11, 6, 11)
    end = start + datetime.timedelta(hours=2)

    def oanda(**kwargs):
        calls.append(kwargs['instrument'])
        return failure

    def yahoo(symbol, *args):
        calls.append(symbol)
        return failure if symbol == 'EURUSD=X' else {'status': 'ok', 'values': [candle()]}

    monkeypatch.setattr(ip, 'OandaAPI', oanda)
    monkeypatch.setattr(ip, '_fetch_from_yahoo', yahoo)
    result = ip._fetch_incremental_values('EUR_USD', 'forex', start, end, '30m')
    assert calls == ['EUR_USD', 'USD_EUR', 'EURUSD=X', 'USDEUR=X']
    assert result[0]['close'] == 0.4


def test_reverse_oanda_before_yahoo(forex_modules, monkeypatch):
    ip = forex_modules.ip
    fetch = Mock(side_effect=[{'status': 'error'}, {'status': 'ok', 'values': [candle()]}])
    monkeypatch.setattr(ip, 'OandaAPI', fetch)
    yahoo = Mock(side_effect=AssertionError('Should not reach Yahoo'))
    monkeypatch.setattr(ip, '_fetch_from_yahoo', yahoo)
    result = ip._fetch_forex_values('EUR_USD', datetime.datetime(2026, 11, 6), datetime.datetime(2026, 11, 7))
    assert result[0]['close'] == 0.4
    yahoo.assert_not_called()


def test_empty_refresh_retains_usable_history(forex_modules, monkeypatch):
    ip = forex_modules.ip
    fetch = Mock(return_value={'status': 'ok', 'values': []})
    monkeypatch.setattr(ip, 'OandaAPI', fetch)
    assert ip._fetch_forex_values('EUR_USD', datetime.datetime(2026, 11, 6), datetime.datetime(2026, 11, 7), has_usable_history=True) == []
    fetch.assert_called_once()


def test_all_candidates_fail_bounded(forex_modules, monkeypatch):
    ip = forex_modules.ip
    oa = Mock(return_value={'status': 'ok', 'values': [candle('2000-01-01')]})
    yf = Mock(return_value={'status': 'error'})
    monkeypatch.setattr(ip, 'OandaAPI', oa)
    monkeypatch.setattr(ip, '_fetch_from_yahoo', yf)
    with pytest.raises(ip.InferenceProcessorError):
        ip._fetch_forex_values('EUR_USD', datetime.datetime(2026, 11, 6), datetime.datetime(2026, 11, 7))
    assert oa.call_count == yf.call_count == 2


def test_backfill_later_empty_page_still_tries_inverse(forex_modules, monkeypatch):
    ip = forex_modules.ip
    start = datetime.datetime(2026, 11, 6, 10)
    end = start + datetime.timedelta(hours=4)
    calls = []

    def oanda(**kwargs):
        calls.append(kwargs['instrument'])
        if kwargs['from_time'] == start:
            return {'status': 'ok', 'values': [candle(start), candle(start + datetime.timedelta(minutes=30))]}
        if kwargs['instrument'] == 'EUR_USD':
            return {'status': 'ok', 'values': []}
        return {'status': 'ok', 'values': [candle(end)]}

    monkeypatch.setattr(ip, 'OandaAPI', oanda)
    rows = ip._fetch_range_with_pagination('EUR_USD', 'forex', start, end, '30m')
    assert calls == ['EUR_USD', 'EUR_USD', 'USD_EUR']
    assert len(rows) == 3


def test_partial_pagination_survives_later_failure(forex_modules, monkeypatch):
    ip = forex_modules.ip
    start = datetime.datetime(2026, 11, 6, 10)
    fetch = Mock(side_effect=[
        [candle(start), candle(start + datetime.timedelta(minutes=30))],
        ip.InferenceProcessorError('unavailable'),
    ])
    monkeypatch.setattr(ip, '_fetch_incremental_values', fetch)
    assert len(ip._fetch_range_with_pagination('EUR_USD', 'forex', start, start + datetime.timedelta(hours=4), '30m')) == 2


def test_bootstrap_inverse_keeps_deep_max_history(history, monkeypatch):
    ip = history.ip
    calls = []
    deep = candle(history.now - datetime.timedelta(days=365))

    def oanda(**kwargs):
        calls.append(kwargs)
        if kwargs['instrument'] == 'EUR_USD':
            return {'status': 'error'}
        if kwargs['to_time'] == history.now:
            return {'status': 'ok', 'values': [deep, candle(history.now)]}
        return {'status': 'ok', 'values': []}

    monkeypatch.setattr(ip, 'OandaAPI', oanda)
    result = ip.get_historical_data('EUR_USD', 'forex', 'max')
    assert [call['instrument'] for call in calls] == ['EUR_USD', 'USD_EUR', 'USD_EUR']
    assert all(call['granularity'] == 'M30' and call['count'] == 5000 for call in calls)
    assert result[0]['datetime'] == deep['datetime']
    assert result[0]['close'] == 0.4
    assert history.writer.call_args.args[0].symbol == 'EUR_USD'


@pytest.mark.parametrize('empty_source', ['file', 'cache'])
def test_empty_existing_source_still_bootstraps(history, monkeypatch, empty_source):
    ip = history.ip
    if empty_source == 'file':
        history.disk['EUR_USD'] = []
    else:
        ip.RAW_HISTORY_CACHE['forex:EUR_USD'] = {'rows': []}
    bootstrap = Mock(return_value=covered_rows(history.now, 0))
    monkeypatch.setattr(ip, '_collect_fresh_symbol_history', bootstrap)
    ip.get_historical_data('EUR_USD', 'forex', '1d')
    bootstrap.assert_called_once()


def test_bootstrap_page_limit_and_rate_limit(history, monkeypatch):
    ip = history.ip
    calls = []

    def oanda(**kwargs):
        calls.append(kwargs)
        return {'status': 'ok', 'values': [candle(kwargs['to_time'] - datetime.timedelta(days=1))]}

    monkeypatch.setattr(ip, 'OandaAPI', oanda)
    sleep = Mock()
    monkeypatch.setattr(ip.time, 'sleep', sleep)
    rows = ip._fetch_oanda_bootstrap_values('EUR_USD')
    assert len(calls) == len(rows) == 35
    assert calls[1]['to_time'] == history.now - datetime.timedelta(days=1, minutes=1)
    assert all(call['session'] is calls[0]['session'] for call in calls)
    sleep.assert_called_once()


@pytest.mark.parametrize('last_result', [{'status': 'error'}, {'status': 'ok', 'values': []}])
def test_bootstrap_preserves_partial_rows(history, monkeypatch, last_result):
    ip = history.ip
    monkeypatch.setattr(ip, 'OandaAPI', Mock(side_effect=[{'status': 'ok', 'values': [candle(history.now)]}, last_result]))
    assert len(ip._fetch_oanda_bootstrap_values('EUR_USD')) == 1


def test_opposite_concurrent_loads_share_bootstrap(history, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    ip = history.ip
    started, release = Event(), Event()

    def bootstrap(*args):
        started.set()
        assert release.wait(5)
        return covered_rows(history.now, 0)

    fetch = Mock(side_effect=bootstrap)
    monkeypatch.setattr(ip, '_collect_fresh_symbol_history', fetch)
    with ThreadPoolExecutor(2) as pool:
        direct = pool.submit(ip.get_historical_data, 'EUR_USD', 'forex', '1d')
        assert started.wait(5)
        inverse = pool.submit(ip.get_historical_data, 'USD_EUR', 'forex', '1d')
        release.set()
        assert direct.result()[0]['open'] == 2
        assert inverse.result()[0]['open'] == 0.5
    fetch.assert_called_once()


def test_commodity_path_is_unchanged(forex_modules, monkeypatch):
    ip = forex_modules.ip
    fetch = Mock(return_value={'status': 'ok', 'values': [candle()]})
    monkeypatch.setattr(ip, 'OandaAPI', fetch)
    assert ip._fetch_incremental_values('XAU_USD', 'comm', datetime.datetime(2026, 11, 6), datetime.datetime(2026, 11, 7), '30m') == [candle()]
    assert fetch.call_args.kwargs['instrument'] == 'XAU_USD'
