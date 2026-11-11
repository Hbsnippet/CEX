import express from 'express';
import { createClient } from 'redis';
const app = express();
app.use(express.json());

const redis = createClient({
  url: 'redis://localhost:6379',
});
await redis.connect();

// --- Orders ---
app.post('/order', async (req, res) => {
  const { userId, qty, side, type, symbol, price } = req.body;

  if (!userId || !side || !type || !symbol || !qty || qty <= 0) {
    return res.status(400).json({ error: 'missing fields' });
  }
  if (type === 'LIMIT' && !price) {
    return res.status(400).json({ error: 'price required for LIMIT' });
  }

  await redis.lPush(
    'incoming-orders',
    JSON.stringify({
      userId,
      qty,
      side,
      type,
      symbol,
      price,
    })
  );

  res.json({ status: 'queued' });
});

// body: OrderRequestInput
// 1. validate input + stock exists  -> narrow to { userId, side, type, symbol, price?, qty }
// 2. check + lock balance (INR for BUY, stock for SELL)
// 3. run matching engine against opposite side of ORDERBOOK
// 4. write fills to FILLS, update filledQty + status on ORDERS
// 5. if leftover qty and LIMIT, rest on book; if MARKET, cancel remainder
// 6. settle balances on each fill (move locked -> other asset's available)

app.delete('/order/:orderId', (req, res) => {
  // 1. find order, check ownership1
  // 2. remove from ORDERBOOK price level
  // 3. unlock remaining reserved balance
  // 4. mark status = CANCELLED
});

app.get('/orders', (req, res) => {
  // query: ?status=OPEN&userId=1  (or all)
  // return current user's orders — filter ORDERS, then res.json(...)
  res.json(ORDERS);
});

// --- Market data ---
app.get('/orderbook/:symbol', (req, res) => {
  // return aggregated depth — totalQty per price level for bids and asks
  // (don't expose individual userIds to other users)
  const symbol = req.params.symbol as StockSymbol;
  res.json(ORDERBOOK[symbol] ?? {});
});

app.get('/fills/:symbol', (req, res) => {
  // recent trades for this stock — the "tape"
});

app.get('/stocks', (req, res) => {
  // res.json(STOCKS)
});

// --- User data ---
app.get('/balance', (req, res) => {
  // return BALANCES[userId] for the authed user
  const userId = Number(req.query.userId);
  res.json(BALANCES[userId] ?? { error: 'no user' });
});

app.listen(3000, () => {
  console.log('Server is running on port 3000');
});
