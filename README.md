# Tachion

![Logo](imgs/Logo.svg)

## Table of Contents

1. [Features](#features)
2. [Prediction Mechanism](#prediction-mechanism)
   - [DeepAR Explained](#deepar-explained)
   - [XGBoost Explained](#xgboost-explained)
3. [Usage](#usage)
   - [Running via Docker](#running-via-docker)
   - [Running Separately](#running-separately)
     - [1. Backend (API)](#1-backend-api)
     - [2. Frontend](#2-frontend)
     - [3. Training](#3-training)
4. [File Structure](#file-structure)
5. [Attributions](#attributions)
6. [Contributing](#contributing)
7. [License](#license)  

---

Tachion is a tool for forecasting market behaviour using historical market data. Currently, it supports:

- Stocks  
- Crypto  
- Forex  
- Commodities (gold, silver, oil)  
- Interest rate hike/cut probabilities  

Tachion provides point predictions and approximate 95% confidence intervals, enabling users to decide whether or not it's a good time to buy or sell.

## Features

- Predict next-period returns or price levels for multiple asset classes  
- Quantile-based predictions to estimate confidence intervals  
- Supports CSV ingestion for historical data  
- Lightweight, extensible Python backend  
- Interactive visualization for historical and predicted values  

## Prediction Mechanism

A different model will be trained for each class. For equities, cryptocurrencies, and commodities, we will use DeepAR (an RNN-based model) to predict the next-period log return based on historical OHLCV data and engineered features. For FOREX, we will use a similar architecture but with more macroeconomic features engineered in. For interest rate hike/cut probabilities, XGBoost will be used to classify the likelihood of a rate change based on historical data and economic indicators.

### DeepAR Explained

DeepAR is an autoregressive recurrent neural network architecture developed by Amazon for probabilistic time series forecasting. It learns patterns across multiple related time series simultaneously, generating not just point predictions but full probability distributions.

Once the learning is done, DeepAR would have generated a statistical distribution that best fits the simulations. We pick the statistical distribution to fit to beforehand, in this case, student's t-distribution, which is well-suited for financial returns due to its heavy tails. During inference, we just do some math based on the parameters of this distribution to get the desired quantiles (2.5th, 50th, 97.5th percentiles). Note, if the distribution doesn't fit well, we can always change it. If the math is "hard" to do, we can always just sample instead (or maybe even not even make a distribution but just plot a histogram directly and get quantiles from that).

This allows Tachion to provide confidence intervals alongside predictions, giving users a sense of uncertainty in the forecast.

See [this repository](https://github.com/intelligent-username/RNN) for more on RNNs and their implementation.

### XGBoost Explained

When it comes to interest rate predictions, we're no longer predicting continuous values, but categorical ones (hike/cut/hold). This requires us to perform classification instad of regression. There are many algorithms for classification. For this project, we'll go with XGBoost.

XGBoost (Extreme Gradient Boosting) is a highly efficient gradient boosting framework that excels at classification tasks. For interest rate predictions, it leverages economic indicators and historical patterns to classify the probability of rate hikes, cuts, or holds. Its ensemble of decision trees captures complex non-linear relationships in macroeconomic data. This, in turn, allows for decently robust predictions (as the Fed, in theory, is supposed to make data-driven decisions). However, it will require a lot of much feature engineering to get right.

See [this writeup](https://github.com/intelligent-username/Classification) for more on classification algorithms and XGBoost.

## Usage

Once it's up, go to [tachion.varak.dev](https://tachion.varak.dev) and use the hosted version.

Run `pytest` in the main directory to ensure tests pass and everything works.

### Running via Docker

The fastest way to get the full stack up.
Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/) (WSL2 engine).
The backend image is CUDA-enabled and needs an NVIDIA GPU.

Docker runs in two modes: production and a hot-reload dev profile.
You pick one explicitly with `--profile prod` or `--profile dev`.

#### Production

Mode for real use. Runs the compiled frontend behind nginx plus the API.

```bash
# From project root
docker compose --profile prod build
docker compose --profile prod up -d
```

The frontend is at [`localhost:3000`](https://localhost:3000).
The API is at [`localhost:8000`](https://localhost:8000) with docs at [`localhost:8000/docs`](https://localhost:8000/docs).
`models/`, `data/`, and `lightning_logs/` are bind-mounted,
so models retrained on the host are picked up by running containers.

To stop: `docker compose --profile prod down`.
To apply code changes: rerun the build, then `up -d`.

#### Dev mode (hot reload)

Mode for working on the code. It swaps in the Vite dev server plus a reloading API,
so edits reach the browser instantly. Both modes bind ports 8000 and 3000,
so stop the other one first.

```bash
# From project root
docker compose down
docker compose --profile dev up
```

- Backend edits (`api/`, `core/`, `train/`) auto-reload. No rebuild.
- Frontend edits hot-reload at [`localhost:3000`](https://localhost:3000). No rebuild.

*See [docker-compose.yml](./docker-compose.yml) and [docker-compose.override.yml](./docker-compose.override.yml) for the full wiring.*

### Running Separately

Prefer bare-metal or developing the two pieces independently? Install dependencies first with [uv](https://docs.astral.sh/uv/): run `uv sync` from the project root.

#### 1. Backend (API)

Powered by FastAPI. Handles model inference and data serving.

```bash
# From project root
uv sync

uv run uvicorn api.main:app --reload
```

Dependencies are managed in `pyproject.toml`.

*See [api/README.md](./api/README.md) for endpoint details.*

#### 2. Frontend

Built with React, Vite, and Bun.

```bash
# From project root
cd frontend
bun install
bun dev
```

The frontend will be available at [`localhost:3000`](https://localhost:3000).

*See [frontend/README.md](./frontend/README.md) for UI structure.*

#### 3. Training

Scripts for retraining models on processed data.

```bash
# From project root (with .venv active)

# Train DeepAR/TFT (e.g., DeepAR on Forex)
uv run python -m train.loops.train_deep forex deepar -n

# Train XGBoost (Interest Rates)
uv run python -m train.loops.train_xgboost

# Evaluate a model
uv run python -m train.eval.evaluate crypto tft2
```

*See [train/README.md](./train/README.md) for model arguments and options.*

## File Structure

Below are some of the important files and folders in this project:

```bash
Tachion/
├── LICENSE
├── README.md
├── pyproject.toml
├── Dockerfile
├── docker-compose.yml
├── .env                    # Make this & put your API keys here
├── api/                    # FastAPI backend
│
├── core/
│   ├── README.md
│   ├── apis/               # GENERAL API wrappers
│   │   ├── biapi.py        # Binance
│   │   ├── frapi.py        # FRED
│   │   ├── oaapi.py        # OANDA
│   │   ├── tdapi.py        # TwelveData
│   │   └── yfapi.py        # yfinance (Yahoo Finance)
│   ├── processor/          # Data processing utils
│   └── training/           # Training configs (constants, loaders)
|
├── data/                   # Data collection & engineer
│   ├── comm/               # Commodities (gold, silver, oil)
│   ├── crypto/
│   ├── equities/
│   ├── forex/              # Currency Exchange
│   └── interest/           # Interest rate indicators
|
├── frontend/
│   ├── components/         # React components
│   └── js/                 # Logic
│
├── test/                   # pytest
│
└── train/                  # Model training & evaluation
    ├── definitions/        # Model definitions (DeepAR, TFT, XGBoost)
    ├── eval/               # Evaluation scripts
    ├── load/               # Data loaders
    └── loops/              # Training loop scripts
```

## Attributions

Tachion uses the APIs from the following for market data:

|    Asset Class      |                   API                  |            Notes         |
| ------------------- |----------------------------------------|------------------------- |
| Equities            | [TwelveData](https://twelvedata.com)   |    Requires API key      |
| Crypto              | [Binance](https://binance.com)         | No authentication needed |
| Forex, Commodities  | [OANDA](https://oanda.com)             | API key requires account |
| Interest-Related    | [FRED](https://fred.stlouisfed.org//)  | Requires API key         |
| yfinance            | [yfinance](https://finance.yahoo.com/) | No authentication needed |

Other sources:

- Cleveland NowCast for real interest rates and CPI consensus:
  - [Cleveland Fed NowCast](https://www.clevelandfed.org/indicators-and-data/inflation-expectations)
  - [Original Excel File](https://www.clevelandfed.org/-/media/files/webcharts/inflationexpectations/inflation-expectations.xlsx?sc_lang=en&hash=C27818913D96CEDD80E3136B9946CFA7)

The original DeepAR paper (actually accessibly written):

Salinas et. al, "DeepAR: Probabilistic Forecasting with Autoregressive Recurrent Networks", 22 Feb. 2019, [https://arxiv.org/abs/1704.04110](https://arxiv.org/abs/1704.04110), last accessed January 2026.

GluonTS, Amazon's official DeepAR library (implementation), which I took lots of inspiration from:

[https://github.com/awslabs/gluonts](https://github.com/awslabs/gluonts).

Documentation: [can be found here](https://ts.gluon.ai/stable/api/gluonts/gluonts.torch.model.deepar.html).

## Contributing

Contributions are welcome. Please follow these guidelines:

1. Fork the repository and create a feature branch.
2. Ensure code adheres to PEP8 and includes tests where applicable.
3. Submit a pull request with a clear description of changes.

## License

Attribution is required. This project is for non-commercial use only. For commercial inquiries, please contact [inquiries@varak.dev](mailto:inquiries@varak.dev).

For full license details, see the [LICENSE](LICENSE).
