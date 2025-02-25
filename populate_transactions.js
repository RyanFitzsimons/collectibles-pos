const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Connect to the database
const dbPath = path.join(__dirname, 'inventory.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Failed to open database:', err);
    process.exit(1);
  }
  console.log('Connected to database:', dbPath);
});

// Ensure tables exist
db.serialize(() => {
  db.run('CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, type TEXT, cash_in REAL, cash_out REAL, timestamp TEXT)', (err) => {
    if (err) {
      console.error('Error creating transactions table:', err);
      process.exit(1);
    }
    console.log('Transactions table created or already exists');
  });
  db.run('CREATE TABLE IF NOT EXISTS transaction_items (transaction_id TEXT, item_id TEXT, name TEXT, role TEXT, trade_value REAL, negotiated_price REAL, original_price REAL, image_url TEXT, condition TEXT, card_set TEXT, PRIMARY KEY (transaction_id, item_id))', (err) => {
    if (err) {
      console.error('Error creating transaction_items table:', err);
      process.exit(1);
    }
    console.log('Transaction_items table created or already exists');
  });
});

// Sample data
const types = ['sell', 'buy', 'trade'];
const cardNames = [
  'Charizard', 'Pikachu', 'Blastoise', 'Venusaur', 'Gengar', 'Dragonite', 
  'Mewtwo', 'Snorlax', 'Lapras', 'Gyarados', 'Arcanine', 'Machamp'
];
const sets = [
  'Base Set', 'Jungle', 'Fossil', 'Team Rocket', 'Gym Heroes', 'Neo Genesis', 
  'EX Dragon', 'Crystal Guardians', 'Diamond & Pearl', 'Black & White'
];
const conditions = [
  'Raw - NM', 'Raw - LP', 'Raw - MP', 'PSA - 10', 'PSA - 9', 'PSA - 8', 
  'CGC - 9', 'BGS - 9.5', 'TAG - 10'
];

// Generate a random timestamp within the last year
function randomTimestamp() {
  const now = new Date();
  const past = new Date(now - 365 * 24 * 60 * 60 * 1000); // 1 year ago
  const randomTime = past.getTime() + Math.random() * (now.getTime() - past.getTime());
  return new Date(randomTime).toISOString();
}

// Generate a transaction with items
function generateTransaction(index) {
  const id = `${Date.now()}-${index}`;
  const type = types[Math.floor(Math.random() * types.length)]; // buy, sell, trade
  const timestamp = randomTimestamp();
  const itemCount = Math.floor(Math.random() * 5) + 1; // 1-5 items
  let cashIn = 0;
  let cashOut = 0;
  const items = [];

  for (let i = 0; i < itemCount; i++) {
    const name = cardNames[Math.floor(Math.random() * cardNames.length)];
    const card_set = sets[Math.floor(Math.random() * sets.length)];
    const condition = conditions[Math.floor(Math.random() * conditions.length)];
    const price = parseFloat((Math.random() * 100 + 1).toFixed(2)); // $1-$100
    const tradeValue = parseFloat((price * (Math.random() * 0.5 + 0.5)).toFixed(2)); // 50-100% of price
    const negotiatedPrice = type === 'sell' || type === 'trade' ? parseFloat((price * (Math.random() * 0.3 + 0.7)).toFixed(2)) : null; // 70-100% of price
    const role = type === 'sell' ? 'sold' : type === 'buy' ? 'trade_in' : Math.random() > 0.5 ? 'trade_in' : 'trade_out';
    const item_id = `${id}-${i}`;
    const image_url = `file://${path.join(__dirname, 'images', `${name.toLowerCase()}-${card_set.toLowerCase().replace(' ', '-')}.png`)}`;

    items.push({ 
      transaction_id: id, 
      item_id, 
      name, 
      role, 
      trade_value: role === 'trade_in' ? tradeValue : null, 
      negotiated_price: role === 'sold' || role === 'trade_out' ? negotiatedPrice : null, 
      original_price: price, 
      image_url, 
      condition, 
      card_set
    });

    if (role === 'sold') cashIn += negotiatedPrice || price;
    if (role === 'trade_in') cashOut += tradeValue;
    if (role === 'trade_out') cashIn += negotiatedPrice || price;
  }

  if (type === 'trade') {
    const tradeInTotal = parseFloat(items.filter(item => item.role === 'trade_in').reduce((sum, item) => sum + item.trade_value, 0).toFixed(2));
    const tradeOutTotal = parseFloat(items.filter(item => item.role === 'trade_out').reduce((sum, item) => sum + (item.negotiated_price || item.original_price), 0).toFixed(2));
    cashIn = parseFloat(Math.max(tradeOutTotal - tradeInTotal, 0).toFixed(2));
    cashOut = parseFloat((tradeInTotal > tradeOutTotal ? tradeInTotal - tradeOutTotal : 0).toFixed(2));
  } else if (type === 'sell') {
    cashIn = parseFloat(cashIn.toFixed(2));
    cashOut = 0;
  } else if (type === 'buy') {
    cashIn = 0;
    cashOut = parseFloat(cashOut.toFixed(2));
  }

  return { id, type, cash_in: cashIn, cash_out: cashOut, timestamp, items };
}

// Populate 100 transactions
const totalTransactions = 100;
console.log(`Generating ${totalTransactions} transactions...`);

db.serialize(() => {
  const transactionStmt = db.prepare('INSERT OR IGNORE INTO transactions (id, type, cash_in, cash_out, timestamp) VALUES (?, ?, ?, ?, ?)');
  const itemStmt = db.prepare('INSERT OR IGNORE INTO transaction_items (transaction_id, item_id, name, role, trade_value, negotiated_price, original_price, image_url, condition, card_set) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');

  for (let i = 0; i < totalTransactions; i++) {
    const { id, type, cash_in, cash_out, timestamp, items } = generateTransaction(i);
    
    transactionStmt.run(id, type, cash_in, cash_out, timestamp, (err) => {
      if (err) console.error('Transaction insert error:', err);
    });

    items.forEach(item => {
      itemStmt.run(
        item.transaction_id, item.item_id, item.name, item.role, item.trade_value, 
        item.negotiated_price, item.original_price, item.image_url, item.condition, item.card_set,
        (err) => {
          if (err) console.error('Item insert error:', err);
        }
      );
    });
  }

  transactionStmt.finalize((err) => {
    if (err) console.error('Transaction finalize error:', err);
  });
  itemStmt.finalize((err) => {
    if (err) {
      console.error('Item finalize error:', err);
    } else {
      console.log(`${totalTransactions} transactions with items inserted successfully!`);
    }
    db.close();
  });
});