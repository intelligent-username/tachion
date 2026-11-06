"""
Unit tests for data/crypto/collector.py
"""

from unittest.mock import patch


class TestCryptoCollector:
    """Tests for data/crypto/collector.py"""

    @patch('data.crypto.collector.call_specific_binance')
    def test_write_data_calls_binance_api(self, mock_binance):
        from data.crypto.collector import write_data
        write_data(["BTC", "ETH"])
        mock_binance.assert_called_once()

    @patch('data.crypto.collector.call_specific_binance')
    def test_write_data_passes_correct_num_calls(self, mock_binance):
        from data.crypto.collector import write_data
        write_data(["BTC"])
        call_args = mock_binance.call_args
        assert call_args[1]["num_calls"] == 87

    @patch('data.crypto.collector.call_specific_binance')
    def test_write_data_passes_symbols(self, mock_binance):
        from data.crypto.collector import write_data
        symbols = ["BTC", "ETH", "SOL"]
        write_data(symbols)
        call_args = mock_binance.call_args
        assert call_args[1]["symbols"] == symbols

    @patch('data.crypto.collector.call_specific_binance')
    def test_write_data_creates_correct_path(self, mock_binance):
        from data.crypto.collector import write_data
        write_data(["BTC"])
        call_args = mock_binance.call_args
        assert "crypto" in call_args[0][0]
        assert "raw" in call_args[0][0]

    @patch('data.crypto.collector.call_specific_binance')
    def test_write_data_empty_list(self, mock_binance):
        from data.crypto.collector import write_data
        write_data([])
        mock_binance.assert_called_once()
        assert mock_binance.call_args[1]["symbols"] == []

    @patch('data.crypto.collector.call_specific_binance')
    def test_write_data_single_symbol(self, mock_binance):
        from data.crypto.collector import write_data
        write_data(["BTC"])
        mock_binance.assert_called_once()

    @patch('data.crypto.collector.os.makedirs')
    @patch('data.crypto.collector.call_specific_binance')
    def test_write_data_creates_directory(self, mock_binance, mock_makedirs):
        from data.crypto.collector import write_data
        write_data(["BTC"])
        mock_makedirs.assert_called_once()
