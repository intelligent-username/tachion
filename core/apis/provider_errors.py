"""Conservative classification of provider-specific symbol rejections."""


class InvalidSymbolError(Exception):
    """A provider explicitly rejected an instrument identifier."""


def is_invalid_symbol(provider, status_code, payload):
    if not isinstance(payload, dict):
        return False
    return provider == 'binance' and payload.get('code') == -1121
