import express from 'express';
const app = express();
app.use(express.json());

type OrderRequest = {
  userId: number;
  side: "BUY" | "SELL";
  type: "LIMIT" | "MARKET";
  symbol: Symbol;
  price?: number;
  qty: number;
}





type Symbol = "AXIS" | "HDFC" | "TATA";

const USERS = [
  { id: 1, username: "admin", password: "admin" },
  { id: 2, username: "user", password: "user" },
 ];
const STOCKS = [
  { id: 1, title: "AXIS BANK", symbol: "AXIS" },
  { id: 2, title: "HDFC BANK", symbol: "HDFC" },
  { id: 3, title: "TATA Steel", symbol: "TATA" },
];
type Order = {
  id: number;
  userId: number;
  side: "BUY" | "SELL";
  type: "LIMIT" | "MARKET";
  symbol: Symbol;
  price?: number;
  qty: number;
  filledQty: number;
  status: "OPEN" | "FILLED" | "PARTIAL" | "CANCELLED";
  createdAt: number;
};
const ORDERS: Order[] = [];
const FILLS = [];
type Balance = { available: number; locked: number };
type Account = { INR: Balance } & Record<string, Balance>;
const BALANCES: Record<number, Account> = {
  1: { INR: { available: 100000, locked: 5000 }, AXIS: { available: 100, locked: 0 } },
  2: { INR: { available: 50000, locked: 0 }, AXIS: { available: 50, locked: 20 } }
} // { userId: { INR: {available, locked}, AXIS: {available, locked}, ... } }

type BookLevel = { orderId: number; userId: number; qty: number };
type OrderSide = Record<number, BookLevel[]>;
const ORDERBOOK: Record<"AXIS" | "HDFC" | "TATA", { bids: OrderSide; asks: OrderSide }> = {
  AXIS: { bids: {}, asks: {} },
  HDFC: { bids: {}, asks: {} },
  TATA: { bids: {}, asks: {} },
};

ORDERS.push({
  id: 1,
  userId: 2,
  side: "SELL",
  type: "LIMIT",
  symbol: "AXIS",
  price: 1500,
  qty: 10,
  filledQty: 0,
  status: "OPEN",
  createdAt: Date.now()
});
ORDERBOOK.AXIS.asks[1500] = [{ orderId: 1, userId: 2, qty: 10 }];

console.log(ORDERS)

// --- Auth ---
app.post("/signup", (req, res) => {
  // const { username, password } = req.body;
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
  // body: { userId, side: "BUY"|"SELL", type: "LIMIT"|"MARKET", symbol, price?, qty }
  // 1. validate input + stock exists
  // 2. check + lock balance (INR for BUY, stock for SELL)
  // 3. run matching engine against opposite side of ORDERBOOK
  // 4. write fills to FILLS, update filledQty + status on ORDERS
  // 5. if leftover qty and LIMIT, rest on book; if MARKET, cancel remainder
  // 6. settle balances on each fill (move locked -> other asset's available)

  const { userId, side, type, symbol, price, qty } = req.body;

  const userIdNum = Number(userId);

  console.log(`order is processing ${userId}`);


  if(qty <= 0 || type === "LIMIT" && !price) {
    return res.status(400).json({ error: "Invalid quantity or price" });
  }

  if(!STOCKS.some(s => s.symbol === symbol)) {
    return res.status(400).json({ error: "Invalid symbol" });
  }

  const bookSymbol = symbol as keyof typeof ORDERBOOK;

  const bal = BALANCES[userIdNum];
  if (!bal) {
    return res.status(404).json({ error: "Unknown user" });
  }



  if(side === "BUY") {
    const required = price * qty;
    if(bal.INR?.available < required) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    bal.INR.available -= required;
    bal.INR.locked += required;

  } else {
    if(!bal[symbol]) {
      return res.status(400).json({ error: "Invalid symbol" });
    }
    if(bal[symbol].available < qty) {
      return res.status(400).json({ error: "Not enough stock" });
    }
    bal[symbol].available -= qty;
    bal[symbol].locked += qty;
  }

  const order  = {
    id: Date.now(),
    userId: userIdNum,
    side,
    type,
    symbol,
    price,
    qty,
    filledQty: 0,
    status: "OPEN",
    createdAt: Date.now()
  };

  ORDERS.push(order as Order);



  let remianingQty = qty;
  const fills: any[] = [];


  // opposite side

  const oppositeSide = side === "BUY" ? ORDERBOOK[bookSymbol]?.asks : ORDERBOOK[bookSymbol]?.bids;





});

app.delete("/order/:orderId", (req, res) => {
  // 1. find order, check ownership
  // 2. remove from ORDERBOOK price level
  // 3. unlock remaining reserved balance
  // 4. mark status = CANCELLED
});

app.get("/orders", (req, res) => {
  // query: ?status=OPEN  (or all)
  // return current user's orders
  const { status, userId } = req.query;
  let orders = ORDERS;
  if (userId) orders = orders.filter(o => o.userId === Number(userId));
  if (status) orders = orders.filter(o => o.status === status);
  res.json(orders);
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
  res.json(STOCKS);
});

// --- User data ---
app.get("/balance", (req, res) => {
  // return BALANCES[userId] for the authed user
});




app.listen(3000, () => {
    console.log('Server is running on port 3000');
});











