"""
Shared history/time/ohlcv helpers used by inference and data retrieval flows.
"""

from __future__ import annotations

import datetime
import json
import re
from pathlib import Path

import numpy as np

DATA_ROOT = Path(__file__).resolve().parent.parent.parent / 'data'
ASSET_TO_DATA_DIR = {
    'equities': 'equities',
    'crypto': 'crypto',
    'forex': 'forex',
    'comm': 'comm',
    'interest': 'interest',
}


def normalize_symbol(symbol: str) -> str:
    text = (symbol or '').strip()
    text = text.removeprefix('$')
    return text


def normalize_asset_symbol(asset_class: str, symbol: str) -> str:
    text = normalize_symbol(symbol)
    asset = (asset_class or '').strip().lower()
    if not text:
        return text

    if asset == 'crypto':
        return re.sub(r'[\/_-]?usd[t]?$', '', text, flags=re.IGNORECASE).upper()

    if asset in {'forex', 'comm'}:
        aliases = {
            'GOLD': 'XAU_USD',
            'SILVER': 'XAG_USD',
            'OIL': 'WTICO_USD',
            'WTI': 'WTICO_USD',
            'BRENT': 'BCO_USD',
            'CRUDE': 'WTICO_USD',
        }
        normalized = text.upper().replace('/', '_').replace('-', '_')
        if normalized in aliases:
            return aliases[normalized]
        if re.fullmatch(r'[A-Z]{6}', normalized):
            return f'{normalized[:3]}_{normalized[3:]}'
        return normalized

    return text.upper()


def normalize_interval(interval: str) -> str:
    if not interval:
        return '30m'
    normalized = interval.strip().lower()
    return '30m' if normalized in {'30m', '30min', 'm30'} else '30m'


def parse_timespan_to_days(timespan: str | None) -> float:
    if not timespan or timespan == 'max':
        return 60
    if timespan == 'ytd':
        now = datetime.datetime.now()
        return max(1, (now - datetime.datetime(now.year, 1, 1)).days)

    text = str(timespan).strip().lower()
    hour_match = re.match(r'^(\d+)h$', text)
    day_match = re.match(r'^(\d+)d$', text)
    month_match = re.match(r'^(\d+)m$', text)
    year_match = re.match(r'^(\d+)y$', text)

    if hour_match:
        return max(1, int(hour_match.group(1))) / 24
    if day_match:
        return max(1, int(day_match.group(1)))
    if month_match:
        return max(1, int(month_match.group(1)) * 30)
    if year_match:
        return max(1, int(year_match.group(1)) * 365)
    return 60


def previous_weekday_close(now: datetime.datetime, close_time: datetime.time) -> datetime.datetime:
    day = now.date() - datetime.timedelta(days=1)
    while day.weekday() >= 5:  # 5=Sat, 6=Sun
        day -= datetime.timedelta(days=1)
    return datetime.datetime.combine(day, close_time)


def effective_history_end(asset_class: str, now: datetime.datetime | None = None) -> datetime.datetime:
    now = now or datetime.datetime.now()
    asset = (asset_class or '').strip().lower()

    if asset not in {'equities', 'interest'}:
        return now

    open_time = datetime.time(9, 30)
    close_time = datetime.time(16, 0)

    if now.weekday() >= 5:
        return previous_weekday_close(now, close_time)

    today_open = datetime.datetime.combine(now.date(), open_time)
    today_close = datetime.datetime.combine(now.date(), close_time)

    if today_open <= now <= today_close:
        return now

    if now > today_close:
        return today_close

    return previous_weekday_close(now, close_time)


def to_float(value, default=0.0):
    try:
        if value is None:
            return float(default)
        return float(value)
    except (TypeError, ValueError):
        return float(default)


def parse_timestamp(ts) -> datetime.datetime | None:
    if ts is None:
        return None

    if isinstance(ts, datetime.datetime):
        return ts

    text = str(ts).strip()
    if not text:
        return None

    if text.endswith('Z'):
        text = text[:-1] + '+00:00'

    try:
        dt = datetime.datetime.fromisoformat(text)
        if dt.tzinfo is not None:
            dt = dt.astimezone(datetime.UTC).replace(tzinfo=None)
        return dt
    except ValueError:
        pass

    for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%d'):
        try:
            return datetime.datetime.strptime(text, fmt)
        except ValueError:
            continue

    return None


def normalize_timestamp_str(ts) -> str | None:
    dt = parse_timestamp(ts)
    if dt is None:
        return None
    return dt.strftime('%Y-%m-%d %H:%M:%S')


def normalize_ohlcv_row(row: dict) -> dict | None:
    timestamp = row.get('datetime') or row.get('timestamp') or row.get('date') or row.get('time')
    timestamp = normalize_timestamp_str(timestamp)
    if timestamp is None:
        return None

    close_f = to_float(row.get('close', row.get('value', None)), np.nan)
    if np.isnan(close_f):
        return None

    open_f = to_float(row.get('open', close_f), close_f)
    high_f = to_float(row.get('high', max(open_f, close_f)), max(open_f, close_f))
    low_f = to_float(row.get('low', min(open_f, close_f)), min(open_f, close_f))
    volume_f = to_float(row.get('volume', 0.0), 0.0)

    return {
        'datetime': timestamp,
        'open': open_f,
        'high': max(high_f, open_f, close_f),
        'low': min(low_f, open_f, close_f),
        'close': close_f,
        'volume': volume_f,
    }


def read_raw_data(path: Path) -> list[dict]:
    if not path.exists():
        return []
    try:
        with path.open('r', encoding='utf-8') as f:
            rows = json.load(f)
        if not isinstance(rows, list):
            return []
        normalized = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            n = normalize_ohlcv_row(row)
            if n is not None:
                normalized.append(n)
        normalized.sort(key=lambda r: r['datetime'])
        return normalized
    except Exception:
        return []


def write_raw_data(path: Path, values: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w', encoding='utf-8') as f:
        json.dump(values, f, indent=2)


def raw_file_path(asset_class: str, symbol: str) -> Path:
    asset_key = (asset_class or '').strip().lower()
    if asset_key not in ASSET_TO_DATA_DIR:
        raise ValueError(f'Unknown asset class: {asset_class}')

    ticker_name = normalize_symbol(symbol).replace('/', '_')
    if not ticker_name:
        raise ValueError('Missing symbol/ticker')

    return DATA_ROOT / ASSET_TO_DATA_DIR[asset_key] / 'raw' / f'{ticker_name}.json'


def format_ohlcv(values: list[dict]) -> list[dict]:
    formatted = []
    for v in values:
        timestamp = v.get('datetime') or v.get('timestamp') or v.get('date')
        close = v.get('close', v.get('value'))
        if timestamp is None or close is None:
            continue

        close_f = to_float(close, 0.0)
        open_f = to_float(v.get('open', close_f), close_f)
        high_f = to_float(v.get('high', max(open_f, close_f)), max(open_f, close_f))
        low_f = to_float(v.get('low', min(open_f, close_f)), min(open_f, close_f))
        volume_f = to_float(v.get('volume', 0), 0.0)

        formatted.append({
            'timestamp': str(timestamp),
            'open': open_f,
            'high': max(high_f, open_f, close_f),
            'low': min(low_f, open_f, close_f),
            'close': close_f,
            'volume': volume_f,
            'value': close_f,
        })

    return formatted


def slice_values_by_timespan(values: list[dict], timespan: str, buffer_days: int = 0) -> list[dict]:
    if not values:
        return []

    parsed = []
    for v in values:
        dt = parse_timestamp(v.get('datetime') or v.get('timestamp') or v.get('date'))
        if dt is None:
            continue
        parsed.append((dt, v))

    if not parsed:
        return []

    parsed.sort(key=lambda x: x[0])
    if not timespan or timespan == 'max':
        if buffer_days <= 0:
            return [v for _, v in parsed]
        end = parsed[-1][0]
        start = end - datetime.timedelta(days=buffer_days)
        return [v for dt, v in parsed if dt >= start]

    end_dt = parsed[-1][0]
    days = parse_timespan_to_days(timespan) + max(0, buffer_days)
    start_dt = end_dt - datetime.timedelta(days=days)
    sliced = [v for dt, v in parsed if start_dt <= dt <= end_dt]
    return sliced if sliced else [v for _, v in parsed]


def merge_values(existing: list[dict], incoming: list[dict]) -> list[dict]:
    merged: dict[str, dict] = {}
    for row in existing:
        n = normalize_ohlcv_row(row)
        if n is not None:
            merged[n['datetime']] = n
    for row in incoming:
        n = normalize_ohlcv_row(row)
        if n is not None:
            merged[n['datetime']] = n
    ordered_keys = sorted(merged.keys())
    return [merged[k] for k in ordered_keys]
