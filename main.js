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

db.serialize(() => {
  db.run('CREATE TABLE IF NOT EXISTS collectibles (id TEXT PRIMARY KEY, type TEXT, name TEXT, price REAL, stock INTEGER, image_url TEXT, tcg_id TEXT, card_set TEXT, rarity TEXT, condition TEXT)', (err) => {
    if (err) console.error('Error creating collectibles table:', err);
    else console.log('Collectibles table created or already exists');
  });
  db.run('CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, type TEXT, cash_in REAL, cash_out REAL, timestamp TEXT)', (err) => {
    if (err) console.error('Error creating transactions table:', err);
    else console.log('Transactions table created or already exists');
  });
  db.run('CREATE TABLE IF NOT EXISTS transaction_items (id INTEGER PRIMARY KEY AUTOINCREMENT, transaction_id TEXT, item_id TEXT, name TEXT, role TEXT, trade_value REAL, negotiated_price REAL, original_price REAL, image_url TEXT, condition TEXT, card_set TEXT)', (err) => {
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

ipcMain.on('add-item', async (event, item) => {
  let imageUrl = null;

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
            const imageUrl = row ? row.image_url : item.image_url; // Reuse collectibles image_url
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