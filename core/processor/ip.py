"""
Inference processor
This Script handles:
- history refresh
- history slicing
- formatting
- in-memory preprocessing.
"""

from __future__ import annotations

import datetime
from pathlib import Path
from threading import Lock

import numpy as np
import pandas as pd
from core.apis.biapi import BinanceAPI, call_specific_binance
from core.apis.oaapi import OandaAPI, call_specific_oanda
from core.apis.tdapi import TwelveDataAPI, call_specific_td
from core.apis.yfapi import YFinanceAPI
from core.processor.dw import add_crypto_date_features, add_date_features
from core.processor.history_utils import (
	effective_history_end as _effective_history_end,
)
from core.processor.history_utils import (
	merge_values as _merge_values,
)
from core.processor.history_utils import (
	normalize_asset_symbol,
	normalize_interval,
	parse_timespan_to_days,
	parse_timestamp,
	read_raw_data,
	slice_values_by_timespan,
	write_raw_data,
)
from core.processor.history_utils import (
	normalize_ohlcv_row as _normalize_ohlcv_row,
)
from core.processor.history_utils import (
	raw_file_path as _raw_file_path,
)
from core.processor.lr import log_return, volume_change
from core.processor.ma import moving_average
from core.processor.rv import rolling_volatility

# In-memory cache for ticker-specific preprocessed data.
PREPROCESSED_CACHE: dict[str, dict] = {}
PREPROCESSED_LOCK = Lock()

# In-memory cache for raw ticker history to avoid repeated file reads.
RAW_HISTORY_CACHE: dict[str, dict] = {}
RAW_HISTORY_LOCK = Lock()


class InferenceProcessorError(Exception):
	def __init__(self, detail: str, status_code: int = 500):
		super().__init__(detail)
		self.detail = detail
		self.status_code = status_code


def raw_file_path(asset_class: str, symbol: str) -> Path:
	try:
		return _raw_file_path(asset_class, symbol)
	except ValueError as e:
		raise InferenceProcessorError(str(e), status_code=400) from e


def _fetch_from_yahoo(symbol: str, start_date: datetime.datetime, end_date: datetime.datetime, interval: str) -> dict:
	return YFinanceAPI(symbol=symbol, start_date=start_date, end_date=end_date, interval=interval)


def _fetch_from_twelvedata(symbol: str, start_date: datetime.datetime, end_date: datetime.datetime) -> dict:
	try:
		raw = TwelveDataAPI(
			symbol=symbol,
			interval='30min',
			start_date=start_date,
			end_date=end_date,
			format='JSON'
		)
	except Exception as e:
		return {'status': 'error', 'message': str(e)}

	if isinstance(raw, dict) and isinstance(raw.get('values'), list):
		values = list(reversed(raw.get('values', [])))
		return {'status': 'ok', 'values': values}

	if isinstance(raw, dict):
		message = (raw.get('message') or '').lower()
		# Not an upstream failure: just means no new candles in requested window.
		if 'no data is available' in message or 'no data' in message:
			return {'status': 'ok', 'values': []}
		return {'status': 'error', 'message': raw.get('message') or raw.get('status') or 'Unknown TwelveData error'}

	return {'status': 'error', 'message': 'Unexpected TwelveData response'}


def _fetch_incremental_values(
	symbol: str,
	asset_class: str,
	start_date: datetime.datetime,
	end_date: datetime.datetime,
	interval: str,
) -> list[dict]:
	normalized_asset = (asset_class or '').strip().lower()
	normalized_interval = normalize_interval(interval)

	result = None

	if normalized_asset == 'equities':
		result = _fetch_from_twelvedata(symbol, start_date, end_date)
		if result.get('status') == 'error':
			result = _fetch_from_yahoo(symbol, start_date, end_date, normalized_interval)

	elif normalized_asset == 'crypto':
		start_ms = int(start_date.timestamp() * 1000)
		result = BinanceAPI(symbol=symbol, interval='30m', limit=1000, start_time=start_ms)

	elif normalized_asset in {'forex', 'comm'}:
		result = OandaAPI(instrument=symbol, granularity='M30', count=5000, from_time=start_date)
		if result.get('status') == 'error':
			yahoo_symbol = symbol
			if normalized_asset == 'forex' and '_' in symbol:
				base, quote = symbol.split('_', 1)
				yahoo_symbol = f'{base}{quote}=X'
			result = _fetch_from_yahoo(yahoo_symbol, start_date, end_date, normalized_interval)

	elif normalized_asset == 'interest':
		result = _fetch_from_yahoo(symbol, start_date, end_date, normalized_interval)

	else:
		raise InferenceProcessorError(f'Unknown asset class: {asset_class}', status_code=400)

	if not result:
		raise InferenceProcessorError('No response from data provider', status_code=500)

	if result.get('status') == 'error':
		raise InferenceProcessorError(result.get('message', 'Upstream API error'), status_code=502)

	values = result.get('values', [])
	if not isinstance(values, list):
		return []
	return values


def _fetch_range_with_pagination(
	symbol: str,
	asset_class: str,
	start_date: datetime.datetime,
	end_date: datetime.datetime,
	interval: str,
	max_pages: int = 24,
) -> list[dict]:
	"""Fetch [start_date, end_date] with pagination using provider-specific page limits."""
	if start_date >= end_date:
		return []

	step = datetime.timedelta(minutes=30)
	cursor = start_date
	merged: dict[str, dict] = {}

	for _ in range(max_pages):
		if cursor >= end_date:
			break

		batch = _fetch_incremental_values(symbol, asset_class, cursor, end_date, interval)
		if not batch:
			break

		normalized_batch = []
		for row in batch:
			n = _normalize_ohlcv_row(row if isinstance(row, dict) else {})
			if n is None:
				continue
			dt = parse_timestamp(n['datetime'])
			if dt is None:
				continue
			if cursor <= dt <= end_date:
				normalized_batch.append((dt, n))

		if not normalized_batch:
			break

		normalized_batch.sort(key=lambda x: x[0])
		for _, row in normalized_batch:
			merged[row['datetime']] = row

		newest_dt = normalized_batch[-1][0]
		if newest_dt <= cursor:
			break

		cursor = newest_dt + step

		# If we reached (or effectively reached) requested end, stop.
		if newest_dt >= (end_date - step):
			break

	ordered = sorted(merged.keys())
	return [merged[k] for k in ordered]


def _collect_fresh_symbol_history(raw_path: Path, symbol: str, asset_class: str) -> list[dict]:
	"""Reuse collector/core-api pagination defaults for first-time symbols."""
	asset = (asset_class or '').strip().lower()
	out_dir = str(raw_path.parent)

	if asset == 'equities':
		# Same collector strategy: TwelveData paginated calls.
		call_specific_td(out_dir, symbols=[symbol], num_calls=3, json_indent=2)
	elif asset == 'crypto':
		# Same collector strategy: Binance deep pagination.
		call_specific_binance(out_dir, symbols=[symbol], num_calls=87, json_indent=2)
	elif asset == 'forex':
		# Same collector strategy: OANDA pagination.
		call_specific_oanda(out_dir, instruments=[symbol], num_calls=35, json_indent=2)
	elif asset == 'comm':
		# Same collector strategy: OANDA pagination.
		call_specific_oanda(out_dir, instruments=[symbol], num_calls=36, json_indent=2)
	else:
		# Interest and unknown assets stay on normal incremental path.
		return []

	return read_raw_data(raw_path)


def _build_preprocessed_frame(asset_class: str, symbol: str, rows: list[dict]) -> pd.DataFrame:
	if not rows:
		return pd.DataFrame()

	df = pd.DataFrame(rows)
	if df.empty:
		return df

	df['datetime'] = pd.to_datetime(df['datetime'])
	df = df.sort_values('datetime').reset_index(drop=True)
	df['close'] = pd.to_numeric(df['close'], errors='coerce')
	df['volume'] = pd.to_numeric(df.get('volume', 0), errors='coerce').fillna(0)
	df = df.dropna(subset=['close'])

	if df.empty:
		return df

	normalized_asset = (asset_class or '').strip().lower()

	df['log_return'] = log_return(df['close'])
	df['log_return_lag1'] = df['log_return'].shift(1)

	if normalized_asset == 'equities':
		df['volume_change'] = volume_change(df['volume'].replace(0, np.nan).ffill())
		df['5_day_MA'] = moving_average(df['close'], window=5)
		df['50_day_MA'] = moving_average(df['close'], window=50)
		df['rolling_volatility_5'] = rolling_volatility(df['log_return'], window=5)
		df['rolling_volatility_50'] = rolling_volatility(df['log_return'], window=50)
		df = add_date_features(df, date_col='datetime')
		df['ticker'] = symbol
		columns = [
			'ticker', 'datetime', 'log_return', 'log_return_lag1', 'volume_change',
			'5_day_MA', '50_day_MA', 'rolling_volatility_5', 'rolling_volatility_50',
			'day_of_week', 'day_of_month', 'quarter'
		]

	elif normalized_asset == 'crypto':
		df['volume_change'] = volume_change(df['volume'].replace(0, np.nan).ffill())
		df['5_period_MA'] = moving_average(df['close'], window=5)
		df['20_period_MA'] = moving_average(df['close'], window=20)
		df['rolling_volatility_5'] = rolling_volatility(df['log_return'], window=5)
		df['rolling_volatility_20'] = rolling_volatility(df['log_return'], window=20)
		df = add_crypto_date_features(df, date_col='datetime')
		df['symbol'] = symbol
		columns = [
			'symbol', 'datetime', 'log_return', 'log_return_lag1', 'volume_change',
			'5_period_MA', '20_period_MA', 'rolling_volatility_5', 'rolling_volatility_20',
			'hour_of_day', 'day_of_week', 'day_of_month', 'is_weekend'
		]

	elif normalized_asset in {'forex', 'comm'}:
		df['MA_50'] = moving_average(df['close'], window=50)
		df['MA_200'] = moving_average(df['close'], window=200)
		df['rolling_vol_50'] = rolling_volatility(df['log_return'], window=50)
		df['rolling_vol_200'] = rolling_volatility(df['log_return'], window=200)
		df = add_date_features(df, date_col='datetime')
		df['symbol'] = symbol
		columns = [
			'symbol', 'datetime', 'log_return', 'log_return_lag1',
			'MA_50', 'MA_200', 'rolling_vol_50', 'rolling_vol_200',
			'day_of_week', 'day_of_month', 'quarter'
		]

	else:
		df = add_date_features(df, date_col='datetime')
		df['symbol'] = symbol
		columns = ['symbol', 'datetime', 'log_return', 'log_return_lag1', 'day_of_week', 'day_of_month', 'quarter']

	out = df[columns].copy()
	out.rename(columns={'datetime': 'timestamp'}, inplace=True)
	out = out.replace([np.inf, -np.inf], np.nan)
	return out


def background_preprocess_ticker(asset_class: str, symbol: str, full_rows: list[dict], timespan: str) -> None:
	buffered_rows = slice_values_by_timespan(full_rows, timespan, buffer_days=7)
	frame = _build_preprocessed_frame(asset_class, symbol, buffered_rows)
	records = [] if frame.empty else frame.where(pd.notna(frame), None).to_dict(orient='records')

	cache_key = f"{asset_class.lower()}:{symbol}"
	with PREPROCESSED_LOCK:
		PREPROCESSED_CACHE[cache_key] = {
			'asset_class': asset_class.lower(),
			'symbol': symbol,
			'timespan': timespan,
			'updated_at': datetime.datetime.utcnow().isoformat() + 'Z',
			'rows': records,
		}


def get_historical_data(symbol: str, asset_class: str, timespan: str = 'max', interval: str = '30m') -> list[dict]:
	"""Update raw file from last stored point to effective market end and return normalized rows."""
	symbol = normalize_asset_symbol(asset_class, symbol)
	raw_path = raw_file_path(asset_class, symbol)
	cache_key = f"{(asset_class or '').strip().lower()}:{(symbol or '').strip()}"
	file_existed = raw_path.exists()
	with RAW_HISTORY_LOCK:
		cached = RAW_HISTORY_CACHE.get(cache_key)

	if cached is not None:
		existing_values = cached.get('rows', [])
	else:
		existing_values = read_raw_data(raw_path)
		with RAW_HISTORY_LOCK:
			RAW_HISTORY_CACHE[cache_key] = {
				'rows': existing_values,
				'loaded_at': datetime.datetime.utcnow(),
			}

	now = _effective_history_end(asset_class, datetime.datetime.now())
	requested_days = max(1, parse_timespan_to_days(timespan))
	requested_start = now - datetime.timedelta(days=requested_days)
	step = datetime.timedelta(minutes=30)
	last_dt = parse_timestamp(existing_values[-1].get('datetime')) if existing_values else None
	first_dt = parse_timestamp(existing_values[0].get('datetime')) if existing_values else None

	is_fresh_symbol = (not file_existed) and (cached is None) and (not existing_values)

	needs_forward_refresh = (last_dt is None) or ((now - last_dt) >= datetime.timedelta(minutes=25))
	needs_backfill = (first_dt is None) or (first_dt > (requested_start + step))

	if not needs_forward_refresh and not needs_backfill:
		return existing_values

	merged_values = existing_values

	# Fresh symbol bootstrap: reuse collector/core-api pagination once.
	if is_fresh_symbol:
		try:
			bootstrapped = _collect_fresh_symbol_history(raw_path, symbol, asset_class)
		except Exception:
			bootstrapped = []

		if bootstrapped:
			merged_values = _merge_values(merged_values, bootstrapped)
			first_dt = parse_timestamp(merged_values[0].get('datetime')) if merged_values else first_dt
			last_dt = parse_timestamp(merged_values[-1].get('datetime')) if merged_values else last_dt
			needs_backfill = (first_dt is None) or (first_dt > (requested_start + step))
			needs_forward_refresh = (last_dt is None) or ((now - last_dt) >= datetime.timedelta(minutes=25))

	# Backfill for expanded timespan requests when earliest cached point is too recent.
	if needs_backfill:
		if first_dt is not None:
			backfill_end = first_dt - step
		else:
			backfill_end = now

		if requested_start < backfill_end:
			try:
				backfill_values = _fetch_range_with_pagination(symbol, asset_class, requested_start, backfill_end, interval)
			except InferenceProcessorError:
				backfill_values = []

			if backfill_values:
				merged_values = _merge_values(merged_values, backfill_values)

	# Forward incremental refresh for latest candles.
	if needs_forward_refresh:
		if merged_values:
			latest_dt = parse_timestamp(merged_values[-1].get('datetime'))
			start_date = (latest_dt + step) if latest_dt else (now - datetime.timedelta(days=requested_days))
		else:
			start_date = requested_start

		if start_date < now:
			try:
				incoming_values = _fetch_range_with_pagination(symbol, asset_class, start_date, now, interval)
			except InferenceProcessorError:
				if merged_values:
					incoming_values = []
				else:
					raise

			if incoming_values:
				merged_values = _merge_values(merged_values, incoming_values)

	if merged_values and merged_values != existing_values:
		write_raw_data(raw_path, merged_values)
		with RAW_HISTORY_LOCK:
			RAW_HISTORY_CACHE[cache_key] = {
				'rows': merged_values,
				'loaded_at': datetime.datetime.utcnow(),
			}

	return merged_values

