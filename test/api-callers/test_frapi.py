"""
Unit tests for the Federal Reserve Economic Data API wrapper and caller.
Functions in core/apis/frapi.py
"""

import datetime
import json
import os
import tempfile
from unittest.mock import MagicMock, patch

import pytest
from core import FredAPI, call_specific_fred

# ============================================================================
# FredAPI Tests
# ============================================================================

class TestFredAPI:
    """Tests for the FredAPI function"""

    # --- Basic Cases (4) ---

    @patch('core.apis.frapi.Fred')
    def test_basic_series_request(self, mock_fred_class):
        """Test basic FRED series request returns valid structure"""
        mock_fred = MagicMock()
        mock_fred_class.return_value = mock_fred

        # Mock pandas Series
        mock_series = MagicMock()
        mock_series.empty = False
        mock_series.items.return_value = [
            (datetime.datetime(2024, 1, 1), 5.5),
            (datetime.datetime(2024, 1, 2), 5.6)
        ]
        mock_fred.get_series.return_value = mock_series

        result = FredAPI(mock_fred, series_id="UNRATE")

        assert result["status"] == "ok"
        assert "values" in result
        assert isinstance(result["values"], list)
        assert len(result["values"]) == 2
        assert result["values"][0]["datetime"] == "2024-01-01"
        assert result["values"][0]["value"] == 5.5

    @patch('core.apis.frapi.Fred')
    def test_with_date_range(self, mock_fred_class):
        """Test request with start and end dates"""
        mock_fred = MagicMock()
        mock_fred_class.return_value = mock_fred

        mock_series = MagicMock()
        mock_series.empty = False
        mock_series.items.return_value = [(datetime.datetime(2024, 6, 1), 4.0)]
        mock_fred.get_series.return_value = mock_series

        start_date = datetime.datetime(2024, 1, 1)
        end_date = datetime.datetime(2024, 12, 31)

        FredAPI(mock_fred, series_id="UNRATE", start_date=start_date, end_date=end_date)

        mock_fred.get_series.assert_called_once()
        call_args = mock_fred.get_series.call_args
        assert call_args[1]["observation_start"] == start_date
        assert call_args[1]["observation_end"] == end_date

    @patch('core.apis.frapi.Fred')
    def test_empty_series_returns_empty_values(self, mock_fred_class):
        """Test that empty series returns empty values list"""
        mock_fred = MagicMock()
        mock_fred_class.return_value = mock_fred

        mock_series = MagicMock()
        mock_series.empty = True
        mock_fred.get_series.return_value = mock_series

        result = FredAPI(mock_fred, series_id="INVALID")

        assert result["status"] == "ok"
        assert result["values"] == []

    @patch('core.apis.frapi.Fred')
    def test_skips_nan_values(self, mock_fred_class):
        """Test that NaN values are skipped"""
        mock_fred = MagicMock()
        mock_fred_class.return_value = mock_fred

        mock_series = MagicMock()
        mock_series.empty = False
        mock_series.items.return_value = [
            (datetime.datetime(2024, 1, 1), 5.5),
            (datetime.datetime(2024, 1, 2), float('nan')),  # NaN value
            (datetime.datetime(2024, 1, 3), 5.7)
        ]
        mock_fred.get_series.return_value = mock_series

        result = FredAPI(mock_fred, series_id="UNRATE")

        assert result["status"] == "ok"
        assert len(result["values"]) == 2  # NaN value skipped
        assert result["values"][0]["value"] == 5.5
        assert result["values"][1]["value"] == 5.7

    # --- Edge Cases (3) ---

    @patch('core.apis.frapi.Fred')
    def test_api_exception_returns_error(self, mock_fred_class):
        """Test that API exceptions return error status"""
        mock_fred = MagicMock()
        mock_fred_class.return_value = mock_fred
        mock_fred.get_series.side_effect = Exception("API Error")

        result = FredAPI(mock_fred, series_id="INVALID")

        assert result["status"] == "error"
        assert "message" in result
        assert "API Error" in result["message"]

    @patch('core.apis.frapi.Fred')
    def test_none_series_returns_empty(self, mock_fred_class):
        """Test that None series returns empty values"""
        mock_fred = MagicMock()
        mock_fred_class.return_value = mock_fred
        mock_fred.get_series.return_value = None

        result = FredAPI(mock_fred, series_id="INVALID")

        assert result["status"] == "ok"
        assert result["values"] == []

    @patch('core.apis.frapi.Fred')
    def test_series_with_tz_info(self, mock_fred_class):
        """Test handling of datetime with timezone info"""
        mock_fred = MagicMock()
        mock_fred_class.return_value = mock_fred

        mock_series = MagicMock()
        mock_series.empty = False
        dt_with_tz = datetime.datetime(2024, 1, 1, tzinfo=datetime.UTC)
        mock_series.items.return_value = [(dt_with_tz, 5.5)]
        mock_fred.get_series.return_value = mock_series

        result = FredAPI(mock_fred, series_id="UNRATE")

        assert result["status"] == "ok"
        assert result["values"][0]["datetime"] == "2024-01-01"


# ============================================================================
# call_specific_fred Tests
# ============================================================================

class TestCallSpecificFred:
    """Tests for the call_specific_fred function"""

    # --- Basic Cases (4) ---

    @patch.dict(os.environ, {"FRED_KEY": "test_key"})
    @patch('core.apis.frapi.Fred')
    def test_creates_output_directory(self, mock_fred_class):
        """Test that function creates output directory if needed"""
        with tempfile.TemporaryDirectory() as tmpdir:
            subdir = os.path.join(tmpdir, "nonexistent", "path")

            mock_fred = MagicMock()
            mock_fred_class.return_value = mock_fred
            mock_series = MagicMock()
            mock_series.empty = False
            mock_series.items.return_value = [(datetime.datetime(2024, 1, 1), 5.5)]
            mock_fred.get_series.return_value = mock_series

            # Should not raise even if directory doesn't exist
            call_specific_fred(subdir, series_ids=["UNRATE"])

    @patch.dict(os.environ, {"FRED_KEY": "test_key"})
    @patch('core.apis.frapi.Fred')
    def test_writes_json_file(self, mock_fred_class):
        """Test that function writes JSON file for series"""
        with tempfile.TemporaryDirectory() as tmpdir:
            mock_fred = MagicMock()
            mock_fred_class.return_value = mock_fred
            mock_series = MagicMock()
            mock_series.empty = False
            mock_series.items.return_value = [(datetime.datetime(2024, 1, 1), 5.5)]
            mock_fred.get_series.return_value = mock_series

            call_specific_fred(tmpdir, series_ids=["UNRATE"])

            file_path = os.path.join(tmpdir, "UNRATE.json")
            assert os.path.exists(file_path)

            with open(file_path, "r") as f:
                data = json.load(f)
            assert len(data) == 1
            assert data[0]["datetime"] == "2024-01-01"
            assert data[0]["value"] == 5.5

    @patch.dict(os.environ, {"FRED_KEY": "test_key"})
    @patch('core.apis.frapi.Fred')
    def test_handles_multiple_series(self, mock_fred_class):
        """Test that function handles multiple series IDs"""
        with tempfile.TemporaryDirectory() as tmpdir:
            mock_fred = MagicMock()
            mock_fred_class.return_value = mock_fred
            mock_series = MagicMock()
            mock_series.empty = False
            mock_series.items.return_value = [(datetime.datetime(2024, 1, 1), 5.5)]
            mock_fred.get_series.return_value = mock_series

            call_specific_fred(tmpdir, series_ids=["UNRATE", "PCEPILFE"])

            assert os.path.exists(os.path.join(tmpdir, "UNRATE.json"))
            assert os.path.exists(os.path.join(tmpdir, "PCEPILFE.json"))

    @patch.dict(os.environ, {"FRED_KEY": "test_key"})
    @patch('core.apis.frapi.Fred')
    def test_respects_rate_limit(self, mock_fred_class):
        """Test that function respects rate limit"""
        with tempfile.TemporaryDirectory() as tmpdir:
            mock_fred = MagicMock()
            mock_fred_class.return_value = mock_fred
            mock_series = MagicMock()
            mock_series.empty = False
            mock_series.items.return_value = [(datetime.datetime(2024, 1, 1), 5.5)]
            mock_fred.get_series.return_value = mock_series

            with patch('time.sleep') as mock_sleep:
                call_specific_fred(tmpdir, series_ids=["S1", "S2", "S3"], rate_limit=2)

                # Should sleep when hitting rate limit
                mock_sleep.assert_called()

    # --- Edge Cases (3) ---

    @patch.dict(os.environ, {"FRED_KEY": "test_key"})
    @patch('core.apis.frapi.Fred')
    def test_missing_fred_key_raises_error(self, mock_fred_class):
        """Test that missing FRED_KEY raises ValueError"""
        with patch.dict(os.environ, {}, clear=True):
            with pytest.raises(ValueError, match="FRED_KEY not found"):
                call_specific_fred("/tmp", series_ids=["UNRATE"])

    @patch.dict(os.environ, {"FRED_KEY": "test_key"})
    @patch('core.apis.frapi.Fred')
    def test_handles_api_error(self, mock_fred_class):
        """Test that API errors are handled gracefully"""
        with tempfile.TemporaryDirectory() as tmpdir:
            mock_fred = MagicMock()
            mock_fred_class.return_value = mock_fred
            mock_fred.get_series.side_effect = Exception("API Error")

            # Should not raise, just skip the series
            call_specific_fred(tmpdir, series_ids=["INVALID"])

            # File should not be created
            assert not os.path.exists(os.path.join(tmpdir, "INVALID.json"))

    @patch.dict(os.environ, {"FRED_KEY": "test_key"})
    @patch('core.apis.frapi.Fred')
    def test_updates_existing_file(self, mock_fred_class):
        """Test updating existing file with new data"""
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = os.path.join(tmpdir, "UNRATE.json")

            # Create existing file
            existing_data = [{"datetime": "2024-01-01", "value": 5.0}]
            with open(file_path, "w") as f:
                json.dump(existing_data, f)

            mock_fred = MagicMock()
            mock_fred_class.return_value = mock_fred
            mock_series = MagicMock()
            mock_series.empty = False
            mock_series.items.return_value = [(datetime.datetime(2024, 1, 2), 5.5)]
            mock_fred.get_series.return_value = mock_series

            call_specific_fred(tmpdir, series_ids=["UNRATE"])

            with open(file_path, "r") as f:
                data = json.load(f)
            assert len(data) == 2  # Should have both old and new data