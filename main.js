require('dotenv').config();
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.join(__dirname, 'inventory.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Failed to open database:', err);
  } else {
    console.log('Database opened successfully:', dbPath);
  }
});

db.serialize(() => {
  db.run('CREATE TABLE IF NOT EXISTS collectibles (id TEXT PRIMARY KEY, type TEXT, name TEXT, price REAL, stock INTEGER, image_url TEXT, tcg_id TEXT, card_set TEXT, rarity TEXT)', (err) => {
    if (err) console.error('Error creating collectibles table:', err);
    else console.log('Collectibles table created or already exists');
  });
  db.run('CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, type TEXT, cash_in REAL, cash_out REAL, timestamp TEXT)', (err) => {
    if (err) console.error('Error creating transactions table:', err);
    else console.log('Transactions table created or already exists');
  });
  db.run('CREATE TABLE IF NOT EXISTS transaction_items (id INTEGER PRIMARY KEY AUTOINCREMENT, transaction_id TEXT, item_id TEXT, role TEXT, trade_value REAL, negotiated_price REAL)', (err) => {
    if (err) console.error('Error creating transaction_items table:', err);
    else console.log('Transaction_items table created or already exists');
  });
});

let mainWindow;

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

ipcMain.on('add-item', (event, item) => {
  const imageUrl = item.imagePath ? path.join(__dirname, 'images', `${item.id}-${item.imageName}`) : null;
  if (item.imagePath) {
    try {
      fs.copyFileSync(item.imagePath, imageUrl);
      console.log('Image saved:', imageUrl);
    } catch (err) {
      console.error('Image copy error:', err);
      event.reply('add-item-error', err.message);
      return;
    }
  }
  const finalItem = { ...item, image_url: imageUrl ? `file://${imageUrl}` : null };
  if (item.role === 'trade_in') {
    db.run('INSERT INTO collectibles (id, type, name, price, stock, image_url, tcg_id, card_set, rarity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [item.id, item.type, item.name, item.price, 1, finalItem.image_url, item.tcg_id || null, item.card_set || null, item.rarity || null],
      (err) => {
        if (err) {
          console.error('Add item error:', err);
          event.reply('add-item-error', err.message);
        } else {
          event.reply('add-item-success', finalItem);
        }
      });
  } else {
    event.reply('add-item-success', finalItem);
  }
});

ipcMain.on('complete-transaction', (event, { items, type, cashIn, cashOut }) => {
  const txId = Date.now().toString();
  db.run('INSERT INTO transactions (id, type, cash_in, cash_out, timestamp) VALUES (?, ?, ?, ?, ?)',
    [txId, type, cashIn, cashOut, new Date().toISOString()],
    (err) => {
      if (err) {
        console.error('Transaction insert error:', err);
        return event.reply('transaction-error', err.message);
      }
      const itemInserts = items.map(item => new Promise((resolve, reject) => {
        if (item.role === 'trade_in') {
          db.run('INSERT INTO transaction_items (transaction_id, item_id, role, trade_value) VALUES (?, ?, ?, ?)',
            [txId, item.id, item.role, item.tradeValue], (err) => {
              if (err) reject(err);
              else resolve();
            });
        } else if (item.role === 'sold' || item.role === 'trade_out') {
          db.run('UPDATE collectibles SET stock = stock - 1 WHERE id = ?', [item.id], (err) => {
            if (err) return reject(err);
            db.run('INSERT INTO transaction_items (transaction_id, item_id, role, negotiated_price) VALUES (?, ?, ?, ?)',
              [txId, item.id, item.role, item.negotiatedPrice], resolve);
          });
        }
      }));
      Promise.all(itemInserts)
        .then(() => event.reply('transaction-complete', { txId, type }))
        .catch(err => event.reply('transaction-error', err.message));
    }
  );
});

ipcMain.on('get-inventory', (event) => {
  db.all('SELECT * FROM collectibles WHERE stock > 0', (err, rows) => {
    if (err) console.error('Get inventory error:', err);
    event.reply('inventory-data', rows || []);
  });
});

ipcMain.on('get-transactions', (event) => {
  db.all('SELECT t.*, ti.item_id, ti.role, ti.trade_value, ti.negotiated_price, c.name AS item_name, c.type, c.price AS original_price, c.image_url ' +
         'FROM transactions t ' +
         'LEFT JOIN transaction_items ti ON t.id = ti.transaction_id ' +
         'LEFT JOIN collectibles c ON ti.item_id = c.id', (err, rows) => {
    if (err) console.error('Get transactions error:', err);
    event.reply('transactions-data', rows || []);
  });
});

// Pokémon TCG API integration (raw fetch)
ipcMain.on('get-tcg-card', async (event, cardName) => {
  // Check if card is cached
  db.get('SELECT * FROM collectibles WHERE name = ? AND tcg_id IS NOT NULL', [cardName], async (err, row) => {
    if (err) {
      console.error('DB query error:', err);
      event.reply('tcg-card-error', err.message);
      return;
    }
    if (row) {
      console.log('Found cached TCG card:', row);
      event.reply('tcg-card-data', [{
        name: row.name,
        type: row.type,
        price: row.price,
        image_url: row.image_url,
        tcg_id: row.tcg_id,
        card_set: row.card_set || 'Unknown', // Updated to card_set
        rarity: row.rarity || 'Unknown'
      }]);
      return;
    }

    // Fetch online if not cached
    try {
      const url = `https://api.pokemontcg.io/v2/cards?q=name:*${encodeURIComponent(cardName.toLowerCase())}*`;
      console.log('Fetching from URL:', url);
      const response = await fetch(url, {
        headers: { 'X-Api-Key': process.env.POKEMONTCG_API_KEY }
      });
      if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
      const result = await response.json();
      console.log('API response:', result);
      if (!result.data || result.data.length === 0) throw new Error('No cards found');
      
      const cards = result.data.map(card => ({
        name: card.name,
        type: 'pokemon_card',
        price: card.tcgplayer?.prices?.holofoil?.market || card.tcgplayer?.prices?.normal?.market || 10,
        image_url: card.images.small,
        tcg_id: card.id,
        card_set: card.set.name, // Updated to card_set
        rarity: card.rarity || 'Unknown'
      }));
      console.log('Fetched TCG cards:', cards);

      // Cache all cards in DB
      cards.forEach(card => {
        db.run('INSERT OR IGNORE INTO collectibles (id, type, name, price, stock, image_url, tcg_id, card_set, rarity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [card.tcg_id, card.type, card.name, card.price, 0, card.image_url, card.tcg_id, card.card_set, card.rarity],
          (err) => {
            if (err) console.error('Cache insert error:', err);
          });
      });

      event.reply('tcg-card-data', cards);
    } catch (err) {
      console.error('TCG card fetch error:', err);
      event.reply('tcg-card-error', err.message);
    }
  });
});