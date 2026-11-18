// Snapback cbBTC racer — btc-race-24h-20261118-1444
//
// Idea, in one paragraph: cbBTC on this Orca pool moves in bursts and then
// snaps back. A 30-minute slide of 80 bps or more is usually an overreaction:
// over the frozen dev window, the 30 minutes after such a slide gained
// +41 bps on average (median +46 bps), while the 30 minutes after a sharp
// 30-minute rally lost about as much. This bot does nothing most of the day.
// It waits for a sharp slide, waits one more beat for the fall to stop, buys
// the whole stack, and sells into the bounce. Long only, one position, no
// leverage, no shorts, no clock, no network, no randomness — every decision
// comes from the bars the harness sent, so two runs agree byte for byte.
//
// Costs per round trip are about 26 bps (4 bps fee + 2 bps slippage + price
// impact each way on a $1,000 order), so a trade needs a bounce clearly
// bigger than that. The take-profit at +100 bps and the exits below are
// sized around it.
//
// Entry (all must hold):
//   - the close is at least 80 bps below the close 30 bars ago, and
//   - the close is not still falling: the 3-bar return is >= 0, and
//   - we are not in the last 60 bars of the window (no time to recover
//     the round-trip cost), and at least 45 bars have passed since our
//     last sell (one snapback per slide, not a re-entry into the same one).
//
// Exit (first of these that fires):
//   - take profit: +100 bps from the fill price,
//   - stop loss: -80 bps from the fill price,
//   - the bounce gave back 45 bps from its peak after being +30 bps up,
//   - the 30-minute return turned strongly positive (+60 bps): the snap
//     already happened, sell into the strength,
//   - 240 bars held without any of the above: give up the seat.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch, OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// How far back the slide is measured, and how deep it must be.
const LOOKBACK_BARS = 30;
const DROP_TRIGGER_BPS = 80;
// The fall must have stopped: 3-bar return back at or above zero.
const STABILISE_BARS = 3;

// Exits, all measured from the actual fill price.
const TAKE_PROFIT_BPS = 100;
const STOP_LOSS_BPS = 80;
const MAX_HOLD_BARS = 240;
// Trailing exit: once up this much, sell if it gives back this much.
const TRAIL_ARM_BPS = 30;
const TRAIL_GIVEBACK_BPS = 45;
// The snap already happened: 30-minute return this positive, sell.
const STRENGTH_EXIT_BPS = 60;

// Pacing: one trade per slide, and never open a trade we cannot close.
const COOLDOWN_BARS = 45;
const NO_BUY_AFTER_SEQ = 1380;
// Room for the fill to move from the latest close: modelled slippage plus
// impact plus the gap to the next open. Generous, but still a bound.
const MAX_SLIPPAGE_BPS = 150;

// ---------------------------------------------------------------- helpers

// Return of `now` against `then`, in basis points, as a whole number.
// Prices are raw integers at price_scale 5, so bigint math stays exact and
// deterministic; the division truncates toward zero, which is fine here
// because every comparison below is against a threshold with margin.
function returnBps(now: bigint, then: bigint): bigint {
  if (then === 0n) return 0n;
  return ((now - then) * 10_000n) / then;
}

// ---------------------------------------------------------------- state

// Closes of CBBTC in the order they arrived, raw price units.
const closes: bigint[] = [];

// The position we hold, tracked from the fills the harness reports back.
// entryPrice is the price our buy actually filled at, entrySeq the bar it
// filled on; peakPrice is the highest close seen since we bought.
let entryPrice = 0n;
let entrySeq = -1;
let peakPrice = 0n;
// Seq of the batch our last sell was decided on; -1 means never sold.
let lastSellSeq = -1;
// True while a buy we sent has not been answered by a fill yet.
let buyPending = false;
let sellPending = false;

// Fold this batch's fills into the position trackers above, before any
// decision is made on the batch. A filled buy sets the entry from the price
// the replay really paid; a rejected buy clears the pending flag so the
// next batch may try again.
function applyFills(batch: Batch): void {
  for (const fill of batch.fills) {
    if (fill.symbol !== SYMBOL) continue;
    if (fill.side === 'buy' && fill.status === 'filled') {
      entryPrice = BigInt(fill.price);
      entrySeq = fill.fill_bar;
      peakPrice = entryPrice;
      buyPending = false;
    } else if (fill.side === 'buy') {
      buyPending = false;
    } else if (fill.side === 'sell' && fill.status === 'filled') {
      entryPrice = 0n;
      entrySeq = -1;
      peakPrice = 0n;
      sellPending = false;
    } else if (fill.side === 'sell') {
      sellPending = false;
    }
  }
}

// Is the slide-and-stabilise entry true on the closes seen so far?
function entrySignal(): boolean {
  const n = closes.length;
  if (n <= LOOKBACK_BARS) return false;
  const now = closes[n - 1]!;
  const slide = returnBps(now, closes[n - 1 - LOOKBACK_BARS]!);
  if (slide > -BigInt(DROP_TRIGGER_BPS)) return false;
  const recent = returnBps(now, closes[n - 1 - STABILISE_BARS]!);
  return recent >= 0n;
}

// The 30-bar return right now, for the sell-into-strength exit.
function thirtyBarReturn(): bigint {
  const n = closes.length;
  if (n <= LOOKBACK_BARS) return 0n;
  return returnBps(closes[n - 1]!, closes[n - 1 - LOOKBACK_BARS]!);
}

// Should we sell the position we hold? Checked in order: the loss cap
// first, then the profit target, then the trailing give-back, then selling
// into strength, then the hold limit. Any one of them ends the trade.
function exitSignal(state: BarsState): boolean {
  if (entryPrice === 0n) return false;
  const close = state.close(SYMBOL);
  if (close === null) return false;
  const gain = returnBps(close, entryPrice);
  if (gain <= -BigInt(STOP_LOSS_BPS)) return true;
  if (gain >= BigInt(TAKE_PROFIT_BPS)) return true;
  if (close > peakPrice) peakPrice = close;
  if (gain >= BigInt(TRAIL_ARM_BPS)) {
    const giveback = returnBps(peakPrice, close);
    if (giveback >= BigInt(TRAIL_GIVEBACK_BPS)) return true;
  }
  if (thirtyBarReturn() >= BigInt(STRENGTH_EXIT_BPS)) return true;
  if (entrySeq >= 0 && state.seq - entrySeq >= MAX_HOLD_BARS) return true;
  return false;
}

// ---------------------------------------------------------------- the bot

await runBars({
  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    if (state.warmingUp) return [];
    applyFills(batch);

    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar !== undefined) closes.push(BigInt(bar.c));

    const held = state.positions.get(SYMBOL);
    const qty = held === undefined ? 0n : held.qty;

    // Flat: look for the snapback entry.
    if (qty === 0n) {
      if (buyPending || sellPending) return [];
      if (state.seq >= NO_BUY_AFTER_SEQ) return [];
      if (lastSellSeq >= 0 && state.seq - lastSellSeq <= COOLDOWN_BARS) return [];
      if (!entrySignal()) return [];
      if (state.cash <= 0n) return [];
      buyPending = true;
      return [
        {
          side: 'buy',
          symbol: SYMBOL,
          notional_quote_units: state.cash,
          max_slippage_bps: MAX_SLIPPAGE_BPS,
        },
      ];
    }

    // Holding: look for any exit.
    if (sellPending) return [];
    if (!exitSignal(state)) return [];
    sellPending = true;
    lastSellSeq = state.seq;
    return [
      {
        side: 'sell',
        symbol: SYMBOL,
        qty,
        max_slippage_bps: MAX_SLIPPAGE_BPS,
      },
    ];
  },
});
