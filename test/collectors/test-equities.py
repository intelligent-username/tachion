"""
Unit tests for data/equities/collector.py
"""

from unittest.mock import patch


class TestEquitiesCollector:
    """Tests for data/equities/collector.py"""

    @patch('data.equities.collector.call_specific_td')
    def test_write_data_calls_td_api(self, mock_td):
        from data.equities.collector import write_data
        write_data(["AAPL"])
        assert mock_td.call_count == 2

    @patch('data.equities.collector.call_specific_td')
    def test_write_data_includes_spy(self, mock_td):
        from data.equities.collector import write_data
        write_data(["AAPL", "MSFT"])
        first_call = mock_td.call_args_list[0]
        assert first_call[1]["symbols"] == ["SPY"]

    @patch('data.equities.collector.call_specific_td')
    def test_write_data_passes_correct_num_calls(self, mock_td):
        from data.equities.collector import write_data
        write_data(["AAPL"])
        for call in mock_td.call_args_list:
            assert call[1]["num_calls"] == 3

    @patch('data.equities.collector.call_specific_td')
    def test_write_data_passes_symbols(self, mock_td):
        from data.equities.collector import write_data
        symbols = ["AAPL", "MSFT", "GOOGL"]
        write_data(symbols)
        second_call = mock_td.call_args_list[1]
        assert second_call[1]["symbols"] == symbols

    @patch('data.equities.collector.call_specific_td')
    def test_write_data_empty_list_still_gets_spy(self, mock_td):
        from data.equities.collector import write_data
        write_data([])
        assert mock_td.call_count == 2

    @patch('data.equities.collector.call_specific_td')
    def test_write_data_creates_correct_path(self, mock_td):
        from data.equities.collector import write_data
        write_data(["AAPL"])
        call_args = mock_td.call_args_list[0]
        assert "equities" in call_args[0][0]
        assert "raw" in call_args[0][0]

    @patch('data.equities.collector.os.makedirs')
    @patch('data.equities.collector.call_specific_td')
    def test_write_data_creates_directory(self, mock_td, mock_makedirs):
        from data.equities.collector import write_data
        write_data(["AAPL"])
        mock_makedirs.assert_called_once()
