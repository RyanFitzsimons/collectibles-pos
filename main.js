require('dotenv').config();
const { app, BrowserWindow, ipcMain, net } = require('electron');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');

const dbPath = path.join(__dirname, 'inventory.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Failed to open database:', err);
  } else {
    console.log('Database opened successfully:', dbPath);
  }
});

// Initialize database tables on app start
db.serialize(() => {
  // Create table for inventory items (cards in stock)
  db.run('CREATE TABLE IF NOT EXISTS collectibles (id TEXT PRIMARY KEY, type TEXT, name TEXT, price REAL, stock INTEGER, image_url TEXT, tcg_id TEXT, card_set TEXT, rarity TEXT, condition TEXT)', (err) => {
    if (err) console.error('Error creating collectibles table:', err);
    else console.log('Collectibles table created or already exists');
  });
  // Create table for transaction records (buy/sell/trade)
  db.run('CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, type TEXT, cash_in REAL, cash_out REAL, timestamp TEXT)', (err) => {
    if (err) console.error('Error creating transactions table:', err);
    else console.log('Transactions table created or already exists');
  });
  // Create table for items within transactions (links items to transactions)
  db.run('CREATE TABLE IF NOT EXISTS transaction_items (id INTEGER PRIMARY KEY AUTOINCREMENT, transaction_id TEXT, item_id TEXT, name TEXT, role TEXT, trade_value REAL, negotiated_price REAL, original_price REAL, image_url TEXT, condition TEXT, card_set TEXT)', (err) => {
    if (err) console.error('Error creating transaction_items table:', err);
    else console.log('Transaction_items table created or already exists');
  });
  // Create table for cash reconciliation records
  db.run('CREATE TABLE IF NOT EXISTS cash_reconciliations (id TEXT PRIMARY KEY, date TEXT, starting_cash REAL, total_cash_in REAL, total_cash_out REAL, expected_cash REAL, actual_cash REAL, discrepancy REAL, notes TEXT)', (err) => {
    if (err) console.error('Error creating cash_reconciliations table:', err);
    else console.log('Cash_reconciliations table created or already exists');
  });
});

let mainWindow;

// Set up the main application window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Handle adding a new item to inventory (e.g., during Buy/Trade-In
ipcMain.on('add-item', async (event, item) => {
  let imageUrl = null;

  // Download image if provided and not already a file URL
  if (item.image_url && !item.image_url.startsWith('file://')) {
    imageUrl = path.join(__dirname, 'images', `${item.id}-${item.tcg_id || 'card'}.png`);
    try {
      await new Promise((resolve, reject) => {
        const request = net.request(item.image_url);
        request.on('response', (response) => {
          if (response.statusCode !== 200) {
            reject(new Error(`Failed to fetch image: ${response.statusCode}`));
            return;
          }
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => {
            fs.mkdirSync(path.join(__dirname, 'images'), { recursive: true });
            const buffer = Buffer.concat(chunks);
            fs.writeFileSync(imageUrl, buffer);
            console.log('Image downloaded and saved:', imageUrl);
            resolve();
          });
          response.on('error', reject);
        });
        request.on('error', reject);
        request.end();
      });
    } catch (err) {
      console.error('Image download error:', err);
      event.reply('add-item-error', err.message);
      return;
    }
  }

  const finalItem = {
    ...item,
    image_url: imageUrl ? `file://${imageUrl}` : item.image_url
  };
  
  // Add item to collectibles table if it’s a trade-in (bought item)
  if (item.role === 'trade_in') {
    db.run('INSERT INTO collectibles (id, type, name, price, stock, image_url, tcg_id, card_set, rarity, condition) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [item.id, item.type, item.name, item.price, 1, finalItem.image_url, item.tcg_id || null, item.card_set || null, item.rarity || null, item.condition || null],
      (err) => {
        if (err) {
          console.error('Add item error:', err);
          event.reply('add-item-error', err.message);
        } else {
          console.log('Item added to DB:', finalItem);
          event.reply('add-item-success', finalItem);
        }
      });
  } else {
    event.reply('add-item-success', finalItem);
  }
});

// Process a completed transaction (Buy, Sell, Trade)
ipcMain.on('complete-transaction', (event, { items, type, cashIn, cashOut }) => {
  const txId = Date.now().toString();
  // Record transaction header
  db.run('INSERT INTO transactions (id, type, cash_in, cash_out, timestamp) VALUES (?, ?, ?, ?, ?)',
    [txId, type, cashIn, cashOut, new Date().toISOString()],
    (err) => {
      if (err) {
        console.error('Transaction insert error:', err);
        return event.reply('transaction-error', err.message);
      }
      // Record each item in the transaction
      const itemInserts = items.map(item => new Promise((resolve, reject) => {
        if (item.role === 'trade_in') {
          const imageUrl = item.image_url && !item.image_url.startsWith('file://') 
            ? `file://${path.join(__dirname, 'images', `${item.id}-${item.tcg_id || 'card'}.png`)}` 
            : item.image_url;
          db.run('INSERT INTO transaction_items (transaction_id, item_id, name, role, trade_value, original_price, image_url, condition, card_set) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [txId, item.id, item.name, item.role, item.tradeValue, item.price, imageUrl, item.condition, item.card_set], (err) => {
              if (err) reject(err);
              else resolve();
            });
        } else if (item.role === 'sold' || item.role === 'trade_out') {
          db.get('SELECT image_url, condition, card_set FROM collectibles WHERE id = ?', [item.id], (err, row) => {
            if (err) return reject(err);
            const imageUrl = row ? row.image_url : item.image_url;
            const condition = row ? row.condition : item.condition;
            const cardSet = row ? row.card_set : item.card_set;
            db.run('INSERT INTO transaction_items (transaction_id, item_id, name, role, negotiated_price, original_price, image_url, condition, card_set) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [txId, item.id, item.name, item.role, item.negotiatedPrice, item.price, imageUrl, condition, cardSet], (err) => {
                if (err) reject(err);
                else resolve();
              });
          });
        }
      }));
      // Update stock and confirm transaction
      Promise.all(itemInserts)
        .then(() => {
          db.run('UPDATE collectibles SET stock = stock - 1 WHERE id IN (SELECT item_id FROM transaction_items WHERE transaction_id = ? AND role IN ("sold", "trade_out"))', [txId], (err) => {
            if (err) console.error('Error updating stock:', err);
            event.reply('transaction-complete', { txId, type });
          });
        })
        .catch(err => event.reply('transaction-error', err.message));
    }
  );
});

// Fetch inventory items available for Sell/Trade-Out (stock > 0)
ipcMain.on('get-inventory', (event, { page = 1, limit = 50, search = '' } = {}) => {
  const offset = (page - 1) * limit;
  const query = `
    SELECT * FROM collectibles 
    WHERE stock > 0 
    AND (name LIKE ? OR card_set LIKE ?) 
    ORDER BY name 
    LIMIT ? OFFSET ?
  `;
  const params = [`%${search}%`, `%${search}%`, limit, offset];
  
  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('Get inventory error:', err);
      event.reply('inventory-data', { items: [], total: 0 });
      return;
    }
    db.get('SELECT COUNT(*) as total FROM collectibles WHERE stock > 0 AND (name LIKE ? OR card_set LIKE ?)', [`%${search}%`, `%${search}%`], (err, countResult) => {
      if (err) {
        console.error('Get inventory count error:', err);
        event.reply('inventory-data', { items: rows, total: 0 });
      } else {
        event.reply('inventory-data', { items: rows, total: countResult.total });
      }
    });
  });
});

// Fetch all inventory items (including stock = 0) for Inventory tab
ipcMain.on('get-all-inventory', (event, { page = 1, limit = 50, search = '' } = {}) => {
  const offset = (page - 1) * limit;
  const query = `
    SELECT * FROM collectibles 
    WHERE name LIKE ? OR card_set LIKE ? 
    ORDER BY name 
    LIMIT ? OFFSET ?
  `;
  const params = [`%${search}%`, `%${search}%`, limit, offset];
  
  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('Get all inventory error:', err);
      event.reply('all-inventory-data', { items: [], total: 0 });
      return;
    }
    db.get('SELECT COUNT(*) as total FROM collectibles WHERE name LIKE ? OR card_set LIKE ?', [`%${search}%`, `%${search}%`], (err, countResult) => {
      if (err) {
        console.error('Get all inventory count error:', err);
        event.reply('all-inventory-data', { items: rows, total: 0 });
      } else {
        console.log('All inventory fetched:', rows.length);
        event.reply('all-inventory-data', { items: rows, total: countResult.total });
      }
    });
  });
});

// Update an existing inventory item’s details
ipcMain.on('update-inventory-item', (event, item) => {
  db.run('UPDATE collectibles SET name = ?, price = ?, condition = ?, card_set = ?, rarity = ? WHERE id = ?',
    [item.name, item.price, item.condition, item.card_set, item.rarity, item.id],
    (err) => {
      if (err) {
        console.error('Update inventory item error:', err);
        event.reply('update-inventory-error', err.message);
      } else {
        console.log('Inventory item updated:', item.id);
        event.reply('update-inventory-success', item);
      }
    }
  );
});

// Fetch transaction data for Transactions tab display
ipcMain.on('get-transactions', (event) => {
  db.all(`
    SELECT 
      t.id AS transaction_id, 
      t.type AS transaction_type, 
      t.cash_in, 
      t.cash_out, 
      t.timestamp,
      ti.item_id, 
      ti.name AS item_name, 
      ti.role, 
      ti.trade_value, 
      ti.negotiated_price, 
      ti.original_price, 
      ti.image_url, 
      ti.condition, 
      ti.card_set
    FROM transactions t
    LEFT JOIN transaction_items ti ON t.id = ti.transaction_id
  `, (err, rows) => {
    if (err) {
      console.error('Error fetching transactions:', err);
      event.sender.send('transactions-error', err);
    } else {
      console.log('Transactions fetched:', rows.length);
      event.sender.send('transactions-data', rows);
    }
  });
});

// Fetch cash totals for Reports tab reconciliation
ipcMain.on('get-cash-totals', (event, { startDate = '', endDate = '' } = {}) => {
  let query = 'SELECT SUM(cash_in) AS total_cash_in, SUM(cash_out) AS total_cash_out FROM transactions';
  let params = [];
  if (startDate || endDate) {
    query += ' WHERE';
    if (startDate) {
      query += ' timestamp >= ?';
      params.push(startDate);
    }
    if (endDate) {
      query += startDate ? ' AND timestamp <= ?' : ' timestamp <= ?';
      params.push(endDate);
    }
  }
  db.get(query, params, (err, row) => {
    if (err) {
      console.error('Error fetching cash totals:', err);
      event.reply('cash-totals-error', err.message);
    } else {
      console.log('Cash totals fetched:', row);
      event.reply('cash-totals-data', {
        total_cash_in: row.total_cash_in || 0,
        total_cash_out: row.total_cash_out || 0
      });
    }
  });
});

// Save a cash reconciliation record in Reports tab
ipcMain.on('save-reconciliation', (event, reconciliation) => {
  const id = Date.now().toString();
  db.run('INSERT INTO cash_reconciliations (id, date, starting_cash, total_cash_in, total_cash_out, expected_cash, actual_cash, discrepancy, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, reconciliation.date, reconciliation.starting_cash, reconciliation.total_cash_in, reconciliation.total_cash_out, reconciliation.expected_cash, reconciliation.actual_cash, reconciliation.discrepancy, reconciliation.notes],
    (err) => {
      if (err) {
        console.error('Error saving reconciliation:', err);
        event.reply('reconciliation-error', err.message);
      } else {
        console.log('Reconciliation saved:', id);
        event.reply('reconciliation-success', { id, ...reconciliation });
      }
    }
  );
});

// Fetch TCG card data from API or DB for Buy/Trade-In
ipcMain.on('get-tcg-card', (event, cardName) => {
  console.log('Fetching TCG card:', cardName);
  const options = {
    method: 'GET',
    url: 'https://api.pokemontcg.io/v2/cards',
    headers: { 'X-Api-Key': process.env.TCG_API_KEY || 'your-api-key-here' },
    params: { q: `name:${cardName}` }
  };

  axios.request(options)
    .then(response => {
      const cards = response.data.data.map(card => ({
        tcg_id: card.id,
        name: card.name,
        type: card.supertype.toLowerCase() === 'pokémon' ? 'pokemon_card' : card.supertype,
        price: card.cardmarket?.prices?.averageSellPrice || 0,
        tradeValue: card.cardmarket?.prices?.averageSellPrice * 0.5 || 0,
        image_url: card.images.small,
        card_set: card.set.name,
        rarity: card.rarity
      }));
      console.log('API returned:', cards.length, 'cards');
      event.reply('tcg-card-data', cards);
    })
    .catch(err => {
      console.error('TCG API error, falling back to DB:', err.message);
      db.all('SELECT * FROM collectibles WHERE name LIKE ?', [`%${cardName}%`], (dbErr, rows) => {
        if (dbErr) {
          console.error('Database error:', dbErr);
          event.reply('tcg-card-error', dbErr);
          return;
        }
        console.log('Found in DB:', rows.length, 'matches');
        event.reply('tcg-card-data', rows.map(row => ({
          tcg_id: row.tcg_id,
          name: row.name,
          type: row.type,
          price: row.price,
          tradeValue: row.trade_value,
          image_url: row.image_url,
          card_set: row.card_set,
          rarity: row.rarity
        })));
      });
    });
});