"""
Unit tests for the OANDA API wrapper
Found in core/apis/oaapi.py
"""

import json
import os
import tempfile
from unittest.mock import MagicMock, patch

import pytest
from core import OandaAPI, call_specific_oanda

# ============================================================================
# OandaAPI Tests
# ============================================================================

class TestOandaAPI:
    """Tests for the OandaAPI function"""

    @patch('core.apis.oaapi.os.getenv')
    @patch('core.apis.oaapi.requests.get')
    def test_basic_request_structure(self, mock_get, mock_getenv):
        """Test basic request returns valid structure"""
        mock_getenv.return_value = "fake_token"
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "candles": [
                {"time": "2024-01-01T12:00:00Z", "complete": True, "volume": 100,
                 "mid": {"o": "1.1000", "h": "1.1050", "l": "1.0950", "c": "1.1025"}}
            ]
        }
        mock_response.raise_for_status = MagicMock()
        mock_get.return_value = mock_response
        
        result = OandaAPI(instrument="EUR_USD")
        
        assert result["status"] == "ok"
        assert "values" in result
        assert len(result["values"]) == 1

    @patch('core.apis.oaapi.os.getenv')
    @patch('core.apis.oaapi.requests.get')
    def test_datetime_formatting(self, mock_get, mock_getenv):
        """Test that datetime is formatted correctly"""
        mock_getenv.return_value = "fake_token"
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "candles": [
                {"time": "2024-06-15T14:30:00Z", "complete": True, "volume": 100,
                 "mid": {"o": "1.1", "h": "1.2", "l": "1.0", "c": "1.15"}}
            ]
        }
        mock_response.raise_for_status = MagicMock()
        mock_get.return_value = mock_response
        
        result = OandaAPI(instrument="EUR_USD")
        
        assert result["values"][0]["datetime"] == "2024-06-15 14:30:00"

    @patch('core.apis.oaapi.os.getenv')
    @patch('core.apis.oaapi.requests.get')
    def test_custom_granularity(self, mock_get, mock_getenv):
        """Test request with custom granularity"""
        mock_getenv.return_value = "fake_token"
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"candles": []}
        mock_response.raise_for_status = MagicMock()
        mock_get.return_value = mock_response
        
        OandaAPI(instrument="EUR_USD", granularity="H1")
        
        call_args = mock_get.call_args
        assert call_args[1]["params"]["granularity"] == "H1"

    @patch('core.apis.oaapi.requests.Session')
    def test_uses_session_when_provided(self, mock_session_class):
        """Test that session is used when provided"""
        mock_session = MagicMock()
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"candles": []}
        mock_response.raise_for_status = MagicMock()
        mock_session.get.return_value = mock_response
        
        OandaAPI(instrument="EUR_USD", session=mock_session)
        
        mock_session.get.assert_called_once()

    def test_missing_instrument_raises_error(self):
        """Test that missing instrument raises ValueError"""
        with pytest.raises(ValueError, match="Instrument can't be blank"):
            OandaAPI(instrument=None)

    @patch.dict(os.environ, {}, clear=True)
    def test_missing_token_raises_error(self):
        """Test that missing token raises ValueError when no session"""
        with pytest.raises(ValueError, match="OANDA_KEY not found"):
            OandaAPI(instrument="EUR_USD", session=None, token=None)

    @patch('core.apis.oaapi.os.getenv')
    @patch('core.apis.oaapi.requests.get')
    def test_skips_incomplete_candles(self, mock_get, mock_getenv):
        """Test that incomplete candles are skipped"""
        mock_getenv.return_value = "fake_token"
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "candles": [
                {"time": "2024-01-01T12:00:00Z", "complete": True, "volume": 100,
                 "mid": {"o": "1.1", "h": "1.2", "l": "1.0", "c": "1.15"}},
                {"time": "2024-01-01T12:30:00Z", "complete": False, "volume": 50,
                 "mid": {"o": "1.15", "h": "1.2", "l": "1.1", "c": "1.18"}}
            ]
        }
        mock_response.raise_for_status = MagicMock()
        mock_get.return_value = mock_response
        
        result = OandaAPI(instrument="EUR_USD")
        
        # Should only return 1 candle (the complete one)
        assert len(result["values"]) == 1


# ============================================================================
# call_specific_oanda Tests
# ============================================================================

class TestCallSpecificOanda:
    """Tests for the call_specific_oanda function"""

    @patch('core.apis.oaapi.os.getenv')
    @patch('core.apis.oaapi.OandaAPI')
    @patch('core.apis.oaapi.requests.Session')
    def test_creates_session(self, mock_session_class, mock_api, mock_getenv):
        """Test that function creates a persistent session"""
        mock_getenv.return_value = "fake_token"
        mock_api.return_value = {"status": "ok", "values": []}
        
        with tempfile.TemporaryDirectory() as tmpdir:
            call_specific_oanda(tmpdir, instruments=["EUR_USD"], num_calls=1)
            
        mock_session_class.assert_called_once()

    @patch('core.apis.oaapi.os.getenv')
    @patch('core.apis.oaapi.OandaAPI')
    @patch('core.apis.oaapi.requests.Session')
    def test_writes_json_file(self, mock_session_class, mock_api, mock_getenv):
        """Test that function writes JSON file"""
        mock_getenv.return_value = "fake_token"
        mock_api.return_value = {
            "status": "ok",
            "values": [{"datetime": "2024-01-01 12:00:00", "open": "1.1", 
                       "high": "1.2", "low": "1.0", "close": "1.15", "volume": "100"}]
        }
        
        with tempfile.TemporaryDirectory() as tmpdir:
            call_specific_oanda(tmpdir, instruments=["EUR_USD"], num_calls=1)
            
            assert os.path.exists(os.path.join(tmpdir, "EUR_USD.json"))

    @patch('core.apis.oaapi.os.getenv')
    @patch('core.apis.oaapi.OandaAPI')
    @patch('core.apis.oaapi.requests.Session')
    def test_handles_multiple_instruments(self, mock_session_class, mock_api, mock_getenv):
        """Test that function handles multiple instruments"""
        mock_getenv.return_value = "fake_token"
        mock_api.return_value = {
            "status": "ok",
            "values": [{"datetime": "2024-01-01 12:00:00", "open": "1.1",
                       "high": "1.2", "low": "1.0", "close": "1.15", "volume": "100"}]
        }
        
        with tempfile.TemporaryDirectory() as tmpdir:
            call_specific_oanda(tmpdir, instruments=["EUR_USD", "GBP_USD"], num_calls=1)
            
            assert os.path.exists(os.path.join(tmpdir, "EUR_USD.json"))
            assert os.path.exists(os.path.join(tmpdir, "GBP_USD.json"))

    @patch('core.apis.oaapi.os.getenv')
    @patch('core.apis.oaapi.OandaAPI')
    @patch('core.apis.oaapi.requests.Session')
    def test_respects_rate_limit(self, mock_session_class, mock_api, mock_getenv):
        """Test that rate_limit parameter is accepted"""
        mock_getenv.return_value = "fake_token"
        mock_api.return_value = {"status": "ok", "values": []}
        
        with tempfile.TemporaryDirectory() as tmpdir:
            # Should not raise with custom rate_limit
            call_specific_oanda(tmpdir, instruments=["EUR_USD"], num_calls=1, rate_limit=10)

    @patch('core.apis.oaapi.os.getenv')
    def test_missing_token_raises_error(self, mock_getenv):
        """Test that missing OANDA_KEY raises error"""
        mock_getenv.return_value = None
        
        with tempfile.TemporaryDirectory() as tmpdir:
            with pytest.raises(ValueError, match="OANDA_KEY not found"):
                call_specific_oanda(tmpdir, instruments=["EUR_USD"], num_calls=1)

    @patch('core.apis.oaapi.os.getenv')
    @patch('core.apis.oaapi.OandaAPI')
    @patch('core.apis.oaapi.requests.Session')
    def test_handles_api_error(self, mock_session_class, mock_api, mock_getenv):
        """Test that function handles API errors gracefully"""
        mock_getenv.return_value = "fake_token"
        mock_api.return_value = {"status": "error", "message": "Invalid token"}
        
        with tempfile.TemporaryDirectory() as tmpdir:
            # Should not raise
            call_specific_oanda(tmpdir, instruments=["EUR_USD"], num_calls=1)

    @patch('core.apis.oaapi.os.getenv')
    @patch('core.apis.oaapi.OandaAPI')
    @patch('core.apis.oaapi.requests.Session')
    def test_deduplicates_data(self, mock_session_class, mock_api, mock_getenv):
        """Test that function removes duplicate entries"""
        mock_getenv.return_value = "fake_token"
        # Return duplicate datetimes
        mock_api.return_value = {
            "status": "ok",
            "values": [
                {"datetime": "2024-01-01 12:00:00", "open": "1.1", "high": "1.2",
                 "low": "1.0", "close": "1.15", "volume": "100"},
                {"datetime": "2024-01-01 12:00:00", "open": "1.1", "high": "1.2",
                 "low": "1.0", "close": "1.15", "volume": "100"}
            ]
        }
        
        with tempfile.TemporaryDirectory() as tmpdir:
            call_specific_oanda(tmpdir, instruments=["EUR_USD"], num_calls=1)
            
            with open(os.path.join(tmpdir, "EUR_USD.json"), "r") as f:
                data = json.load(f)
            
            assert len(data) == 1
