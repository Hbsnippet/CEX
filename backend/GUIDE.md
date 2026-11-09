# CEXV3 — Field Guide

A central-limit-order-book exchange, in one file. Read top to bottom once,
then use it as a checklist while you implement each endpoint.

---

## 1. The mental model (how the whole thing works)

### The cast

- **User** — has an `Account`: a map of asset -> `Balance`.
- **Balance** has two numbers: `available` (yours to spend) and `locked`
  (reserved by open orders). Money is never "in limbo" — it is always in
  exactly one of the two buckets.
- **Stock** — has a `symbol` ("AXIS") which is the key everywhere.
- **Order** — intent to trade. `qty` is total wanted, `filledQty` is done.
- **Order book** — per symbol, two sides (`bids` = BUY orders,
  `asks` = SELL orders). Each side is a map: `price -> [orders at that price]`.
- **Fill** — a trade that happened. The "tape".

### Lifecycle of an order (the core loop you'll implement)

```
POST /order
  │
  ├─ 1. VALIDATE      body is untrusted → check everything → build a real Order
  │
  ├─ 2. LOCK          BUY:  INR.available -= price*qty, INR.locked += price*qty
  │                   SELL: stock.available -= qty,  stock.locked += qty
  │
  ├─ 3. MATCH         walk the OPPOSITE side of the book, best price first:
  │                     BUY  → eat asks from lowest price up
  │                     SELL → eat bids from highest price down
  │                   stop when qty filled OR price limit reached
  │
  ├─ 4. SETTLE        per fill:
  │                     buyer.INR.locked    -= price*qty   (cash consumed)
  │                     seller.INR.available += price*qty (cash received)
  │                     buyer.stock.available += qty        (stock received)
  │                     seller.stock.locked   -= qty        (stock delivered)
  │
  ├─ 5. FINISH        filledQty/status updated on the Order;
  │                   leftover: LIMIT → rest on book (keep lock)
  │                            MARKET → cancel remainder (release lock)
  │
  └─ res.json(order)
```

Key insight: **matching is just nested loops over a sorted price map.**
Think "for each price level (best first), for each order in that level,
fill = min(my remaining, their remaining)".

### Rules the exchange must never break

1. You can't spend `available` — only `locked` funds back open orders.
2. A fill moves value atomically: buyer loses INR, gains stock;
   seller loses stock, gains INR. Both sides always move together.
3. Cancelling/expiring an order must return its leftover lock to `available`.
4. The book only ever contains **resting LIMIT** orders. MARKET orders
   never rest (leftover is cancelled).
5. `price` on a BUY = maximum you're willing to pay. On the book,
   a BUY at 1400 must NOT match an ask at 1500.

---

## 2. The types, one by one — why each exists

| Type | What it is | Why it's shaped that way |
|---|---|---|
| `StockSymbol` | `"AXIS" \| "HDFC" \| "TATA"` | A **union of literals**. `symbol: StockSymbol` means TS rejects `"GOOG"` at compile time. If you add a stock, you add it in ONE place (`STOCKS`) and TS forces you to update `ORDERBOOK`. |
| `Side`, `OrderType`, `OrderStatus` | same idea | Enums without enums. `status: OrderStatus` can only ever be those 4 strings — typos like `"FILLED "` can't compile. |
| `Balance` | `{ available, locked }` | The two-bucket money model. |
| `Account` | `{ INR: Balance } & { [K in StockSymbol]?: Balance }` | INR is **required** (everyone has it); stocks are **optional** — you only get an `AXIS` bucket once you hold AXIS. `acc["AXIS"]` has type `Balance \| undefined` → forces you to handle "doesn't hold it". |
| `BookLevel` | `{ orderId, userId, qty }` | One resting order at a price. `qty` = *remaining* qty on the book, not original. |
| `PriceLevelMap` | `Record<number, BookLevel[]>` | `price -> orders`. `Record<K,V>` = "object whose keys are K, values are V". |
| `OrderBook` | `{ bids, asks }` | One per symbol. |
| `Order` | the domain object | `price?` optional because MARKET SELL may not have one. `filledQty` separate from `status` because PARTIAL is derived, not stored intent. |
| `Fill` | the tape record | Stores **both** order ids — you need it later to compute "how much did THIS order spend" for lock refunds. |
| `OrderRequestInput` | the wire format | Deliberately loose: everything optional, strings allowed (`"1500"` from a form). This is the **anti-corruption layer** — validate here, never let it leak into domain code. |

---

## 3. TypeScript concepts you're actually using

### `any` vs the boundary pattern
`req.body` is typed `any` by Express. If you destructure it and use it
directly, **the compiler stops checking everything downstream** — `price * qty`
with `price: any` happily produces `NaN` at runtime and TS says nothing.

The fix is a boundary:

```ts
const body = req.body as OrderRequestInput; // loose on purpose
// ... validate everything ...
// then build: const order: Order = { side, type, symbol, ... }
// now `order` is fully checked forever after
```

### Literal narrowing (the `if`-chains that make TS work for you)

```ts
if (body.side !== "BUY" && body.side !== "SELL") return res.status(400)...
// after this line, TS KNOWS body.side is "BUY" | "SELL"
```
 can miss. TS makes you prove it didn't.
Same for `ORDERBOOK[symbol]`, `acc[symbol]`, `book.asks[price]`.
When TS says "possibly undefined", it means *runtime crash if you're
wrong* — guard it, don't `!` it.

### Optional vs required, and `Record` mapped types

Each `!==` check **narrows** the type. After all your guards pass,
`side`, `type`, `symbol` are real domain types — no casts needed.
This is the single most important TS skill: *narrow, don't cast*.

`as` is a lie you tell the compiler. `narrowing` is the compiler proving
the lie isn't needed. Prefer narrowing.

### `noUncheckedIndexedAccess` (you enabled this — it's why things feel strict)

```ts
const acc = BALANCES[userId];   // type: Account | undefined  ← NOT just Account
if (!acc) return res.status(404)...;
acc.INR.available               // safe now — TS knows acc exists
```

Any `record[key]` lookup can miss. TS makes you prove it didn't.
Same for `ORDERBOOK[symbol]`, `acc[symbol]`, `book.asks[price]`.
When TS says "possibly undefined", it means *runtime crash if you're
wrong* — guard it, don't `!` it.

### Optional vs required, and `Record` mapped types

```ts
type Account = { INR: Balance } & { [K in StockSymbol]?: Balance };
//                        required ──┘        └── optional
acc.INR       // Balance         — always safe to touch
acc.AXIS      // Balance | undefined — must check first
acc["AXIS"]   // same thing, dynamic key
```

`{ [K in StockSymbol]?: Balance }` is a **mapped type** — "for every
StockSymbol, an optional Balance". Add a symbol to `StockSymbol` and
every account automatically allows it.

### Object literal freshness

```ts
const order: Order = { ..., status: "OPEN", ... };
//              ^^^^^^^ annotation makes "OPEN" the literal type OrderStatus wants.
//              Without it, status widens to `string` and won't fit Order.
```

Annotate the variable, don't cast the object. `as Order` skips checking;
`: Order` performs it.

---

## 4. Endpoint-by-endpoint thinking prompts

Don't write code yet. For each one, answer the questions out loud first.

### `POST /order`
- What are ALL the ways `req.body` can be wrong? (missing fields, strings
  instead of numbers, `qty: "abc"`, negative qty, unknown symbol, LIMIT
  without price, BUY without price — a BUY needs a price to know how much
  INR to lock!)
- After validation, what exact `Order` do you construct?
- BUY locks how much? SELL locks how much?
- Matching: which side of `ORDERBOOK[symbol]` do you walk? In what order?
  What stops the loop? (remaining == 0, or next price violates your limit)
- Per fill, which 4 balance fields change and by how much?
- After matching: when do you rest vs cancel? What happens to the lock?

### `DELETE /order/:orderId`
- How do you find "the order's entry in the book"? (you stored orderId in
  BookLevel for exactly this)
- Which balances do you unlock, and how do you compute the *remaining* amount?
  (hint: `order.qty - order.filledQty` for stock; for INR think about what
  was locked vs what fills already consumed)

### `GET /orders`
- `req.query` values are `string | string[] | ... | undefined`. How do you
  safely turn `?userId=1` into a number? What if it's missing?

### `GET /orderbook/:symbol`
- BookLevel has `userId` — must NOT leak. What shape should the response be?
- Bids should sort high→low, asks low→high. Where does sorting happen?

### `GET /fills/:symbol`, `GET /balance`, `GET /stocks`, auth stubs
- Straightforward once the types exist. `/balance` needs `?userId=` →
  `BALANCES[Number(...)]` → guard undefined.

---

## 5. How to work without getting burned

1. **`bun check` after every single edit.** It's instant. The FIRST error
   is real; everything after it is often a cascade — fix top-down.
2. **Never `as` to silence an error.** If `as` "fixes" it, you lied to the
   compiler and the bug ships. Find what it actually wants.
3. **Non-null `!` is a last resort.** `acc[symbol]!` says "trust me" —
   same lie as `as`. Prefer `if (!x) return ...` guards.
4. **When stuck, shrink the problem.** Get `/stocks` working end-to-end
   (request → handler → res.json → curl) before touching matching.
   One working endpoint teaches you more than five half-written ones.
5. **Test with curl.** Server on :3000. Seed data gives you a ready-made
   counterparty: user 2 has a SELL 10 AXIS @1500 resting on the book.
   ```
   bun index.ts
   curl localhost:3000/orderbook/AXIS
   curl -X POST localhost:3000/order -d '{"userId":1,"side":"BUY","type":"LIMIT","symbol":"AXIS","price":1500,"qty":5}' -H 'content-type: application/json'
   curl localhost:3000/fills/AXIS
   ```
6. **Invariants to assert while debugging:**
   `available + locked` per asset should only change via deposits/withdrawals,
   never via trading. If it drifts, your lock/unlock math is wrong.

---

## 6. Suggested build order (each step = one curl test)

1. `GET /stocks` + `GET /balance` — learn req/res, `req.query`.
2. `POST /order` validation only (reject everything bad) — learn narrowing.
3. Locking only (check balances move) — learn the two-bucket model.
4. `matchOrder` for the simple case: one price level, full fill.
5. Partial fills + multiple price levels + price-limit stopping.
6. Rest on book / cancel remainder + `DELETE /order/:orderId`.
7. `GET /orderbook` + `GET /fills` aggregation.
8. Auth last — everything above assumed `userId` came from the client,
   which is fine for learning but never for real money.
