"""
Unit tests for data/forex/collector.py
"""

from unittest.mock import patch


class TestForexCollector:
    """Tests for data/forex/collector.py"""

    @patch('data.forex.collector.call_specific_oanda')
    def test_write_data_calls_oanda_api(self, mock_oanda):
        from data.forex.collector import write_data
        write_data(["EUR_USD"])
        mock_oanda.assert_called_once()

    @patch('data.forex.collector.call_specific_oanda')
    def test_write_data_passes_correct_num_calls(self, mock_oanda):
        from data.forex.collector import write_data
        write_data(["EUR_USD"])
        call_args = mock_oanda.call_args
        assert call_args[1]["num_calls"] == 35

    @patch('data.forex.collector.call_specific_oanda')
    def test_write_data_passes_instruments(self, mock_oanda):
        from data.forex.collector import write_data
        instruments = ["EUR_USD", "GBP_USD", "USD_JPY"]
        write_data(instruments)
        call_args = mock_oanda.call_args
        assert call_args[1]["instruments"] == instruments

    @patch('data.forex.collector.call_specific_oanda')
    def test_write_data_creates_correct_path(self, mock_oanda):
        from data.forex.collector import write_data
        write_data(["EUR_USD"])
        call_args = mock_oanda.call_args
        assert "forex" in call_args[0][0]
        assert "raw" in call_args[0][0]

    @patch('data.forex.collector.call_specific_oanda')
    def test_write_data_empty_list(self, mock_oanda):
        from data.forex.collector import write_data
        write_data([])
        mock_oanda.assert_called_once()
        assert mock_oanda.call_args[1]["instruments"] == []

    @patch('data.forex.collector.call_specific_oanda')
    def test_write_data_single_instrument(self, mock_oanda):
        from data.forex.collector import write_data
        write_data(["EUR_USD"])
        mock_oanda.assert_called_once()

    @patch('data.forex.collector.os.makedirs')
    @patch('data.forex.collector.call_specific_oanda')
    def test_write_data_creates_directory(self, mock_oanda, mock_makedirs):
        from data.forex.collector import write_data
        write_data(["EUR_USD"])
        mock_makedirs.assert_called_once()
