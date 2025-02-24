const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database(path.join(__dirname, 'inventory.db'));
db.serialize(() => {
  db.run('CREATE TABLE IF NOT EXISTS collectibles (id TEXT PRIMARY KEY, type TEXT, name TEXT, price REAL, stock INTEGER)');
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

ipcMain.on('complete-transaction', (event, { items, type, cashIn, cashOut }) => {
  const txId = Date.now().toString();
  db.run('INSERT INTO transactions (id, type, cash_in, cash_out, timestamp) VALUES (?, ?, ?, ?, ?)',
    [txId, type, cashIn, cashOut, new Date().toISOString()],
    (err) => {
      if (err) return console.error(err);
      items.forEach(item => {
        if (item.role === 'trade_in') {
          db.run('INSERT INTO collectibles (id, type, name, price, stock) VALUES (?, ?, ?, ?, ?)',
            [item.id, item.type, item.name, item.price, 1]);
        } else if (item.role === 'sold') {
          db.run('UPDATE collectibles SET stock = stock - 1 WHERE id = ?', [item.id]);
        }
        db.run('INSERT INTO transaction_items (transaction_id, item_id, role, trade_value, negotiated_price) VALUES (?, ?, ?, ?, ?)',
          [txId, item.id, item.role, item.tradeValue, item.negotiatedPrice]);
      });
      event.reply('transaction-complete', txId);
    }
  );
});

ipcMain.on('get-inventory', (event) => {
  db.all('SELECT * FROM collectibles WHERE stock > 0', (err, rows) => {
    event.reply('inventory-data', rows || []);
  });
});

ipcMain.on('get-transactions', (event) => {
  db.all('SELECT * FROM transactions', (err, rows) => {
    event.reply('transactions-data', rows || []);
  });
});