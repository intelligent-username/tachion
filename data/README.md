# Data

File Structure

Different folders are for collecting data on different things.

Each class has a different span of historical data, largely picked based on how volatile it is, but of course all have enough to ensure good model training.

```bash
├── comm                # Commodities: ~16 years
├── crypto/             # Major cryptos: ~5 years
├── equities/           # Stocks: ~5 years
└── forex/              # Currencies: ~15 years
```

The data folder is for:

- Fetching data from an API.
- Writing fetched data so as to never have to collect again.
- Cleaning and preprocessing raw data.
- Storing processed as `parquet` datasets for training and evaluation (so as never to have to process again).

Initial collections will be saved as `JSON` (and not pushed). Each final is saved in CSV format and converted to `parquet` before training. This data won't be pushed to GitHub right now, but can be easily fetched using the `collector` scripts. Note that you will need to get your own API keys for this. Simply place them in an `.env` file in the main directory of the project with the required API keys. You may want to see the main [`README.md`](../README.md/#) for a higher level overview.

Note that the processed data is only used for training. During inference, we'll still pre-process the data in a similar manner but limit the scope of the data (to proper timespan and assets) and won't save it.

This README includes the following details, use the outline to jump around:

- [Storage Structure](#storage)
- [Data Collection](#data-collection)
  - [Equities](#equities)
  - [Crypto](#crypto)
  - [FOREX](#forex)
  - [Commodities](#commodities)
  - [Rates](#rates)
- [Feature Engineering](#feature-engineering)
  - [Equity Features](#equity-features)
  - [Cryptocurrency Features](#cryptocurrency-features)
  - [FOREX Features](#forex-features)
  - [Commodity Features](#commodity-features)
  - [Interest Rate Features](#interest-rate-features)

## Storage

Each asset class (stocks, crypto, ETFs, FOREX, commodities) will have its own subfolder within this `data/` directory.

Within each subfolder,

- Raw data will be stored in the `raw/` directory of this folder. These are stored in JSON and come straight from the data provider API.
- Processed datasets are stored in the `processed/` directory.

## Data Collection

if we ever want to re-train any of the models, we'll re-run the relevant `collector.py` script in the relevant subfolder. This will re-fetch data from the APIs in order to get the most up-to-date historical information. If we don't maintain a local cache of the raw data, it'll take a while to collect all of it again.

### Equities

- We call the TwelveData API to collect historical data
- For inference, we use YFinance (since it's pretty reliable and fast), which we didn't use for historical data since it only goes back a limited time.

### Crypto

- We call the Binance API to collect historical data
- For inference, we also use Binance API, since it's extremely good all-around.

### Forex

- We use the Oanda API to collect historical data and for inference. Currencies are a lot more volatile but dependent on macroeconomic factors, so we'll be collecting ~15 years of data for training instead of 5.
- Note that the Oanda api sometimes freezes the currency prices during Holidays and around, so there'll be large gaps in the data. Don't forget to engineer features to account for this!

### Commodities

Once again, use the `OANDA` API to collect historical data and for inference.

### Rates

For interest rates, we'll mostly be piecing together data from various sources, aggregated mainly by the `FRED` API, to create a dataset for training the XGBoost classification model.

## Feature Engineering

We'll be training multiple different models, each to predict a different label. As a result, each asset type will expect a (slightly) different set of features.

Note:

- Equities and FOREX have time gaps (markets close at 4pm ET on weekdays and at 22:00 UTC Friday respectively, as well as holidays, etc.)
- Commodities are open basically "26/6".

So all 3 require extra engineered features (day of the week, time since last  open, and so on) for the model to understand time context.

Cryptocurrencies trade 24/7, so they don't need these extra features.
Interest rate features are a bit more discrete, so they require a different set of engineered features.

### Equity Features

The following features are needed:

**Item identifiers (`item_id`)**

- `Ticker`

These are 'superkeys' that identify each time series (i.e., each stock).

**Time features (`timestamp`)**

- `Timestamp`

This, paired with the item_id, become like keys (uniquely identify each data point).

**Target (`target`)**

- `log_return`

This is log(today's adjusted close / yesterday's adjusted close). It's what we're trying to predict. We take the logarithm to reduce stabilize variance.

**Lagged covariates (`target_lagged`)**

- `log_return_{t-1}`
- `volume_change`: log(volume_t / volume_{t-1})
- `5_day_MA`
- `50_day_MA`
- `rolling_volatility_5`
- `rolling_volatility_50`
- `S&P_log_return_{t-1}`
- `ΔVIX_{t-1}`

**Known covariates (`dynamic_feat_known`)**

- `day_of_week`: 0 = Monday, …, 6 = Sunday
- `day_of_month`: 1-31
- `quarter`: 1-4
- `S&P_log_return`

**Reminders/Notes:**

1. `log_return` is the **target**.
2. Adjusted close must be used for all price-based computations.
3. Remember to drop the NaN rows (i.e. missing 50-day MA and so on)

### Cryptocurrency Features

**Item identifiers (`item_id`)**

**Coin / Pair:**

- `symbol` (e.g. BTC-USD, ETH-USD)

Each coin is one time series.

**Time features (`timestamp`)**

- `Timestamp` (UTC, consistent granularity)

Paired with `item_id` to uniquely identify observations.

**Target (`target`)**

- `log_return`

$
\log\left(\frac{price_t}{price_{t-1}}\right)
$

Crypto is very heteroskedastic so log returns are mandatory.

**Lagged covariates (`target_lagged`)**

- `log_return_{t-1}`
- `volume_change`: $\log(\frac{\text{volume}_t} {\text{volume}_{t-1}})$
- `5_period_MA`
- `20_period_MA`
- `rolling_volatility_5`
- `rolling_volatility_20`
- `BTC_log_return_{t-1}`
  (systemic market driver)
- `ΔFunding_Rate_{t-1}` *(if derivatives data available)*

**Known covariates (`dynamic_feat_known`)**

- `hour_of_day` (0–23) **important for crypto**
- `day_of_week` (0–6)
- `day_of_month` (1–31)
- `is_weekend`
- `BTC_log_return` *LAGGED*

Crypto trades 24/7, so there's more intra-day seasonality.

**Notes:**

- Again, make sure to lag correctly
- Everything is in USD
- Don't use this to predict stablecoins

### FOREX Features

Since currencies are very stable, the model can learn patterns from historical data with minimal features. Currency changes are mostly driven by longer-term trends; only regime collapses, wars, or new currency establishments cause permanent shifts, which can't really be predicted by a model of this sort anyway.

Features

| Feature           | Type    | Description                      |
|-------------------|---------|----------------------------------|
| `symbol`          | item_id | Currency pair (e.g., EUR_USD)    |
| `timestamp`       | time    | UTC timestamp                    |
| `log_return`      | target  | log(close_t / close_{t-1})       |
| `log_return_lag1` | lagged  | Previous period's log return     |
| `MA_50`           | lagged  | 50-period simple moving average  |
| `MA_200`          | lagged  | 200-period simple moving average |
| `rolling_vol_50`  | lagged  | 50-period rolling volatility     |
| `rolling_vol_200` | lagged  | 200-period rolling volatility    |
| `day_of_week`     | known   | 0=Monday, 6=Sunday               |
| `day_of_month`    | known   | 1-31                             |
| `quarter`         | known   | 1-4                              |

This set avoids short-term noise and captures: long-term trend, volatility regime, and seasonality.

### Commodity Features

Commodity prices are largely stable and affected by technological improvements and historical trends over time. Often, their movement is driven by external factors (geopolitical shifts, natural disasters, supply/demand shocks) that are nearly impossible to predict.

Features

| Feature            | Type    | Description                      |
|--------------------|---------|----------------------------------|
| `symbol`           | item_id | Commodity (e.g., XAU_USD)        |
| `timestamp`        | time    | UTC timestamp                    |
| `log_return`       | target  | log(close_t / close_{t-1})       |
| `log_return_lag1`  | lagged  | Previous period's log return     |
| `MA_50`            | lagged  | 50-period simple moving average  |
| `MA_200`           | lagged  | 200-period simple moving average |
| `rolling_vol_50`   | lagged  | 50-period rolling volatility     |
| `rolling_vol_200`  | lagged  | 200-period rolling volatility    |
| `day_of_week`      | known   | 0=Monday, 6=Sunday               |
| `day_of_month`     | known   | 1-31                             |
| `quarter`          | known   | 1-4                              |

### Interest Rate Features

This is the difficult one

Since we're using XGBoost Classification (Hike/Cut/Hold), we need to engineer features that represent the "Reaction Function" of the central bank. Once again, note that we're currently only dealing with the US Fed.

There are three "types" of factors I will consider:

- Macroeconomic factors
- Market-implied expectations
- Financial conditions & sentiment

The goal of the fed is to have unemployment rates low (around 4% is considered 'natural') while maintaining inflation at around 2% (again, that's what considered 'natural'). Since companies (and people) largely rely on banks, i.e. loans, for liquidity, the interest they pay on these loans has a big effect on how money moves. As such, the rates are used as a hinge to steer the economy. When rates are cut, borrowing becomes easier, spending increases, and we get more jobs. If rates are hiked, borrinwg becomes harder, spending goes down, and inflation is lowered.

![Table Summarizing these features](../imgs/fed.svg)

Basically, the indicator for whether or not looks like this:

$$
(\text{Inflation} - 2.0) - 0.5 \times (\text{Unemployment} - 4.0)
$$

(since inflation is considered "worse", it's weighted more heavily. However, the model shouldn't use this directly, it should learn the weights itself (and relationships with other factors as well) from the data.)

These factors and priorities change based on the economic climate, so sometimes the Fed might care more about unemployment, for example.

Generally, if this number is positive, we expect a hike, and if negative, a cut. Market expectations also usually have an effect, since the unpredictability is also bad for the economy (reduces risk-taking).

So, the Fed (as a board) doesn't use a single number, but a combination of things. To account for this, we need to engineer a few features that represent these factors.

I'm not an economist, so I've done my best to research (ask ChatGPT) the most commonly cited factors that influence Fed decisions. Below is a list, and I'll include the most important ones as features.

### 1. Macroeconomic Factors

Inflation and employment. These capture the core drivers of monetary policy: Inflation and Employment.

**Inflation Momentum:**

- $\text{YoY CPI} / \text{YoY PCE}$
- `Core_PCE_3M_Ann`: 3-month annualized Core PCE (for recent trends).
- `CPI_Surprise`: Difference between actual CPI and consensus forecast.

**Labour Market:**

- `Unemployment_Gap`: Current Unemployment minus NAIRU (Natural Rate).
- `NonFarm_Payrolls_Delta`: Month-over-month change in jobs.
- `Wage_Growth_YoY`: Average hourly earnings (signals cost-push inflation).

**Economic Activity:**

- `GDP_Nowcast`: Real-time GDP estimates (e.g., Atlanta Fed's GDPNow).
- `ISM_Manufacturing_PMI`: A leading indicator of industrial health.

### 2. Market-Implied Expectations (The "Efficient Market" Features)

The market usually prices in the move before it happens. XGBoost will rely heavily on these.

**Fed Funds Futures:**

- `Implied_Rate_Next_Meeting`: Implied rate from the 30-day Fed Funds Futures.
- `Rate_Probability_Delta`: Daily change in the CME FedWatch probabilities for a hike vs. cut.

**Yield Curve Dynamics:**

- `2Y_10Y_Spread`: Curve inversion is a primary signal for cuts/recession.
- `3M_10Y_Spread`: Cited by the Fed as their preferred recession indicator.
- `Real_Yields`: 10-year TIPS yield (represents "tightness" of policy).

### 3. Financial Conditions & Sentiment

- **SEP Dot Plot**: This is the Fed's own forecast of future rates. It's probably the single strongest indicator of what's to come. However, it's only released quarterly and tends to leak into the market beforehand. Also, it would be considered cheating since it's making the same prediction that we're trying to make.
- **Financial Conditions Index (FCI):** Use the GS or Bloomberg FCI. Higher = tighter conditions, reducing the need for a hike.
- **VIX Index:** High volatility (stress) strongly correlates with a "Hold" or "Cut" bias.
- **Stablecoin Volumes**: Since cryptocurrencies don't have earnings, dividends, or intrinsic value, the volume of stablecoins (pegged to USD) shows how much "excess" liquidity is in the economy. Formula:

Let $\Delta SC$ be the stable coin market cap delta, $SC_{t}$ be the current stablecoin market cap, and $SC_{t-1}$ be the previous market cap.

$$ \Delta \text{SC} = \frac{\text{SC}_{t} - \text{SC}_{t-1}}{\text{SC}_{t-1}}$$

We'll use this as our final feature. It needs to be a lagged feature (i.e., from the previous week) to avoid data leakage, and it should use a rolling window.

For even stronger features, we could look into expert sentiments and use NLP to parse Fed minutes, and then convert this to a numeric sentiment score. We could also use deeper economic indicators, create models to create where our current indicators are *headed*, and so forth, but that completely blow up the scale of this project.

The following features have been selected as the final 7:

- `Core_PCE_1M_Ann`     : Recent Inflation momentum
- `Unemployment_Gap`    : Current Unemployment - Natural Rate
- `CPI_Surprise_Proxy`  : Inflation deviation from expectations
- `Spread_3M_2Y`        : short-term rate expectations
- `Spread_2Y_10Y`       : long-term expectations / recession signal
- `Fin_Cond_Ind`        : macro stress indicator, will just be NFCI
- `DFEDTARU`            : Fed's own estimate of the neutral rate

With target class:

$$\text{Target} = \begin{cases}
\text{Hike} & \text{if } \text{Target\_Class} = 1 \\
\text{Cut} & \text{if } \text{Target\_Class} = -1 \\
\text{Hold} & \text{if } \text{Target\_Class} = 0 \\
\end{cases}
$$

and target_class being selected by $\delta_t$:

$$
\delta_t = \text{FFR}_t - \text{FFR}_{t-1}
$$

<!-- Note: Might have to change this due to frequency mismatch, idk yet -->

**Notes:**

- **Point-in-Time Accuracy:** Don't forget to lag the macro features, again.
- **Look-ahead Bias:** The `Target_Class` must be shifted backward by the interval between the feature date and the subsequent FOMC meeting.
