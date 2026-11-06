"""
Unit tests for rolling volatility calculations
In core/processor/rv.py
"""

import numpy as np
import pandas as pd
from core import rolling_volatility

# ============================================================================
# rolling_volatility Tests
# ============================================================================

class TestRollingVolatility:
    """Tests for the rolling_volatility function"""

    # --- Basic Cases (4) ---

    def test_basic_rolling_volatility(self):
        """Test basic rolling volatility calculation"""
        returns = pd.Series([0.01, -0.02, 0.015, -0.01, 0.02])
        result = rolling_volatility(returns, window=3)
        
        # First two values should be NaN (min_periods=window)
        assert pd.isna(result.iloc[0])
        assert pd.isna(result.iloc[1])
        # Third value should be std of [0.01, -0.02, 0.015]
        expected_std = pd.Series([0.01, -0.02, 0.015]).std()
        assert np.isclose(result.iloc[2], expected_std, rtol=1e-10)

    def test_returns_series(self):
        """Test that output is a pandas Series"""
        returns = pd.Series([0.01, -0.02, 0.015, -0.01, 0.02])
        result = rolling_volatility(returns, window=2)
        
        assert isinstance(result, pd.Series)
        assert len(result) == len(returns)

    def test_preserves_index(self):
        """Test that index is preserved"""
        returns = pd.Series([0.01, -0.02, 0.015], index=['x', 'y', 'z'])
        result = rolling_volatility(returns, window=2)
        
        assert list(result.index) == ['x', 'y', 'z']

    def test_constant_values_zero_volatility(self):
        """Test that constant values produce zero volatility"""
        returns = pd.Series([0.05, 0.05, 0.05, 0.05, 0.05])
        result = rolling_volatility(returns, window=3)
        
        # Constant values should have 0 std
        assert np.isclose(result.iloc[2], 0.0, atol=1e-10)
        assert np.isclose(result.iloc[3], 0.0, atol=1e-10)
        assert np.isclose(result.iloc[4], 0.0, atol=1e-10)

    # --- Edge Cases (3) ---

    def test_window_equals_length(self):
        """Test when window equals series length"""
        returns = pd.Series([0.01, -0.02, 0.03])
        result = rolling_volatility(returns, window=3)
        
        # Only last value should be non-NaN
        assert pd.isna(result.iloc[0])
        assert pd.isna(result.iloc[1])
        expected_std = returns.std()
        assert np.isclose(result.iloc[2], expected_std, rtol=1e-10)

    def test_window_larger_than_length(self):
        """Test when window is larger than series length"""
        returns = pd.Series([0.01, -0.02, 0.03])
        result = rolling_volatility(returns, window=5)
        
        # All values should be NaN
        assert result.isna().all()

    def test_high_volatility_detection(self):
        """Test detection of high volatility periods"""
        # Low vol period followed by high vol period
        returns = pd.Series([0.001, 0.001, 0.001, 0.1, -0.1, 0.1])
        result = rolling_volatility(returns, window=3)
        
        # Later window has higher volatility
        low_vol = result.iloc[2]  # [0.001, 0.001, 0.001]
        high_vol = result.iloc[5]  # [0.1, -0.1, 0.1]
        
        assert high_vol > low_vol
