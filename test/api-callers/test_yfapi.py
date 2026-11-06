"""
Unit tests for core/apis/yfapi.py - Yahoo Finance API wrapper
"""

import datetime
import json
import os
import tempfile
from unittest.mock import MagicMock, patch

from core import YFinanceAPI, call_specific_yf

# ============================================================================
# YFinanceAPI Tests
# ============================================================================

class TestYFinanceAPI:
    """Tests for the YFinanceAPI function"""

    # --- Basic Cases (4) ---

    @patch('core.apis.yfapi.yf.Ticker')
    def test_basic_symbol_request(self, mock_ticker_class):
        """Test basic symbol request returns valid structure"""
        mock_ticker = MagicMock()
        mock_ticker_class.return_value = mock_ticker

        # Mock pandas DataFrame
        mock_hist = MagicMock()
        mock_hist.empty = False
        mock_hist.iterrows.return_value = [
            (datetime.datetime(2024, 1, 1), {
                "Open": 100.0, "High": 101.0, "Low": 99.0,
                "Close": 100.5, "Volume": 1000
            })
        ]
        mock_ticker.history.return_value = mock_hist

        result = YFinanceAPI(symbol="AAPL")

        assert result["status"] == "ok"
        assert "values" in result
        assert isinstance(result["values"], list)
        assert len(result["values"]) == 1
        candle = result["values"][0]
        assert candle["datetime"] == "2024-01-01"
        assert candle["open"] == 100.0
        assert candle["close"] == 100.5
        assert candle["volume"] == 1000

    @patch('core.apis.yfapi.yf.Ticker')
    def test_with_date_range(self, mock_ticker_class):
        """Test request with start and end dates"""
        mock_ticker = MagicMock()
        mock_ticker_class.return_value = mock_ticker

        mock_hist = MagicMock()
        mock_hist.empty = False
        mock_hist.iterrows.return_value = []
        mock_ticker.history.return_value = mock_hist

        start_date = datetime.datetime(2024, 1, 1)
        end_date = datetime.datetime(2024, 12, 31)

        YFinanceAPI(symbol="AAPL", start_date=start_date, end_date=end_date)

        mock_ticker.history.assert_called_once()
        call_args = mock_ticker.history.call_args
        assert call_args[1]["start"] == start_date
        assert call_args[1]["end"] == end_date
        assert call_args[1]["interval"] == "1d"

    @patch('core.apis.yfapi.yf.Ticker')
    def test_custom_interval(self, mock_ticker_class):
        """Test request with custom interval"""
        mock_ticker = MagicMock()
        mock_ticker_class.return_value = mock_ticker

        mock_hist = MagicMock()
        mock_hist.empty = False
        mock_hist.iterrows.return_value = []
        mock_ticker.history.return_value = mock_hist

        YFinanceAPI(symbol="AAPL", interval="1wk")

        call_args = mock_ticker.history.call_args
        assert call_args[1]["interval"] == "1wk"

    @patch('core.apis.yfapi.yf.Ticker')
    def test_empty_history_returns_empty_values(self, mock_ticker_class):
        """Test that empty history returns empty values list"""
        mock_ticker = MagicMock()
        mock_ticker_class.return_value = mock_ticker

        mock_hist = MagicMock()
        mock_hist.empty = True
        mock_ticker.history.return_value = mock_hist

        result = YFinanceAPI(symbol="INVALID")

        assert result["status"] == "ok"
        assert result["values"] == []

    # --- Edge Cases (3) ---

    @patch('core.apis.yfapi.yf.Ticker')
    def test_api_exception_returns_error(self, mock_ticker_class):
        """Test that API exceptions return error status"""
        mock_ticker = MagicMock()
        mock_ticker_class.return_value = mock_ticker
        mock_ticker.history.side_effect = Exception("API Error")

        result = YFinanceAPI(symbol="INVALID")

        assert result["status"] == "error"
        assert "message" in result
        assert "API Error" in result["message"]

    @patch('core.apis.yfapi.yf.Ticker')
    def test_none_history_returns_empty(self, mock_ticker_class):
        """Test that None history returns empty values"""
        mock_ticker = MagicMock()
        mock_ticker_class.return_value = mock_ticker
        mock_ticker.history.return_value = None

        result = YFinanceAPI(symbol="INVALID")

        assert result["status"] == "ok"
        assert result["values"] == []

    @patch('core.apis.yfapi.yf.Ticker')
    def test_handles_timezone_aware_datetime(self, mock_ticker_class):
        """Test handling of timezone-aware datetime"""
        mock_ticker = MagicMock()
        mock_ticker_class.return_value = mock_ticker

        mock_hist = MagicMock()
        mock_hist.empty = False
        dt_with_tz = datetime.datetime(2024, 1, 1, tzinfo=datetime.UTC)
        mock_hist.iterrows.return_value = [
            (dt_with_tz, {
                "Open": 100.0, "High": 101.0, "Low": 99.0,
                "Close": 100.5, "Volume": 1000
            })
        ]
        mock_ticker.history.return_value = mock_hist

        result = YFinanceAPI(symbol="AAPL")

        assert result["status"] == "ok"
        assert result["values"][0]["datetime"] == "2024-01-01"


# ============================================================================
# call_specific_yf Tests
# ============================================================================

class TestCallSpecificYF:
    """Tests for the call_specific_yf function"""

    # --- Basic Cases (4) ---

    def test_creates_output_directory(self):
        """Test that function creates output directory if needed"""
        with tempfile.TemporaryDirectory() as tmpdir:
            subdir = os.path.join(tmpdir, "nonexistent", "path")

            with patch('core.apis.yfapi.YFinanceAPI') as mock_api:
                mock_api.return_value = {"status": "ok", "values": []}

                # Should not raise even if directory doesn't exist
                call_specific_yf(subdir, symbols=["AAPL"])

    def test_writes_json_file(self):
        """Test that function writes JSON file for symbol"""
        with tempfile.TemporaryDirectory() as tmpdir:
            mock_values = [
                {"datetime": "2024-01-01", "open": 100.0, "high": 101.0,
                 "low": 99.0, "close": 100.5, "volume": 1000}
            ]

            with patch('core.apis.yfapi.YFinanceAPI') as mock_api:
                mock_api.return_value = {"status": "ok", "values": mock_values}

                call_specific_yf(tmpdir, symbols=["AAPL"])

                file_path = os.path.join(tmpdir, "AAPL.json")
                assert os.path.exists(file_path)

                with open(file_path, "r") as f:
                    data = json.load(f)
                assert len(data) == 1
                assert data[0]["datetime"] == "2024-01-01"

    def test_handles_multiple_symbols(self):
        """Test that function handles multiple symbols"""
        with tempfile.TemporaryDirectory() as tmpdir:
            mock_values = [
                {"datetime": "2024-01-01", "open": 100.0, "high": 101.0,
                 "low": 99.0, "close": 100.5, "volume": 1000}
            ]

            with patch('core.apis.yfapi.YFinanceAPI') as mock_api:
                mock_api.return_value = {"status": "ok", "values": mock_values}

                call_specific_yf(tmpdir, symbols=["AAPL", "GOOGL"])

                assert os.path.exists(os.path.join(tmpdir, "AAPL.json"))
                assert os.path.exists(os.path.join(tmpdir, "GOOGL.json"))

    def test_respects_rate_limit(self):
        """Test that function respects rate limit"""
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch('core.apis.yfapi.YFinanceAPI') as mock_api:
                mock_api.return_value = {"status": "ok", "values": []}
                with patch('time.sleep') as mock_sleep:
                    call_specific_yf(tmpdir, symbols=["S1", "S2", "S3", "S4", "S5", "S6"], rate_limit=2)

                    # Should sleep when hitting rate limit
                    mock_sleep.assert_called()

    # --- Edge Cases (3) ---

    def test_handles_api_error(self):
        """Test that API errors are handled gracefully"""
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch('core.apis.yfapi.YFinanceAPI') as mock_api:
                mock_api.return_value = {"status": "error", "message": "API Error"}

                # Should not raise, just skip the symbol
                call_specific_yf(tmpdir, symbols=["INVALID"])

                # File should not be created
                assert not os.path.exists(os.path.join(tmpdir, "INVALID.json"))

    def test_updates_existing_file(self):
        """Test updating existing file with new data"""
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = os.path.join(tmpdir, "AAPL.json")

            # Create existing file
            existing_data = [{"datetime": "2024-01-01", "open": 100.0, "close": 100.5, "volume": 1000}]
            with open(file_path, "w") as f:
                json.dump(existing_data, f)

            new_values = [{"datetime": "2024-01-02", "open": 101.0, "close": 101.5, "volume": 2000}]

            with patch('core.apis.yfapi.YFinanceAPI') as mock_api:
                mock_api.return_value = {"status": "ok", "values": new_values}

                call_specific_yf(tmpdir, symbols=["AAPL"])

                with open(file_path, "r") as f:
                    data = json.load(f)
                assert len(data) == 2  # Should have both old and new data

    def test_handles_special_characters_in_symbols(self):
        """Test handling of special characters in symbol names"""
        with tempfile.TemporaryDirectory() as tmpdir:
            mock_values = [{"datetime": "2024-01-01", "open": 100.0, "close": 100.5, "volume": 1000}]

            with patch('core.apis.yfapi.YFinanceAPI') as mock_api:
                mock_api.return_value = {"status": "ok", "values": mock_values}

                # Test symbols with ^ and = characters
                call_specific_yf(tmpdir, symbols=["^VIX", "AAPL=INVALID"])

                assert os.path.exists(os.path.join(tmpdir, "VIX.json"))
                assert os.path.exists(os.path.join(tmpdir, "AAPL_INVALID.json"))