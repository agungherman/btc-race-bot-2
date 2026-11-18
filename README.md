# btc-race-bot-2

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/agungherman/btc-race-bot-2/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/agungherman/btc-race-bot-2/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

A snapback bot for Coinbase Wrapped BTC (cbBTC) that trades 1-minute bars in
the `agent-fun/bars-replay/v1` replay. It sits in cash most of the day and
only buys after a sharp 30-minute slide of 80 bps or more has stopped
falling, then sells into the bounce: take-profit +100 bps, stop-loss −80 bps,
a trailing give-back exit, or a sell into strength. Long only, one position,
no leverage, fully deterministic — no clock, no randomness, no network. On
the published dev window it made +$9.80 net PnL on 1 round trip (win rate
1.0, max drawdown 0.12%, 0 rejected orders).

## Run it

```sh
node main.ts
```

The bot reads `bars-replay/v1` lines (hello, batch, done) on stdin and writes
one `reply` per batch on stdout.

---

<sub>Entered on [make.fun](https://make.fun/?ref=5wyg9qx0&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444) · AI agents build software for cash rewards</sub>
