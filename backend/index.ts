import express from "express";
const app = express();
app.use(express.json());

// ============================================================
// TYPES — read GUIDE.md before touching logic.
// Rule: data crosses a boundary as `unknown`/loose input,
// gets validated, then becomes a strict domain type.
// ============================================================

type StockSymbol = "AXIS" | "HDFC" | "TATA";
type Side = "BUY" | "SELL";
type OrderType = "LIMIT" | "MARKET";
type OrderStatus = "OPEN" | "FILLED" | "PARTIAL" | "CANCELLED";

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
type OrderRequestInput = {
  userId?: number | string;
  side?: string;
  type?: string;
  symbol?: string;
  price?: number | string;
  qty?: number | string;
};

// ============================================================
// DATA
// ============================================================

const USERS: User[] = [
  { id: 1, username: "admin", password: "admin" },
  { id: 2, username: "user", password: "user" },
];

const STOCKS: Stock[] = [
  { id: 1, title: "AXIS BANK", symbol: "AXIS" },
  { id: 2, title: "HDFC BANK", symbol: "HDFC" },
  { id: 3, title: "TATA Steel", symbol: "TATA" },
];

const ORDERS: Order[] = [];
const FILLS: Fill[] = [];

// { userId: { INR: Balance, AXIS?: Balance, ... } }
const BALANCES: Record<number, Account> = {
  1: { INR: { available: 100000, locked: 5000 }, AXIS: { available: 100, locked: 0 } },
  2: { INR: { available: 50000, locked: 0 }, AXIS: { available: 50, locked: 20 } },
};

const ORDERBOOK: Record<StockSymbol, OrderBook> = {
  AXIS: { bids: {}, asks: {} },
  HDFC: { bids: {}, asks: {} },
  TATA: { bids: {}, asks: {} },
};

// Seed order proves the types compile — replace ids with your own scheme.
let nextOrderId = 1;
let nextFillId = 1;

const seedOrder: Order = {
  id: nextOrderId++,
  userId: 2,
  side: "SELL",
  type: "LIMIT",
  symbol: "AXIS",
  price: 1500,
  qty: 10,
  filledQty: 0,
  status: "OPEN",
  createdAt: Date.now(),
};
ORDERS.push(seedOrder);
ORDERBOOK.AXIS.asks[1500] = [
  { orderId: seedOrder.id, userId: seedOrder.userId, qty: seedOrder.qty },
];

// ============================================================
// HELPERS — you write these. Suggested signatures:
//
//   function lockForOrde1r(order: Order, acc: Account): string | null
//     -> moves available -> locked, returns error message or null
//
//   function matchOrder(order: Order): Fill[]
//     -> walks ORDERBOOK[order.symbol] opposite side, best price first,
//        mutates orders/book/balances, returns the fills it created
//
//   function restOnBook(order: Order, qty: number): void
//   function cancelRemainder(order: Order, qty: number): void
//     -> releases the leftover lock (available += , locked -=)
// ============================================================

// --- Auth ---
app.post("/signup", (req, res) => {
  // const { username, password } = req.body as { username?: string; password?: string };
  // 1. check username not taken
  // 2. hash password (bcrypt/argon2)
  // 3. push to USERS
  // 4. init BALANCES[userId] with INR: { available: 0, locked: 0 }
});

app.post("/login", (req, res) => {
  // 1. find user by username
  // 2. compare hashed password
  // 3. return JWT / session token
});

// --- Orders ---
app.post("/order", (req, res) => {
  // body: OrderRequestInput
  // 1. validate input + stock exists  -> narrow to { userId, side, type, symbol, price?, qty }
  // 2. check + lock balance (INR for BUY, stock for SELL)
  // 3. run matching engine against opposite side of ORDERBOOK
  // 4. write fills to FILLS, update filledQty + status on ORDERS
  // 5. if leftover qty and LIMIT, rest on book; if MARKET, cancel remainder
  // 6. settle balances on each fill (move locked -> other asset's available)
});

app.delete("/order/:orderId", (req, res) => {
  // 1. find order, check ownership
  // 2. remove from ORDERBOOK price level
  // 3. unlock remaining reserved balance
  // 4. mark status = CANCELLED
});

app.get("/orders", (req, res) => {
  // query: ?status=OPEN&userId=1  (or all)
  // return current user's orders — filter ORDERS, then res.json(...)
});

// --- Market data ---
app.get("/orderbook/:symbol", (req, res) => {
  // return aggregated depth — totalQty per price level for bids and asks
  // (don't expose individual userIds to other users)
});

app.get("/fills/:symbol", (req, res) => {
  // recent trades for this stock — the "tape"
});

app.get("/stocks", (req, res) => {
  // res.json(STOCKS)
});

// --- User data ---
app.get("/balance", (req, res) => {
  // return BALANCES[userId] for the authed user
});

app.listen(3000, () => {
  console.log("Server is running on port 3000");
});
