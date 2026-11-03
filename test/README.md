# Test Suite

Unit tests for all scripts. Expands as needed.

## Structure

```md
test/
├── api-callers/         # API wrapper tests
├── collectors/          # The API callers to get raw data
└── conftest.py          # Pytest configuration
```

## Running Tests

 Run all tests

```bash
pytest
```

Run with verbose output

```bash
pytest -v
```

Run specific test file

```bash
pytest test/test_bapi.py
```

Run specific test class

```bash
pytest test/test_bapi.py::TestBinanceAPI
```

Run with coverage

```bash
pytest --cov=core --cov=data --cov-report=term-missing
```

## Test Coverage

Each function has 7 tests:

- **4 Basic Cases**: Normal use cases and expected behavior
- **3 Edge Cases**: Error handling, empty inputs, and boundary conditions

### API Wrapper Tests

Files from the `core/` folder. We'll trust that the API is returning the correct values (no way to test that here). These tests ensure that the wrapper functions respond with the expected behaviour.

|   Module   |          Function          |
|------------|--------------------------- |
| `bapi.py`  | `BinanceAPI()`             |
| `bapi.py`  | `call_specific_binance()`  |
| `tdapi.py` | `TwelveDataAPI()`          |
| `tdapi.py` | `call_specific_td()`       |
| `oapi.py`  | `OandaAPI()`               |
| `oapi.py`  | `call_specific_oanda()`    |

### Collector Tests

Files from the `data` folder.

|         Module          |    Function     |
|-------------------------|---------------- |
| `crypto/collector.py`   | `write_data()`  |
| `equities/collector.py` | `write_data()`  |
| `forex/collector.py`    | `write_data()`  |

## Dependencies

- `pytest` - Test framework (a main dependency in `pyproject.toml`, installed by `uv sync`)
- `pytest-cov` (optional) - For coverage reports

Install dependencies:

```bash
uv sync
```

Coverage reporting is optional; if you want it, add `pytest-cov` in the venv:

```bash
uv pip install pytest-cov
```
