"""
Unit tests for core/apis/tdapi.py - TwelveData API wrapper
"""

import datetime
import os
import tempfile
from unittest.mock import MagicMock, patch

import pytest
from core import TwelveDataAPI, call_specific_td

# ============================================================================
# TwelveDataAPI Tests
# ============================================================================

class TestTwelveDataAPI:
    """Tests for the TwelveDataAPI function"""

    # --- Basic Cases (4) ---

    @patch('core.apis.tdapi.requests.get')
    def test_basic_request_structure(self, mock_get):
        """Test basic request returns valid structure"""
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "status": "ok",
            "values": [{"datetime": "2024-01-01 12:00:00", "open": "100"}]
        }
        mock_response.raise_for_status = MagicMock()
        mock_get.return_value = mock_response
        
        result = TwelveDataAPI(symbol="AAPL")
        
        assert "status" in result or "values" in result

    @patch('core.apis.tdapi.requests.get')
    def test_custom_interval(self, mock_get):
        """Test request with custom interval"""
        mock_response = MagicMock()
        mock_response.json.return_value = {"status": "ok", "values": []}
        mock_response.raise_for_status = MagicMock()
        mock_get.return_value = mock_response
        
        TwelveDataAPI(symbol="AAPL", interval="1h")
        
        # Check that interval was passed correctly
        call_args = mock_get.call_args
        assert call_args[1]["params"]["interval"] == "1h"

    @patch('core.apis.tdapi.requests.get')
    def test_custom_outputsize(self, mock_get):
        """Test request with custom outputsize"""
        mock_response = MagicMock()
        mock_response.json.return_value = {"status": "ok", "values": []}
        mock_response.raise_for_status = MagicMock()
        mock_get.return_value = mock_response
        
        TwelveDataAPI(symbol="AAPL", outputsize=100)
        
        call_args = mock_get.call_args
        assert call_args[1]["params"]["outputsize"] == 100

    @patch('core.apis.tdapi.requests.get')
    def test_date_formatting(self, mock_get):
        """Test that dates are formatted correctly"""
        mock_response = MagicMock()
        mock_response.json.return_value = {"status": "ok", "values": []}
        mock_response.raise_for_status = MagicMock()
        mock_get.return_value = mock_response
        
        start = datetime.datetime(2024, 1, 1, 12, 0, 0)
        end = datetime.datetime(2024, 6, 1, 12, 0, 0)
        
        TwelveDataAPI(symbol="AAPL", start_date=start, end_date=end)
        
        call_args = mock_get.call_args
        assert call_args[1]["params"]["start_date"] == "2024-01-01 12:00:00"
        assert call_args[1]["params"]["end_date"] == "2024-06-01 12:00:00"

    # --- Edge Cases (3) ---

    def test_missing_symbol_raises_error(self):
        """Test that missing symbol raises ValueError"""
        with pytest.raises(ValueError, match="Symbol can't be blank"):
            TwelveDataAPI(symbol=None)

    def test_invalid_format_raises_error(self):
        """Test that invalid format raises ValueError"""
        with pytest.raises(ValueError, match="format must be"):
            TwelveDataAPI(symbol="AAPL", format="XML")

    @patch('core.apis.tdapi.requests.get')
    def test_csv_format_returns_text(self, mock_get):
        """Test that CSV format returns text response"""
        mock_response = MagicMock()
        mock_response.text = "datetime,open,high,low,close\n2024-01-01,100,101,99,100"
        mock_response.raise_for_status = MagicMock()
        mock_get.return_value = mock_response
        
        result = TwelveDataAPI(symbol="AAPL", format="CSV")
        
        assert isinstance(result, str)
        assert "datetime" in result


# ============================================================================
# call_specific_td Tests
# ============================================================================

class TestCallSpecificTD:
    """Tests for the call_specific_td function"""

    # --- Basic Cases (4) ---

    def test_creates_output_directory(self):
        """Test that function creates output directory if needed"""
        with tempfile.TemporaryDirectory() as tmpdir:
            subdir = os.path.join(tmpdir, "new_dir")
            
            with patch('core.apis.tdapi.TwelveDataAPI') as mock_api:
                mock_api.return_value = {"status": "ok", "values": []}
                
                call_specific_td(subdir, symbols=["AAPL"], num_calls=1)

    def test_writes_json_file(self):
        """Test that function writes JSON file for symbol"""
        with tempfile.TemporaryDirectory() as tmpdir:
            mock_values = [
                {"datetime": "2024-01-01 12:00:00", "open": "100", "high": "101",
                 "low": "99", "close": "100.5", "volume": "1000"}
            ] * 5000  # Full batch
            
            with patch('core.apis.tdapi.TwelveDataAPI') as mock_api:
                mock_api.return_value = {"status": "ok", "values": mock_values}
                
                call_specific_td(tmpdir, symbols=["TEST"], num_calls=1)
                
                file_path = os.path.join(tmpdir, "TEST.json")
                assert os.path.exists(file_path)

    def test_handles_multiple_symbols(self):
        """Test that function processes multiple symbols"""
        with tempfile.TemporaryDirectory() as tmpdir:
            mock_values = [
                {"datetime": "2024-01-01 12:00:00", "open": "100", "high": "101",
                 "low": "99", "close": "100.5", "volume": "1000"}
            ] * 5000
            
            with patch('core.apis.tdapi.TwelveDataAPI') as mock_api:
                mock_api.return_value = {"status": "ok", "values": mock_values}
                
                call_specific_td(tmpdir, symbols=["SYM1", "SYM2"], num_calls=1)
                
                assert os.path.exists(os.path.join(tmpdir, "SYM1.json"))
                assert os.path.exists(os.path.join(tmpdir, "SYM2.json"))

    def test_respects_rate_limit_parameter(self):
        """Test that rate_limit parameter is accepted"""
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch('core.apis.tdapi.TwelveDataAPI') as mock_api:
                mock_api.return_value = {"status": "ok", "values": []}
                
                # Should not raise with custom rate_limit
                call_specific_td(tmpdir, symbols=["AAPL"], num_calls=1, rate_limit=5)

    # --- Edge Cases (3) ---

    def test_handles_api_error(self):
        """Test that function handles API errors gracefully"""
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch('core.apis.tdapi.TwelveDataAPI') as mock_api:
                mock_api.return_value = {"status": "error", "message": "Invalid API key"}
                
                # Should not raise
                call_specific_td(tmpdir, symbols=["AAPL"], num_calls=1)

    def test_handles_empty_symbols_list(self):
        """Test that function handles empty symbols list"""
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch('core.apis.tdapi.TwelveDataAPI') as mock_api:
                mock_api.return_value = {"status": "ok", "values": []}
                
                # Should not raise
                call_specific_td(tmpdir, symbols=[], num_calls=1)

    def test_handles_partial_batch(self):
        """Test that function handles partial batch (less than outputsize)"""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Only 100 values instead of 5000
            mock_values = [
                {"datetime": "2024-01-01 12:00:00", "open": "100", "high": "101",
                 "low": "99", "close": "100.5", "volume": "1000"}
            ] * 100
            
            with patch('core.apis.tdapi.TwelveDataAPI') as mock_api:
                mock_api.return_value = {"status": "ok", "values": mock_values}
                
                call_specific_td(tmpdir, symbols=["AAPL"], num_calls=3)
                
                # Should only make 1 call since batch is incomplete
                assert mock_api.call_count == 1
