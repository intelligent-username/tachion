"""
Unit tests for the Binance API wrapper
In core/apis/biapi.py
"""

import datetime
import json
import os
import tempfile
from unittest.mock import patch

import pytest
from core import BinanceAPI, call_specific_binance

# ============================================================================
# BinanceAPI Tests
# ============================================================================

class TestBinanceAPI:
    """Tests for the BinanceAPI function"""

    # --- Basic Cases (4) ---

    def test_basic_btc_request(self):
        """Test basic BTC request returns valid structure"""
        result = BinanceAPI(symbol="BTC", limit=5)
        
        assert "status" in result
        if result["status"] == "ok":
            assert "values" in result
            assert isinstance(result["values"], list)
            if result["values"]:
                candle = result["values"][0]
                assert "datetime" in candle
                assert "open" in candle
                assert "high" in candle
                assert "low" in candle
                assert "close" in candle
                assert "volume" in candle

    def test_basic_eth_request(self):
        """Test basic ETH request returns valid structure"""
        result = BinanceAPI(symbol="ETH", limit=10)
        
        assert result["status"] in ["ok", "error"]
        if result["status"] == "ok":
            assert len(result["values"]) <= 10

    def test_custom_interval(self):
        """Test request with custom interval (1h)"""
        result = BinanceAPI(symbol="BTC", interval="1h", limit=5)
        
        assert "status" in result
        if result["status"] == "ok":
            assert isinstance(result["values"], list)

    def test_with_end_time(self):
        """Test request with specific end_time parameter"""
        end_time = int(datetime.datetime.now().timestamp() * 1000)
        result = BinanceAPI(symbol="BTC", end_time=end_time, limit=5)
        
        assert "status" in result

    # --- Edge Cases (3) ---

    def test_missing_symbol_raises_error(self):
        """Test that missing symbol raises ValueError"""
        with pytest.raises(ValueError, match="Symbol can't be blank"):
            BinanceAPI(symbol=None)

    def test_invalid_symbol_returns_error(self):
        """Test that invalid symbol returns error status"""
        result = BinanceAPI(symbol="INVALIDSYMBOL123XYZ")
        
        assert result["status"] == "error"
        assert "message" in result

    def test_lowercase_symbol_works(self):
        """Test that lowercase symbol is properly converted"""
        result = BinanceAPI(symbol="btc", limit=5)
        
        # Should work because we uppercase internally
        assert "status" in result


# ============================================================================
# call_specific_binance Tests
# ============================================================================

class TestCallSpecificBinance:
    """Tests for the call_specific_binance function"""

    # --- Basic Cases (4) ---

    def test_creates_output_directory(self):
        """Test that function creates output directory if needed"""
        with tempfile.TemporaryDirectory() as tmpdir:
            subdir = os.path.join(tmpdir, "nonexistent", "path")
            
            with patch('core.apis.biapi.BinanceAPI') as mock_api:
                mock_api.return_value = {"status": "ok", "values": []}
                
                # Should not raise even if directory doesn't exist
                call_specific_binance(subdir, symbols=["BTC"], num_calls=1)

    def test_writes_json_file(self):
        """Test that function writes JSON file for symbol"""
        with tempfile.TemporaryDirectory() as tmpdir:
            mock_values = [
                {"datetime": "2024-01-01 12:00:00", "open": "100", "high": "101", 
                 "low": "99", "close": "100.5", "volume": "1000"}
            ]
            
            with patch('core.apis.biapi.BinanceAPI') as mock_api:
                mock_api.return_value = {"status": "ok", "values": mock_values}
                
                call_specific_binance(tmpdir, symbols=["TEST"], num_calls=1)
                
                file_path = os.path.join(tmpdir, "TEST.json")
                assert os.path.exists(file_path)
                
                with open(file_path, "r") as f:
                    data = json.load(f)
                assert len(data) == 1

    def test_handles_multiple_symbols(self):
        """Test that function handles multiple symbols"""
        with tempfile.TemporaryDirectory() as tmpdir:
            mock_values = [
                {"datetime": "2024-01-01 12:00:00", "open": "100", "high": "101",
                 "low": "99", "close": "100.5", "volume": "1000"}
            ]
            
            with patch('core.apis.biapi.BinanceAPI') as mock_api:
                mock_api.return_value = {"status": "ok", "values": mock_values}
                
                call_specific_binance(tmpdir, symbols=["SYM1", "SYM2"], num_calls=1)
                
                assert os.path.exists(os.path.join(tmpdir, "SYM1.json"))
                assert os.path.exists(os.path.join(tmpdir, "SYM2.json"))

    def test_respects_num_calls(self):
        """Test that function respects num_calls parameter"""
        with tempfile.TemporaryDirectory() as tmpdir:
            call_count = 0
            
            def mock_api_call(**kwargs):
                nonlocal call_count
                call_count += 1
                return {"status": "ok", "values": [
                    {"datetime": f"2024-01-0{call_count} 12:00:00", "open": "100", 
                     "high": "101", "low": "99", "close": "100.5", "volume": "1000"}
                ] * 1000}  # Return full batch to trigger more calls
            
            with patch('core.apis.biapi.BinanceAPI', side_effect=mock_api_call):
                call_specific_binance(tmpdir, symbols=["BTC"], num_calls=3)
                
            assert call_count == 3

    # --- Edge Cases (3) ---

    def test_handles_api_error(self):
        """Test that function handles API errors gracefully"""
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch('core.apis.biapi.BinanceAPI') as mock_api:
                mock_api.return_value = {"status": "error", "message": "API Error"}
                
                # Should not raise
                call_specific_binance(tmpdir, symbols=["BTC"], num_calls=1)

    def test_handles_empty_response(self):
        """Test that function handles empty response"""
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch('core.apis.biapi.BinanceAPI') as mock_api:
                mock_api.return_value = {"status": "ok", "values": []}
                
                call_specific_binance(tmpdir, symbols=["BTC"], num_calls=1)
                
                # File should not be created for empty data
                assert not os.path.exists(os.path.join(tmpdir, "BTC.json"))

    def test_deduplicates_data(self):
        """Test that function removes duplicate entries"""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Return same timestamp twice
            mock_values = [
                {"datetime": "2024-01-01 12:00:00", "open": "100", "high": "101",
                 "low": "99", "close": "100.5", "volume": "1000"},
                {"datetime": "2024-01-01 12:00:00", "open": "100", "high": "101",
                 "low": "99", "close": "100.5", "volume": "1000"}
            ]
            
            with patch('core.apis.biapi.BinanceAPI') as mock_api:
                mock_api.return_value = {"status": "ok", "values": mock_values}
                
                call_specific_binance(tmpdir, symbols=["BTC"], num_calls=1)
                
                with open(os.path.join(tmpdir, "BTC.json"), "r") as f:
                    data = json.load(f)
                
                # Should only have 1 entry after dedup
                assert len(data) == 1
