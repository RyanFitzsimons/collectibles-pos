const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database(path.join(__dirname, 'inventory.db'));
db.serialize(() => {
  db.run('CREATE TABLE IF NOT EXISTS collectibles (id TEXT PRIMARY KEY, type TEXT, name TEXT, price REAL, stock INTEGER, image_url TEXT)');
  db.run('CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, type TEXT, cash_in REAL, cash_out REAL, timestamp TEXT)');
  db.run('CREATE TABLE IF NOT EXISTS transaction_items (id INTEGER PRIMARY KEY AUTOINCREMENT, transaction_id TEXT, item_id TEXT, role TEXT, trade_value REAL, negotiated_price REAL)');
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
    db.run('INSERT INTO collectibles (id, type, name, price, stock, image_url) VALUES (?, ?, ?, ?, ?, ?)',
      [item.id, item.type, item.name, item.price, 1, finalItem.image_url],
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