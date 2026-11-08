"""Provider contracts, with no authenticated calls or real history files."""
from unittest.mock import Mock

import pytest
import requests


def test_directory_filters_deduplicates_and_bounds_request(forex_modules, monkeypatch):
    oa = forex_modules.oa
    response = Mock()
    response.json.return_value = {'instruments': [
        {'name': 'EUR_USD', 'type': 'CURRENCY', 'marginRate': 'private'},
        {'name': 'EUR_USD', 'type': 'CURRENCY'},
        {'name': 'USD_CNH', 'type': 'CURRENCY'},
        {'name': 'XAU_USD', 'type': 'METAL'},
        {'name': 'USD_USD', 'type': 'CURRENCY'},
        {'name': 'BAD', 'type': 'CURRENCY'}, None,
    ]}
    get = Mock(return_value=response)
    monkeypatch.setattr(oa.requests, 'get', get)
    assert oa.get_oanda_forex_instruments() == [
        {'symbol': 'EUR_USD', 'base': 'EUR', 'quote': 'USD'},
        {'symbol': 'USD_CNH', 'base': 'USD', 'quote': 'CNH'},
    ]
    get.assert_called_once_with(
        'https://api-fxpractice.oanda.com/v3/accounts/test-account/instruments',
        headers={'Authorization': 'Bearer test-token'}, timeout=(3.05, 10),
    )


@pytest.mark.parametrize('payload', [None, [], {}, {'instruments': {}}, {'instruments': []}])
def test_invalid_directory(forex_modules, monkeypatch, payload):
    response = Mock()
    response.json.return_value = payload
    monkeypatch.setattr(forex_modules.oa.requests, 'get', Mock(return_value=response))
    with pytest.raises((TypeError, ValueError)):
        forex_modules.oa.get_oanda_forex_instruments()


@pytest.mark.parametrize('error', [requests.Timeout(), requests.HTTPError('401'), requests.HTTPError('429')])
def test_directory_transport_failure(forex_modules, monkeypatch, error):
    monkeypatch.setattr(forex_modules.oa.requests, 'get', Mock(side_effect=error))
    with pytest.raises(requests.RequestException):
        forex_modules.oa.get_oanda_forex_instruments()


def test_directory_requires_configuration(forex_modules, monkeypatch):
    monkeypatch.delenv('OANDA_ACCOUNT_ID')
    get = Mock()
    monkeypatch.setattr(forex_modules.oa.requests, 'get', get)
    with pytest.raises(ValueError):
        forex_modules.oa.get_oanda_forex_instruments()
    get.assert_not_called()


@pytest.mark.parametrize('interval', ['30m', '1h', '1d', '1wk', '1mo'])
@pytest.mark.parametrize('aware', [True, False])
def test_yahoo_keeps_intraday_times_and_daily_format(forex_modules, interval, aware):
    import datetime

    yf = forex_modules.yf
    zone = datetime.timezone(datetime.timedelta(hours=2)) if aware else None
    first = datetime.datetime(2026, 11, 6, 12, tzinfo=zone)
    row = {'Open': 2, 'High': 4, 'Low': 1, 'Close': 2.5, 'Volume': 123}
    hist = Mock(empty=False)
    hist.iterrows.return_value = [(first, row), (first + datetime.timedelta(minutes=30), row)]
    yf.yf.Ticker = Mock(return_value=Mock(history=Mock(return_value=hist)))
    result = yf.YFinanceAPI('EURUSD=X', interval=interval)
    assert result['status'] == 'ok'
    times = [value['datetime'] for value in result['values']]
    if interval in ('30m', '1h'):
        assert times == (['2026-11-06 10:00:00', '2026-11-06 10:30:00'] if aware else ['2026-11-06 12:00:00', '2026-11-06 12:30:00'])
    else:
        assert times == ['2026-11-06', '2026-11-06']
