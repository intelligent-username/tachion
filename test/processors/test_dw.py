"""
Unit tests for date/time feature engineering
In core/processor/dw.py
"""

import pandas as pd
from core import add_crypto_date_features, add_date_features

# ============================================================================
# add_date_features Tests
# ============================================================================

class TestAddDateFeatures:
    """Tests for the add_date_features function"""

    # --- Basic Cases (4) ---

    def test_adds_day_of_week(self):
        """Test that day_of_week is correctly added"""
        df = pd.DataFrame({
            'datetime': pd.to_datetime(['2024-01-01', '2024-01-02', '2024-01-03']),  # Mon, Tue, Wed
            'close': [100, 101, 102]
        })
        result = add_date_features(df)
        
        assert 'day_of_week' in result.columns
        assert result['day_of_week'].iloc[0] == 0  # Monday
        assert result['day_of_week'].iloc[1] == 1  # Tuesday
        assert result['day_of_week'].iloc[2] == 2  # Wednesday

    def test_adds_day_of_month(self):
        """Test that day_of_month is correctly added"""
        df = pd.DataFrame({
            'datetime': pd.to_datetime(['2024-01-15', '2024-02-28', '2024-03-01']),
            'close': [100, 101, 102]
        })
        result = add_date_features(df)
        
        assert 'day_of_month' in result.columns
        assert result['day_of_month'].iloc[0] == 15
        assert result['day_of_month'].iloc[1] == 28
        assert result['day_of_month'].iloc[2] == 1

    def test_adds_quarter(self):
        """Test that quarter is correctly added"""
        df = pd.DataFrame({
            'datetime': pd.to_datetime(['2024-02-15', '2024-05-15', '2024-08-15', '2024-11-15']),
            'close': [100, 101, 102, 103]
        })
        result = add_date_features(df)
        
        assert 'quarter' in result.columns
        assert result['quarter'].iloc[0] == 1  # Q1
        assert result['quarter'].iloc[1] == 2  # Q2
        assert result['quarter'].iloc[2] == 3  # Q3
        assert result['quarter'].iloc[3] == 4  # Q4

    def test_preserves_existing_columns(self):
        """Test that existing columns are preserved"""
        df = pd.DataFrame({
            'datetime': pd.to_datetime(['2024-01-01']),
            'close': [100],
            'volume': [1000],
            'custom_col': ['value']
        })
        result = add_date_features(df)
        
        assert 'close' in result.columns
        assert 'volume' in result.columns
        assert 'custom_col' in result.columns

    # --- Edge Cases (3) ---

    def test_custom_date_column(self):
        """Test with custom date column name"""
        df = pd.DataFrame({
            'timestamp': pd.to_datetime(['2024-06-15']),  # Saturday
            'close': [100]
        })
        result = add_date_features(df, date_col='timestamp')
        
        assert 'day_of_week' in result.columns
        assert result['day_of_week'].iloc[0] == 5  # Saturday

    def test_does_not_modify_original(self):
        """Test that original dataframe is not modified"""
        df = pd.DataFrame({
            'datetime': pd.to_datetime(['2024-01-01']),
            'close': [100]
        })
        original_columns = list(df.columns)
        add_date_features(df)
        
        assert list(df.columns) == original_columns

    def test_handles_end_of_year(self):
        """Test handling of year-end dates"""
        df = pd.DataFrame({
            'datetime': pd.to_datetime(['2024-12-31', '2025-01-01']),
            'close': [100, 101]
        })
        result = add_date_features(df)
        
        assert result['day_of_month'].iloc[0] == 31
        assert result['day_of_month'].iloc[1] == 1
        assert result['quarter'].iloc[0] == 4
        assert result['quarter'].iloc[1] == 1


# ============================================================================
# add_crypto_date_features Tests
# ============================================================================

class TestAddCryptoDateFeatures:
    """Tests for the add_crypto_date_features function"""

    # --- Basic Cases (4) ---

    def test_adds_hour_of_day(self):
        """Test that hour_of_day is correctly added"""
        df = pd.DataFrame({
            'datetime': pd.to_datetime(['2024-01-01 00:00:00', '2024-01-01 12:00:00', '2024-01-01 23:00:00']),
            'close': [100, 101, 102]
        })
        result = add_crypto_date_features(df)
        
        assert 'hour_of_day' in result.columns
        assert result['hour_of_day'].iloc[0] == 0
        assert result['hour_of_day'].iloc[1] == 12
        assert result['hour_of_day'].iloc[2] == 23

    def test_adds_day_of_week(self):
        """Test that day_of_week is correctly added"""
        df = pd.DataFrame({
            'datetime': pd.to_datetime(['2024-01-01 12:00:00', '2024-01-06 12:00:00']),  # Mon, Sat
            'close': [100, 101]
        })
        result = add_crypto_date_features(df)
        
        assert 'day_of_week' in result.columns
        assert result['day_of_week'].iloc[0] == 0  # Monday
        assert result['day_of_week'].iloc[1] == 5  # Saturday

    def test_adds_is_weekend(self):
        """Test that is_weekend is correctly added"""
        df = pd.DataFrame({
            'datetime': pd.to_datetime([
                '2024-01-01 12:00:00',  # Monday
                '2024-01-05 12:00:00',  # Friday
                '2024-01-06 12:00:00',  # Saturday
                '2024-01-07 12:00:00',  # Sunday
            ]),
            'close': [100, 101, 102, 103]
        })
        result = add_crypto_date_features(df)
        
        assert 'is_weekend' in result.columns
        assert result['is_weekend'].iloc[0] == 0  # Monday = not weekend
        assert result['is_weekend'].iloc[1] == 0  # Friday = not weekend
        assert result['is_weekend'].iloc[2] == 1  # Saturday = weekend
        assert result['is_weekend'].iloc[3] == 1  # Sunday = weekend

    def test_adds_day_of_month(self):
        """Test that day_of_month is correctly added"""
        df = pd.DataFrame({
            'datetime': pd.to_datetime(['2024-01-01 12:00:00', '2024-01-31 12:00:00']),
            'close': [100, 101]
        })
        result = add_crypto_date_features(df)
        
        assert 'day_of_month' in result.columns
        assert result['day_of_month'].iloc[0] == 1
        assert result['day_of_month'].iloc[1] == 31

    # --- Edge Cases (3) ---

    def test_custom_date_column(self):
        """Test with custom date column name"""
        df = pd.DataFrame({
            'ts': pd.to_datetime(['2024-01-06 14:30:00']),  # Saturday
            'close': [100]
        })
        result = add_crypto_date_features(df, date_col='ts')
        
        assert 'hour_of_day' in result.columns
        assert result['hour_of_day'].iloc[0] == 14
        assert result['is_weekend'].iloc[0] == 1

    def test_does_not_modify_original(self):
        """Test that original dataframe is not modified"""
        df = pd.DataFrame({
            'datetime': pd.to_datetime(['2024-01-01 12:00:00']),
            'close': [100]
        })
        original_columns = list(df.columns)
        add_crypto_date_features(df)
        
        assert list(df.columns) == original_columns

    def test_midnight_crossing(self):
        """Test handling of midnight crossing timestamps"""
        df = pd.DataFrame({
            'datetime': pd.to_datetime(['2024-01-01 23:59:59', '2024-01-02 00:00:00', '2024-01-02 00:00:01']),
            'close': [100, 101, 102]
        })
        result = add_crypto_date_features(df)
        
        assert result['hour_of_day'].iloc[0] == 23
        assert result['hour_of_day'].iloc[1] == 0
        assert result['hour_of_day'].iloc[2] == 0
        assert result['day_of_month'].iloc[0] == 1
        assert result['day_of_month'].iloc[1] == 2
