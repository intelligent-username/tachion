from core.processor.ip import (
    InferenceProcessorError,
    background_preprocess_ticker,
    get_historical_data,
    slice_values_by_timespan,
)
from core.processor.history_utils import format_ohlcv
from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from pydantic import BaseModel

router = APIRouter()


class SearchRequest(BaseModel):
    symbol: str
    type: str
    timespan: str = 'max'


@router.post('/search')
async def search(request: SearchRequest):
    asset_class = (request.type or '').strip().lower()
    if asset_class not in {'equities', 'crypto', 'forex', 'comm', 'interest'}:
        raise HTTPException(status_code=400, detail=f"Unknown request type: {request.type}")

    print(
        f"Request received with Symbol {request.symbol}, "
        f"asset type {asset_class}, and timespan {request.timespan}"
    )
    return {'status': 'ok'}


@router.get('/history')
async def get_history(
    background_tasks: BackgroundTasks,
    symbol: str = Query(..., description='Symbol to fetch'),
    asset_class: str = Query(..., description='Asset class: equities, crypto, forex, comm, interest'),
    timespan: str = Query('max', description='Requested range label (e.g. 7d, 30d, ytd, 365d, max)'),
    interval: str = Query('30m', description='Candle interval, currently normalized to 30m')
):
    """Get historical OHLCV data for a symbol."""
    try:
        full_values = get_historical_data(symbol, asset_class, timespan, interval)
        display_values = slice_values_by_timespan(full_values, timespan, buffer_days=0)

        # Background preprocessing (timespan + 7-day buffer), kept in memory.
        background_tasks.add_task(
            background_preprocess_ticker,
            asset_class,
            symbol,
            full_values,
            timespan,
        )

        formatted = format_ohlcv(display_values)
        latest = formatted[-1] if formatted else None
        return {
            'data': formatted,
            'current_price': latest.get('close') if latest else None,
            'current_time': latest.get('timestamp') if latest else None,
        }
    except InferenceProcessorError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
