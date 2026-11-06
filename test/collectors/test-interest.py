"""
Unit tests for data/interest/collector.py
"""

from unittest.mock import MagicMock, mock_open, patch


@patch('data.interest.collector.call_specific_fred')
def test_collect_fred_data_calls_fred_api(mock_fred):
    from data.interest.collector import collect_fred_data
    collect_fred_data(["UNRATE", "PCEPILFE"])
    mock_fred.assert_called_once()


@patch('data.interest.collector.call_specific_fred')
def test_collect_fred_data_passes_series_ids(mock_fred):
    from data.interest.collector import collect_fred_data
    series_ids = ["UNRATE", "PCEPILFE", "NROU"]
    collect_fred_data(series_ids)
    call_args = mock_fred.call_args
    assert call_args[1]["series_ids"] == series_ids


@patch('data.interest.collector.call_specific_fred')
def test_collect_fred_data_creates_correct_path(mock_fred):
    from data.interest.collector import collect_fred_data
    collect_fred_data(["UNRATE"])
    call_args = mock_fred.call_args
    assert "interest" in call_args[0][0]
    assert "raw" in call_args[0][0]


@patch('data.interest.collector.call_specific_fred')
def test_collect_creates_directory(mock_fred):
    from data.interest.collector import collect_fred_data
    with patch('data.interest.collector.os.makedirs') as mock_makedirs:
        collect_fred_data(["UNRATE"])
        mock_makedirs.assert_called_once()


@patch('data.interest.collector.call_specific_fred')
def test_collect_fred_data_empty_list(mock_fred):
    from data.interest.collector import collect_fred_data
    collect_fred_data([])
    mock_fred.assert_called_once()
    assert mock_fred.call_args[1]["series_ids"] == []


@patch('data.interest.collector.call_specific_fred')
def test_collect_fred_data_single_series(mock_fred):
    from data.interest.collector import collect_fred_data
    collect_fred_data(["UNRATE"])
    mock_fred.assert_called_once()


@patch('data.interest.collector.os.makedirs')
@patch('data.interest.collector.call_specific_fred')
def test_collect_fred_data_creates_directory(mock_fred, mock_makedirs):
    from data.interest.collector import collect_fred_data
    collect_fred_data(["UNRATE"])
    mock_makedirs.assert_called_once()


@patch('data.interest.collector.call_specific_fred')
@patch('data.interest.collector.os.path.exists')
@patch('builtins.open', new_callable=mock_open)
@patch('data.interest.collector.pd.DataFrame')
@patch('data.interest.collector.pd.concat')
def test_yield_spread_computation_when_files_exist(mock_concat, mock_df, mock_file, mock_exists, mock_fred):
    from data.interest.collector import collect_fred_data
    mock_exists.return_value = True
    mock_df_instance = MagicMock()
    mock_df.return_value = mock_df_instance
    mock_df_instance.set_index.return_value = mock_df_instance
    mock_df_instance.rename.return_value = mock_df_instance
    mock_concat.return_value = mock_df_instance
    with patch('data.interest.collector.pd.DataFrame.to_csv') as mock_to_csv:
        collect_fred_data(["GS3M", "GS2", "GS10"])
        mock_to_csv.assert_called_once()


@patch('data.interest.collector.call_specific_fred')
@patch('data.interest.collector.os.path.exists')
def test_yield_spread_computation_skipped_when_files_missing(mock_exists, mock_fred):
    from data.interest.collector import collect_fred_data
    mock_exists.side_effect = lambda f: "GS3M.json" in f
    with patch('data.interest.collector.pd.DataFrame.to_csv') as mock_to_csv:
        collect_fred_data(["GS3M", "GS2", "GS10"])
        mock_to_csv.assert_not_called()


@patch('builtins.open', new_callable=mock_open, read_data="UNRATE\nPCEPILFE\n# Comment\n\nNROU\n")
@patch('data.interest.collector.collect_fred_data')
def test_collect_reads_tickers_file(mock_collect_fred, mock_file):
    from data.interest.collector import collect
    collect()
    mock_collect_fred.assert_called_once()
    call_args = mock_collect_fred.call_args[0][0]
    assert "UNRATE" in call_args
    assert "PCEPILFE" in call_args
    assert "NROU" in call_args
    assert len(call_args) == 3


@patch('builtins.open', new_callable=mock_open, read_data="")
@patch('data.interest.collector.collect_fred_data')
def test_collect_handles_empty_tickers_file(mock_collect_fred, mock_file):
    from data.interest.collector import collect
    collect()
    mock_collect_fred.assert_called_once_with([])
