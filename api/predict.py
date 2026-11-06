"""
API endpoints for the frontend.

1) GET /api/predict - Placeholder prediction endpoint
2) POST /api/predict - Same payload format support for compatibility
"""

import datetime
import json
import math
import sys
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

# Add project root to path for imports
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

router = APIRouter()


def _parse_datetime(value: str) -> datetime.datetime:
    text = str(value)
    if text.endswith('Z'):
        text = text[:-1] + '+00:00'

    try:
        dt = datetime.datetime.fromisoformat(text)
        if dt.tzinfo is not None:
            dt = dt.astimezone(datetime.UTC).replace(tzinfo=None)
        return dt
    except ValueError:
        pass

    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.datetime.strptime(text, fmt)
        except ValueError:
            continue

    raise ValueError(f"Unsupported datetime format: {value}")


class PredictRequest(BaseModel):
    symbol: str
    asset_class: str
    candles: list[dict[str, Any]]


class PredictionPoint(BaseModel):
    timestamp: str
    median: float
    lower: float
    upper: float


class PredictResponse(BaseModel):
    predictions: list[PredictionPoint]
    metadata: dict


def _extract_candle_datetime(row: dict[str, Any]) -> datetime.datetime | None:
    for key in ('datetime', 'timestamp', 'date', 'time'):
        value = row.get(key)
        if value is None:
            continue
        try:
            return _parse_datetime(str(value))
        except Exception:
            continue
    return None


def _extract_last_close(candles: list[dict[str, Any]]) -> float:
    for row in reversed(candles):
        try:
            close = row.get('close')
            if close is None:
                continue
            return float(close)
        except (TypeError, ValueError):
            continue
    return 0.0


def _prediction_end_bound(now: datetime.datetime) -> datetime.datetime:
    close_time = datetime.time(16, 0)
    today_close = datetime.datetime.combine(now.date(), close_time)
    return min(today_close, now)


def _build_prediction_response(symbol: str, asset_class: str, candles: list[dict[str, Any]]) -> PredictResponse:
    if not candles:
        raise HTTPException(status_code=400, detail='Missing candles data')

    parsed_dates = [d for d in (_extract_candle_datetime(row) for row in candles) if d is not None]
    if not parsed_dates:
        raise HTTPException(status_code=400, detail='No valid candle timestamps found')

    start_date = min(parsed_dates)
    now = datetime.datetime.now()
    end_date = _prediction_end_bound(now)
    timeframe = end_date - start_date

    print(
        f"Request Prediction request with Symbol {symbol}, "
        f"start date {start_date}, end date {end_date}, "
        f"totalling a time frame of {timeframe}"
    )

    n = len(candles)
    point_count = max(0, math.floor(math.log(n))) if n > 0 else 0
    last_close = _extract_last_close(candles)

    # =========================================================================
    # TODO: INFERENCE
    # =========================================================================
    # A real model invocation would happen here. For now, this is a dummy path.
    # Right now, I'm just tweaking the models.
    # Should be stored on HuggingFace
    # 
    # Example pseudo-code for when models are done:
    # try:
    #     model = load_predictor(asset_class, "tft2")
    #     forecast = model.predict(candles, point_count)
    #     for f in forecast:
    #         predictions.append(PredictionPoint(
    #             timestamp=f.timestamp, median=f.median, lower=f.lower, upper=f.upper
    #         ))
    # except Exception as e:
    #     handle_error()
    # =========================================================================

    predictions: list[PredictionPoint] = []
    for i in range(1, point_count + 1):
        ts = end_date + datetime.timedelta(days=i)
        predictions.append(
            PredictionPoint(
                timestamp=ts.strftime('%Y-%m-%d %H:%M:%S'),
                median=last_close,
                lower=last_close,
                upper=last_close,
            )
        )

    return PredictResponse(
        predictions=predictions,
        metadata={
            'symbol': symbol,
            'asset_class': asset_class,
            'points': point_count,
            'placeholder': True,
            'start_date': start_date.strftime('%Y-%m-%d %H:%M:%S'),
            'end_date': end_date.strftime('%Y-%m-%d %H:%M:%S'),
            'timeframe': str(timeframe),
        },
    )


@router.get('/predict', response_model=PredictResponse)
async def predict_get(
    symbol: str,
    asset_class: str,
    candles: str = Query(default='[]', description='JSON-encoded candle list'),
):
    """Placeholder prediction endpoint (GET)."""
    try:
        candle_rows = json.loads(candles)
        if not isinstance(candle_rows, list):
            raise ValueError('candles must decode to a list')
    except Exception as e:
        raise HTTPException(status_code=400, detail=f'Invalid candles query payload: {e}')

    return _build_prediction_response(symbol, asset_class, candle_rows)


@router.post('/predict', response_model=PredictResponse)
async def predict_post(request: PredictRequest):
    """Compatibility endpoint (POST) using same response format."""
    return _build_prediction_response(request.symbol, request.asset_class, request.candles)
