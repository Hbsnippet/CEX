import { createClient } from 'redis';

const redis = createClient({ url: 'redis://localhost:6379' });
await redis.connect();

const PublisherClient = createClient({ url: 'redis://localhost:6379' });
await PublisherClient.connect();

console.log('Engine listening...');

type StockSymbol = 'AXIS' | 'HDFC' | 'TATA';
type Side = 'BUY' | 'SELL';
type OrderType = 'LIMIT' | 'MARKET';
type OrderStatus = 'OPEN' | 'FILLED' | 'PARTIAL' | 'CANCELLED';

type User = { id: number; username: string; password: string };
type Stock = { id: number; title: string; symbol: StockSymbol };

type Balance = { available: number; locked: number };
// Every account MUST have INR; stock balances only exist once held.
type Account = { INR: Balance } & { [K in StockSymbol]?: Balance };

// Order book: symbol -> side -> price -> queue of resting orders
type BookLevel = { orderId: number; userId: number; qty: number };
type PriceLevelMap = Record<number, BookLevel[]>;
type OrderBook = { bids: PriceLevelMap; asks: PriceLevelMap };

type Order = {
  id: number;
  userId: number;
  side: Side;
  type: OrderType;
  symbol: StockSymbol;
  price?: number; // LIMIT: required. MARKET BUY: max acceptable price.
  qty: number;
  filledQty: number;
  status: OrderStatus;
  createdAt: number;
};

type Fill = {
  id: number;
  buyOrderId: number;
  sellOrderId: number;
  symbol: StockSymbol;
  price: number;
  qty: number;
  ts: number;
};

// What the client actually sends — untrusted, so everything optional.
// Validate it, THEN construct a real `Order`.

// ============================================================
// DATA
// ============================================================

const USERS: User[] = [
  { id: 1, username: 'admin', password: 'admin' },
  { id: 2, username: 'user', password: 'user' },
];

const STOCKS: Stock[] = [
  { id: 1, title: 'AXIS BANK', symbol: 'AXIS' },
  { id: 2, title: 'HDFC BANK', symbol: 'HDFC' },
  { id: 3, title: 'TATA Steel', symbol: 'TATA' },
];

const ORDERS: Order[] = [];
const FILLS: Fill[] = [];

// { userId: { INR: Balance, AXIS?: Balance, ... } }
const BALANCES: Record<number, Account> = {
  1: {
    INR: { available: 100000, locked: 5000 },
    AXIS: { available: 100, locked: 0 },
  },
  2: {
    INR: { available: 50000, locked: 0 },
    AXIS: { available: 50, locked: 20 },
  },
};

const ORDERBOOK: Record<StockSymbol, OrderBook> = {
  AXIS: { bids: {}, asks: {} },
  HDFC: { bids: {}, asks: {} },
  TATA: { bids: {}, asks: {} },
};

// Seed order proves the types compile — replace ids with your own scheme.
let nextOrderId = 1;
let nextFillId = 1;

// after let nextOrderId = 1; nextFillId = 1;

// seed 1
const o1: Order = {
  id: nextOrderId++,
  userId: 2,
  side: 'SELL',
  type: 'LIMIT',
  symbol: 'AXIS',
  price: 1500,
  qty: 100,
  filledQty: 0,
  status: 'OPEN',
  createdAt: Date.now(),
};
ORDERS.push(o1);
ORDERBOOK.AXIS.asks[1500] = [{ orderId: o1.id, userId: 2, qty: 100 }];

// seed 2
const o2: Order = {
  id: nextOrderId++,
  userId: 2,
  side: 'SELL',
  type: 'LIMIT',
  symbol: 'AXIS',
  price: 1510,
  qty: 100,
  filledQty: 0,
  status: 'OPEN',
  createdAt: Date.now(),
};
ORDERS.push(o2);
ORDERBOOK.AXIS.asks[1510] = [{ orderId: o2.id, userId: 2, qty: 100 }];

while (true) {
  const result = await redis.brPop('incoming-orders', 0);
  if (!result) continue;

  const raw = JSON.parse(result.element);
  console.log('Got order:', raw);

  const userId = Number(raw.userId);
  const qty = Number(raw.qty);
  const side = raw.side as Side;
  const type = raw.type as OrderType;
  const symbol = raw.symbol as StockSymbol;
  const price = raw.price !== undefined ? Number(raw.price) : undefined;

  if (
    !userId ||
    !qty ||
    qty <= 0 ||
    !side ||
    !type ||
    !symbol ||
    !BALANCES[userId] ||
    !ORDERBOOK[symbol] ||
    (type === 'LIMIT' && (price === undefined || price <= 0))
  ) {
    console.log('Invalid order, skipping');
    continue;
  }

  const bal = BALANCES[userId];

  // LOCK
  if (side === 'BUY') {
    const required = price! * qty;
    if (bal.INR.available < required) {
      console.log('Insufficient INR');
      continue;
    }
    bal.INR.available -= required;
    bal.INR.locked += required;
  } else {
    if (!bal[symbol] || bal[symbol]!.available < qty) {
      console.log('Insufficient stock');
      continue;
    }
    bal[symbol]!.available -= qty;
    bal[symbol]!.locked += qty;
  }

  const order: Order = {
    id: nextOrderId++,
    userId,
    side,
    type,
    symbol,
    price,
    qty,
    filledQty: 0,
    status: 'OPEN',
    createdAt: Date.now(),
  };
  ORDERS.push(order);

  let remainingQty = qty;
  const fills: Fill[] = [];

  const opposite =
    side === 'BUY' ? ORDERBOOK[symbol].asks : ORDERBOOK[symbol].bids;
  const prices = Object.keys(opposite)
    .map(Number)
    .sort((a, b) => (side === 'BUY' ? a - b : b - a));

  for (const levelPrice of prices) {
    if (remainingQty <= 0) break;
    if (type === 'LIMIT' && price !== undefined) {
      if (side === 'BUY' && levelPrice > price) break;
      if (side === 'SELL' && levelPrice < price) break;
    }

    const level = opposite[levelPrice];
    if (!level) continue;

    while (level.length > 0 && remainingQty > 0) {
      const resting = level[0];
      if (!resting) break;

      const fillQty = Math.min(remainingQty, resting.qty);
      if (fillQty <= 0) break;

      fills.push({
        id: nextFillId++,
        buyOrderId: side === 'BUY' ? order.id : resting.orderId,
        sellOrderId: side === 'BUY' ? resting.orderId : order.id,
        symbol,
        price: levelPrice,
        qty: fillQty,
        ts: Date.now(),
      });

      order.filledQty += fillQty;
      resting.qty -= fillQty;
      remainingQty -= fillQty;

      const restingOrder = ORDERS.find((o) => o.id === resting.orderId);
      if (restingOrder) restingOrder.filledQty += fillQty;

      const tradeValue = fillQty * levelPrice;

      if (side === 'BUY') {
        bal.INR.locked -= tradeValue;
        if (!bal[symbol]) bal[symbol] = { available: 0, locked: 0 };
        bal[symbol].available += fillQty;

        const seller = BALANCES[resting.userId];
        if (seller?.[symbol]) {
          seller.INR.available += tradeValue;
          seller[symbol]!.locked -= fillQty;
        }
      } else {
        if (bal[symbol]) bal[symbol].locked -= fillQty;
        bal.INR.available += tradeValue;

        const buyer = BALANCES[resting.userId];
        if (buyer) {
          buyer.INR.locked -= tradeValue;
          if (!buyer[symbol]) buyer[symbol] = { available: 0, locked: 0 };
          buyer[symbol].available += fillQty;
        }
      }

      if (resting.qty <= 0) level.shift();
    }

    if (level.length === 0) delete opposite[levelPrice];
  }

  // LEFTOVER
  if (remainingQty > 0 && type === 'LIMIT' && price !== undefined) {
    const mySide =
      side === 'BUY' ? ORDERBOOK[symbol].bids : ORDERBOOK[symbol].asks;
    if (!mySide[price]) mySide[price] = [];
    mySide[price].push({ orderId: order.id, userId, qty: remainingQty });
  } else if (remainingQty > 0) {
    if (side === 'BUY' && price !== undefined) {
      const unused = remainingQty * price;
      bal.INR.locked -= unused;
      bal.INR.available += unused;
    } else if (bal[symbol]) {
      bal[symbol].locked -= remainingQty;
      bal[symbol].available += remainingQty;
    }
    order.status = 'CANCELLED';
  }

  if (order.filledQty === order.qty) order.status = 'FILLED';
  else if (order.filledQty > 0) order.status = 'PARTIAL';

  await PublisherClient.lPush(
    'response-queue' + raw.queue_id,
    JSON.stringify({
      identifier: raw.identifier,
      queue_id: raw.queue_id,
      orderId: order.id,
      filledQty: order.filledQty,
      status: order.status,
      fills,
    })
  );

  console.log('Processed', {
    orderId: order.id,
    filledQty: order.filledQty,
    status: order.status,
    fills: fills.length,
  });
}
