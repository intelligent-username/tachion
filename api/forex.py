"""Advisory currency directory; never a restriction on history searches."""
import hashlib
import math
import os
import time
from threading import Condition

import requests
from fastapi import APIRouter, HTTPException

from core.apis.oaapi import get_oanda_forex_instruments

router = APIRouter()
DIRECTORY_TTL_SECONDS = 3600
DIRECTORY_RETRY_SECONDS = 60
_condition = Condition()
_cache = None


def _response(entry, now):
    stale = now >= entry['expires']
    next_attempt = (entry['retry_at'] or now + DIRECTORY_RETRY_SECONDS) if stale else entry['expires']
    return {
        **entry['data'],
        'stale': stale,
        'refreshAfterSeconds': max(1, math.ceil(next_attempt - now)),
    }


@router.get('/forex/currencies')
def get_currencies():
    global _cache
    token = os.getenv('OANDA_KEY', '').strip()
    account = os.getenv('OANDA_ACCOUNT_ID', '').strip()
    key = (account, hashlib.sha256(token.encode()).digest())
    with _condition:
        if _cache is None or _cache['key'] != key:
            _cache = {
                'key': key, 'data': None, 'expires': 0,
                'retry_at': 0, 'error': None, 'fetching': False,
            }
        entry = _cache
        while True:
            now = time.monotonic()
            if entry['data'] is not None and (now < entry['expires'] or entry['fetching']):
                return _response(entry, now)
            if now < entry['retry_at']:
                if entry['data'] is not None:
                    return _response(entry, now)
                code, message = entry['error']
                raise HTTPException(code, message, headers={
                    'Retry-After': str(max(1, math.ceil(entry['retry_at'] - now))),
                })
            if not entry['fetching']:
                entry['fetching'] = True
                break
            _condition.wait()

    error = None
    data = None
    if not token or not account:
        error = (503, 'Currency suggestions are not configured.')
    else:
        try:
            pairs = get_oanda_forex_instruments()
            data = {
                'pairs': pairs,
                'currencies': sorted({code for pair in pairs for code in (pair['base'], pair['quote'])}),
            }
        except requests.Timeout:
            error = (504, 'Currency suggestions timed out. Try again shortly.')
        except (requests.RequestException, ValueError, TypeError, KeyError):
            error = (502, 'Currency suggestions are unavailable. Try again shortly.')

    with _condition:
        now = time.monotonic()
        entry['fetching'] = False
        entry['error'] = error
        if data is not None:
            entry.update(data=data, expires=now + DIRECTORY_TTL_SECONDS, retry_at=0)
        else:
            entry['retry_at'] = now + DIRECTORY_RETRY_SECONDS
        _condition.notify_all()
        if entry['data'] is not None:
            return _response(entry, now)
        code, message = error
        raise HTTPException(code, message, headers={'Retry-After': str(DIRECTORY_RETRY_SECONDS)})
