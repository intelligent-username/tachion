"""
Unit tests for moving average calculations
In core/processor/ma.py
"""

import numpy as np
import pandas as pd
from core import moving_average

# ============================================================================
# moving_average Tests
# ============================================================================

class TestMovingAverage:
    """Tests for the moving_average function"""

    # --- Basic Cases (4) ---

    def test_basic_moving_average(self):
        """Test basic moving average calculation"""
        prices = pd.Series([10.0, 20.0, 30.0, 40.0, 50.0])
        result = moving_average(prices, window=3)
        
        # First two values should be NaN (min_periods=window)
        assert pd.isna(result.iloc[0])
        assert pd.isna(result.iloc[1])
        # Third value: (10 + 20 + 30) / 3 = 20
        assert np.isclose(result.iloc[2], 20.0, rtol=1e-10)
        # Fourth value: (20 + 30 + 40) / 3 = 30
        assert np.isclose(result.iloc[3], 30.0, rtol=1e-10)
        # Fifth value: (30 + 40 + 50) / 3 = 40
        assert np.isclose(result.iloc[4], 40.0, rtol=1e-10)

    def test_returns_series(self):
        """Test that output is a pandas Series"""
        prices = pd.Series([100.0, 110.0, 105.0, 115.0, 120.0])
        result = moving_average(prices, window=2)
        
        assert isinstance(result, pd.Series)
        assert len(result) == len(prices)

    def test_preserves_index(self):
        """Test that index is preserved"""
        prices = pd.Series([100.0, 110.0, 105.0], index=['a', 'b', 'c'])
        result = moving_average(prices, window=2)
        
        assert list(result.index) == ['a', 'b', 'c']

    def test_window_of_one(self):
        """Test with window=1 (should return original values)"""
        prices = pd.Series([10.0, 20.0, 30.0, 40.0])
        result = moving_average(prices, window=1)
        
        # All values should equal original
        pd.testing.assert_series_equal(result, prices, check_names=False)

    # --- Edge Cases (3) ---

    def test_window_equals_length(self):
        """Test when window equals series length"""
        prices = pd.Series([10.0, 20.0, 30.0])
        result = moving_average(prices, window=3)
        
        # Only last value should be non-NaN
        assert pd.isna(result.iloc[0])
        assert pd.isna(result.iloc[1])
        assert np.isclose(result.iloc[2], 20.0, rtol=1e-10)

    def test_window_larger_than_length(self):
        """Test when window is larger than series length"""
        prices = pd.Series([10.0, 20.0, 30.0])
        result = moving_average(prices, window=5)
        
        # All values should be NaN
        assert result.isna().all()

    def test_with_nan_values(self):
        """Test handling of NaN values in input"""
        prices = pd.Series([10.0, np.nan, 30.0, 40.0, 50.0])
        result = moving_average(prices, window=3)
        
        # Windows containing NaN should produce NaN
        assert pd.isna(result.iloc[2])  # (10 + NaN + 30) = NaN
        assert pd.isna(result.iloc[3])  # (NaN + 30 + 40) = NaN
        # Window [30, 40, 50] should be valid
        assert np.isclose(result.iloc[4], 40.0, rtol=1e-10)
