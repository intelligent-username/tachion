"""
Unit tests for log return and volume change calculations
In core/processor/lr.py
"""

import numpy as np
import pandas as pd
from core import log_return, volume_change

# ============================================================================
# log_return Tests
# ============================================================================

class TestLogReturn:
    """Tests for the log_return function"""

    # --- Basic Cases (4) ---

    def test_basic_log_return(self):
        """Test basic log return calculation"""
        prices = pd.Series([100.0, 110.0, 121.0, 133.1])
        result = log_return(prices)
        
        assert pd.isna(result.iloc[0])  # First value should be NaN
        assert np.isclose(result.iloc[1], np.log(110 / 100), rtol=1e-10)
        assert np.isclose(result.iloc[2], np.log(121 / 110), rtol=1e-10)
        assert np.isclose(result.iloc[3], np.log(133.1 / 121), rtol=1e-10)

    def test_returns_series(self):
        """Test that output is a pandas Series"""
        prices = pd.Series([100.0, 110.0, 105.0])
        result = log_return(prices)
        
        assert isinstance(result, pd.Series)
        assert len(result) == len(prices)

    def test_preserves_index(self):
        """Test that index is preserved"""
        prices = pd.Series([100.0, 110.0, 105.0], index=['a', 'b', 'c'])
        result = log_return(prices)
        
        assert list(result.index) == ['a', 'b', 'c']

    def test_negative_returns(self):
        """Test log return with price decrease"""
        prices = pd.Series([100.0, 90.0, 80.0])
        result = log_return(prices)
        
        assert result.iloc[1] < 0  # Negative return
        assert result.iloc[2] < 0  # Negative return
        assert np.isclose(result.iloc[1], np.log(0.9), rtol=1e-10)

    # --- Edge Cases (3) ---

    def test_single_value(self):
        """Test with single value series"""
        prices = pd.Series([100.0])
        result = log_return(prices)
        
        assert len(result) == 1
        assert pd.isna(result.iloc[0])

    def test_empty_series(self):
        """Test with empty series"""
        prices = pd.Series([], dtype=float)
        result = log_return(prices)
        
        assert len(result) == 0

    def test_with_nan_values(self):
        """Test handling of NaN values in input"""
        prices = pd.Series([100.0, np.nan, 120.0, 130.0])
        result = log_return(prices)
        
        # NaN in prices should propagate
        assert pd.isna(result.iloc[1])  # NaN / 100 = NaN
        assert pd.isna(result.iloc[2])  # 120 / NaN = NaN


# ============================================================================
# volume_change Tests
# ============================================================================

class TestVolumeChange:
    """Tests for the volume_change function"""

    # --- Basic Cases (4) ---

    def test_basic_volume_change(self):
        """Test basic volume change calculation"""
        volumes = pd.Series([1000, 1100, 1210, 1331])
        result = volume_change(volumes)
        
        assert pd.isna(result.iloc[0])
        assert np.isclose(result.iloc[1], np.log(1100 / 1000), rtol=1e-10)
        assert np.isclose(result.iloc[2], np.log(1210 / 1100), rtol=1e-10)

    def test_returns_series(self):
        """Test that output is a pandas Series"""
        volumes = pd.Series([1000, 1500, 1200])
        result = volume_change(volumes)
        
        assert isinstance(result, pd.Series)
        assert len(result) == len(volumes)

    def test_preserves_index(self):
        """Test that index is preserved"""
        volumes = pd.Series([1000, 1500, 1200], index=[10, 20, 30])
        result = volume_change(volumes)
        
        assert list(result.index) == [10, 20, 30]

    def test_volume_decrease(self):
        """Test volume change with volume decrease"""
        volumes = pd.Series([1000, 800, 500])
        result = volume_change(volumes)
        
        assert result.iloc[1] < 0
        assert result.iloc[2] < 0

    # --- Edge Cases (3) ---

    def test_single_value(self):
        """Test with single value series"""
        volumes = pd.Series([1000])
        result = volume_change(volumes)
        
        assert len(result) == 1
        assert pd.isna(result.iloc[0])

    def test_large_volumes(self):
        """Test with large volume numbers"""
        volumes = pd.Series([1e9, 2e9, 1.5e9])
        result = volume_change(volumes)
        
        assert np.isclose(result.iloc[1], np.log(2), rtol=1e-10)
        assert np.isclose(result.iloc[2], np.log(0.75), rtol=1e-10)

    def test_zero_volume_handling(self):
        """Test handling of zero volume (produces -inf)"""
        volumes = pd.Series([1000, 0, 500])

        result = volume_change(volumes)

        # log(0/1000) = -inf
        assert result.iloc[1] == -np.inf
        # log(500/0) = inf
        assert result.iloc[2] == np.inf
