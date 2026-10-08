# Coinbase + Kalshi 15-minute research module (phase 1)

This branch introduces read-only Vercel endpoints:
- GET /api/crypto-coinbase?asset=BTC: 60 recent Coinbase 1-minute candles.
- GET /api/crypto-kalshi?ticker=EXACT_MARKET_TICKER: Kalshi market details and executable quote fields when provided.

Both endpoints return explicit upstream failures rather than fabricated prices. No trading credentials or order placement.

## Settlement and matching
Kalshi crypto contracts use a 60-second average of CF Benchmarks RTI observations. Coinbase spot is a predictor, NOT the official settlement oracle. Market ticker, strike comparator, target, settlement window, timestamps and index symbol must be verified against the specific market rules before training or grading. Do not infer tickers or substitute Coinbase close as official outcome.

## Paper-trading validation plan
1. Discover exact 15-minute market tickers from Kalshi series/markets metadata; reject any contract whose terms cannot be parsed reliably.
2. Collect Coinbase candles, Kalshi YES/NO executable ask quotes, available index observations, feed latency and market rules at each decision timestamp. Store durable snapshots externally (serverless filesystem is ephemeral).
3. Save precommitted signals with a timestamp, model version, probability and estimated fees. Never revise them after outcome.
4. Label results only from Kalshi official settlement, accounting for index averaging and strike equality.
5. Walk forward by chronological round, with purging at boundaries and no future leakage. Compare against Kalshi implied probability and simple momentum baselines. Report Brier score, log loss, calibration bins, net paper P&L after fees/spread, sample size and max drawdown.
6. Reject trading if data stale, market paused, quotes missing, or model uncalibrated. Require a meaningful positive lower confidence bound on net edge before ever considering live use.

The exploratory src/crypto/paper-model.js baseline is explicitly blocked from PLAY and does not claim a validated edge. Deployment and live data responses require separate verification.
