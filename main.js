require('dotenv').config();
const { app, BrowserWindow, ipcMain, net, shell } = require('electron');
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

// Cache for exchange rates
let cachedExchangeRates = { USD_TO_GBP: 0.79, EUR_TO_GBP: 0.85 }; // Fallback defaults
let lastFetched = 0;
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour in milliseconds

// Fetch exchange rates from ExchangeRate-API
async function getExchangeRates() {
  const now = Date.now();
  if (now - lastFetched < CACHE_DURATION) {
    console.log('Using cached exchange rates:', cachedExchangeRates);
    return cachedExchangeRates; // Return cached rates if not expired
  }

  try {
    const response = await axios.get('https://v6.exchangerate-api.com/v6/' + process.env.EXCHANGERATE_API_KEY + '/latest/GBP');
    const rates = response.data.conversion_rates;
    console.log('Fetched fresh exchange rates:', rates);
    cachedExchangeRates = {
      USD_TO_GBP: 1 / rates.USD, // Invert for USD → GBP
      EUR_TO_GBP: 1 / rates.EUR  // Invert for EUR → GBP
    };
    lastFetched = now;
    return cachedExchangeRates;
  } catch (err) {
    console.error('Exchange rate fetch error:', err.message);
    return cachedExchangeRates; // Return cached (or fallback) on error
  }
}

// Initialize database tables on app start
db.serialize(() => {
  // Create generic items table (replacing collectibles)
  db.run('CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, type TEXT, name TEXT, price REAL, stock INTEGER, image_url TEXT, condition TEXT)', (err) => {
    if (err) console.error('Error creating items table:', err);
    else console.log('Items table created or already exists');
  });
  // Create table for type-specific attributes
  db.run('CREATE TABLE IF NOT EXISTS item_attributes (item_id TEXT, key TEXT, value TEXT, PRIMARY KEY (item_id, key))', (err) => {
    if (err) console.error('Error creating item_attributes table:', err);
    else console.log('Item_attributes table created');
  });
  // Create table for transaction records (buy/sell/trade)
  db.run('CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, type TEXT, cash_in REAL, cash_out REAL, timestamp TEXT)', (err) => {
    if (err) console.error('Error creating transactions table:', err);
    else console.log('Transactions table created or already exists');
  });
  // Create table for items within transactions (links items to transactions)
  db.run('CREATE TABLE IF NOT EXISTS transaction_items (id INTEGER PRIMARY KEY AUTOINCREMENT, transaction_id TEXT, item_id TEXT, name TEXT, role TEXT, trade_value REAL, negotiated_price REAL, original_price REAL, image_url TEXT, condition TEXT, type TEXT, attributes TEXT)', (err) => {
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

// Handle adding a new item to inventory (e.g., during Buy/Trade-In)
ipcMain.on('add-item', async (event, item) => {
  let imageUrl = null;

  // Download image if provided and not already a file URL
  if (item.image_url && !item.image_url.startsWith('file://')) {
    imageUrl = path.join(__dirname, 'images', `${item.id}-${item.tcg_id || 'item'}.png`);
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
  
  // Add item to items table if it’s a trade-in (bought item)
  if (item.role === 'trade_in') {
    db.run('INSERT INTO items (id, type, name, price, stock, image_url, condition) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [item.id, item.type || 'pokemon_tcg', item.name, item.price, 1, finalItem.image_url, item.condition || null],
      (err) => {
        if (err) {
          console.error('Add item error:', err);
          event.reply('add-item-error', err.message);
        } else {
          // Add all type-specific attributes from item.attributes
          if (item.attributes && Object.keys(item.attributes).length > 0) {
            const attributeInserts = Object.entries(item.attributes).map(([key, value]) => 
              new Promise((resolve, reject) => {
                db.run('INSERT OR IGNORE INTO item_attributes (item_id, key, value) VALUES (?, ?, ?)',
                  [item.id, key, value], (err) => {
                    if (err) reject(err);
                    else resolve();
                  });
              })
            );
            Promise.all(attributeInserts)
              .then(() => {
                console.log('Item and attributes added to DB:', finalItem);
                event.reply('add-item-success', finalItem);
              })
              .catch(err => {
                console.error('Error adding attributes:', err);
                event.reply('add-item-error', err.message);
              });
          } else {
            console.log('Item added to DB (no attributes):', finalItem);
            event.reply('add-item-success', finalItem);
          }
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
      // Record each item in the transaction with attributes
      const itemInserts = items.map(item => new Promise((resolve, reject) => {
        const attributesJson = JSON.stringify(item.attributes || {});
        if (item.role === 'trade_in') {
          const imageUrl = item.image_url && !item.image_url.startsWith('file://') 
            ? `file://${path.join(__dirname, 'images', `${item.id}-${item.tcg_id || 'item'}.png`)}` 
            : item.image_url;
          db.run('INSERT INTO transaction_items (transaction_id, item_id, name, role, trade_value, original_price, image_url, condition, type, attributes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [txId, item.id, item.name, item.role, item.tradeValue, item.price, imageUrl, item.condition, item.type, attributesJson], (err) => {
              if (err) reject(err);
              else resolve();
            });
        } else if (item.role === 'sold' || item.role === 'trade_out') {
          db.get('SELECT image_url, condition, type FROM items WHERE id = ?', [item.id], (err, row) => {
            if (err) return reject(err);
            const imageUrl = row ? row.image_url : item.image_url;
            const condition = row ? row.condition : item.condition;
            const itemType = row ? row.type : item.type;
            db.run('INSERT INTO transaction_items (transaction_id, item_id, name, role, negotiated_price, original_price, image_url, condition, type, attributes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [txId, item.id, item.name, item.role, item.negotiatedPrice, item.price, imageUrl, condition, itemType, attributesJson], (err) => {
                if (err) reject(err);
                else resolve();
              });
          });
        }
      }));
      // Update stock and confirm transaction
      Promise.all(itemInserts)
        .then(() => {
          db.run('UPDATE items SET stock = stock - 1 WHERE id IN (SELECT item_id FROM transaction_items WHERE transaction_id = ? AND role IN ("sold", "trade_out"))', [txId], (err) => {
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
    SELECT i.*, GROUP_CONCAT(a.key || ':' || a.value) as attributes 
    FROM items i 
    LEFT JOIN item_attributes a ON i.id = a.item_id
    WHERE i.stock > 0 
    AND (i.name LIKE ? OR EXISTS (SELECT 1 FROM item_attributes WHERE item_id = i.id AND value LIKE ?))
    GROUP BY i.id
    ORDER BY i.name 
    LIMIT ? OFFSET ?
  `;
  const params = [`%${search}%`, `%${search}%`, limit, offset];
  
  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('Get inventory error:', err);
      event.reply('inventory-data', { items: [], total: 0 });
      return;
    }
    const formattedRows = rows.map(row => ({
      ...row,
      attributes: row.attributes ? Object.fromEntries(row.attributes.split(',').map(attr => attr.split(':'))) : {}
    }));
    db.get('SELECT COUNT(*) as total FROM items WHERE stock > 0 AND (name LIKE ? OR EXISTS (SELECT 1 FROM item_attributes WHERE item_id = items.id AND value LIKE ?))', [`%${search}%`, `%${search}%`], (err, countResult) => {
      if (err) {
        console.error('Get inventory count error:', err);
        event.reply('inventory-data', { items: formattedRows, total: 0 });
      } else {
        event.reply('inventory-data', { items: formattedRows, total: countResult.total });
      }
    });
  });
});

// Fetch all inventory items (including stock = 0) for Inventory tab
ipcMain.on('get-all-inventory', (event, { page = 1, limit = 50, search = '' } = {}) => {
  const offset = (page - 1) * limit;
  const query = `
    SELECT i.*, GROUP_CONCAT(a.key || ':' || a.value) as attributes 
    FROM items i 
    LEFT JOIN item_attributes a ON i.id = a.item_id
    WHERE i.name LIKE ? OR EXISTS (SELECT 1 FROM item_attributes WHERE item_id = i.id AND value LIKE ?)
    GROUP BY i.id
    ORDER BY i.name 
    LIMIT ? OFFSET ?
  `;
  const params = [`%${search}%`, `%${search}%`, limit, offset];
  
  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('Get all inventory error:', err);
      event.reply('all-inventory-data', { items: [], total: 0 });
      return;
    }
    const formattedRows = rows.map(row => ({
      ...row,
      attributes: row.attributes ? Object.fromEntries(row.attributes.split(',').map(attr => attr.split(':'))) : {}
    }));
    db.get('SELECT COUNT(*) as total FROM items WHERE name LIKE ? OR EXISTS (SELECT 1 FROM item_attributes WHERE item_id = items.id AND value LIKE ?)', [`%${search}%`, `%${search}%`], (err, countResult) => {
      if (err) {
        console.error('Get all inventory count error:', err);
        event.reply('all-inventory-data', { items: formattedRows, total: 0 });
      } else {
        console.log('All inventory fetched:', formattedRows.length);
        event.reply('all-inventory-data', { items: formattedRows, total: countResult.total });
      }
    });
  });
});

// Update an existing inventory item’s details
ipcMain.on('update-inventory-item', (event, item) => {
  db.run('UPDATE items SET name = ?, price = ?, condition = ? WHERE id = ?',
    [item.name, item.price, item.condition, item.id],
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

// Update an inventory item’s attributes
ipcMain.on('update-item-attributes', (event, { item_id, attributes }) => {
  // Delete existing attributes for this item
  db.run('DELETE FROM item_attributes WHERE item_id = ?', [item_id], (err) => {
    if (err) {
      console.error('Error deleting old attributes:', err);
      event.reply('update-attributes-error', err.message);
      return;
    }
    // Insert new attributes
    const attributeInserts = Object.entries(attributes).map(([key, value]) => 
      new Promise((resolve, reject) => {
        db.run('INSERT INTO item_attributes (item_id, key, value) VALUES (?, ?, ?)',
          [item_id, key, value], (err) => {
            if (err) reject(err);
            else resolve();
          });
      })
    );
    Promise.all(attributeInserts)
      .then(() => {
        console.log('Attributes updated for item:', item_id);
        event.reply('update-attributes-success', { item_id, attributes });
      })
      .catch(err => {
        console.error('Error updating attributes:', err);
        event.reply('update-attributes-error', err.message);
      });
  });
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
      ti.type,
      ti.attributes
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

// Fetch all cash reconciliation records for Reports tab display
ipcMain.on('get-reconciliations', (event) => {
  db.all('SELECT * FROM cash_reconciliations ORDER BY date DESC', (err, rows) => {
    if (err) {
      console.error('Error fetching reconciliations:', err);
      event.reply('reconciliations-error', err.message);
    } else {
      console.log('Reconciliations fetched:', rows.length);
      event.reply('reconciliations-data', rows);
    }
  });
});

// Fetch all Pokémon TCG cards with detailed pricing
ipcMain.on('get-tcg-card', async (event, name) => {
  try {
    let allCards = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await axios.get('https://api.pokemontcg.io/v2/cards', {
        params: { q: `name:${name}`, page: page, pageSize: 250 },
        headers: { 'X-Api-Key': process.env.POKEMON_TCG_API_KEY }
      });
      const cards = response.data.data;
      allCards = allCards.concat(cards);
      const totalCount = response.data.totalCount || 0;
      hasMore = allCards.length < totalCount && cards.length > 0;
      page++;
    }

    const exchangeRates = await getExchangeRates();

    const filteredCards = allCards.map(card => {
      const tcgPrices = card.tcgplayer?.prices || {};
      const cmPrices = card.cardmarket?.prices || {};
      return {
        id: card.id,
        name: card.name,
        type: 'pokemon_tcg',
        image_url: card.images.large, // Return raw URL, no caching here
        tcg_id: card.id,
        card_set: card.set.name,
        rarity: card.rarity,
        prices: {
          tcgplayer: Object.keys(tcgPrices).reduce((acc, rarity) => {
            const rarityPrices = tcgPrices[rarity];
            acc[rarity] = {
              market: rarityPrices.market || 0,
              market_gbp: (rarityPrices.market || 0) * exchangeRates.USD_TO_GBP,
              low: rarityPrices.low || 0,
              low_gbp: (rarityPrices.low || 0) * exchangeRates.USD_TO_GBP
            };
            return acc;
          }, {}),
          cardmarket: {
            average: cmPrices.averageSellPrice || 0,
            average_gbp: (cmPrices.averageSellPrice || 0) * exchangeRates.EUR_TO_GBP,
            trend: cmPrices.trendPrice || 0,
            trend_gbp: (cmPrices.trendPrice || 0) * exchangeRates.EUR_TO_GBP
          }
        }
      };
    });

    console.log('Fetched TCG card data:', filteredCards);
    event.reply('tcg-card-data', filteredCards);
  } catch (err) {
    console.error('Pokémon TCG fetch error:', err.message);
    event.reply('tcg-card-error', err.message);
  }
});

// Fetch video game data from Giant Bomb API
ipcMain.on('get-game-data', async (event, { name, platform }) => {
  try {
    const response = await axios({
      method: 'GET',
      url: 'https://www.giantbomb.com/api/search/',
      params: {
        api_key: process.env.GIANTBOMB_API_KEY,
        format: 'json',
        query: name,
        resources: 'game',
        limit: 100, // Get multiple results for selection
        field_list: 'id,name,platforms,original_release_date,deck,image,genres'
      }
    });

    const games = response.data.results.map(game => {
      const imageUrl = game.image && game.image.medium_url ? game.image.medium_url : null;
      const matchedPlatform = platform && game.platforms && game.platforms.some(p => p.abbreviation === platform) 
        ? platform 
        : game.platforms?.map(p => p.abbreviation).join(', ') || 'Multiple';
      return {
        id: game.id.toString(),
        name: game.name,
        type: 'video_game',
        price: 0, // Giant Bomb doesn’t provide price; default to 0, user can adjust
        tradeValue: 0, // Same—user can set this
        image_url: imageUrl,
        platform: matchedPlatform,
        release_date: game.original_release_date || null,
        description: game.deck || null,
        genres: game.genres ? game.genres.map(g => g.name).join(', ') : null
      };
    });

    if (games.length > 0 && games[0].image_url) {
      const cacheDir = path.join(__dirname, 'images', 'cache');
      const cacheFileName = `video_game_${games[0].name.replace(/\s+/g, '_')}_${platform ? platform.replace(/\s+/g, '_') : 'default'}.png`;
      const cachePath = path.join(cacheDir, cacheFileName);

      if (!fs.existsSync(cachePath)) {
        const imageResponse = await axios({
          method: 'GET',
          url: games[0].image_url,
          responseType: 'arraybuffer'
        });
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(cachePath, Buffer.from(imageResponse.data));
        console.log('Image downloaded and cached:', cachePath);
      }
      games[0].image_url = `file://${cachePath}`;
    }

    console.log('Fetched game data:', games);
    event.reply('game-data', games);
  } catch (err) {
    console.error('Giant Bomb game fetch error:', err.message);
    event.reply('game-data-error', err.message);
  }
});

ipcMain.on('generate-receipt', (event, transaction) => {
  const { id, type, cash_in, cash_out, timestamp, items } = transaction;
  const receiptDir = path.join(__dirname, 'receipts');
  fs.mkdirSync(receiptDir, { recursive: true });
  const receiptFile = path.join(receiptDir, `${id}-receipt.txt`);

  const cashDue = type === 'trade' ? Math.max(cash_in - cash_out, 0) : 0;
  const cashBack = type === 'trade' ? Math.max(cash_out - cash_in, 0) : 0;

  // Customize item lines based on transaction type
  const itemLines = items.map(item => {
    if (type === 'buy') {
      return `  - ${item.name} (${item.type}) | Trade Value: £${(item.trade_value || 0).toFixed(2)} | Condition: ${item.condition || 'Not Set'}`;
    } else if (type === 'sell') {
      const price = item.negotiated_price || item.original_price || 0;
      return `  - ${item.name} (${item.type}) | Price: £${price.toFixed(2)} | Condition: ${item.condition || 'Not Set'}`;
    } else if (type === 'trade') {
      if (item.role === 'trade_in') {
        return `  - ${item.name} (${item.type}) | Trade Value: £${(item.trade_value || 0).toFixed(2)} | Condition: ${item.condition || 'Not Set'} (Trade-In)`;
      } else if (item.role === 'trade_out') {
        const price = item.negotiated_price || item.original_price || 0;
        return `  - ${item.name} (${item.type}) | Price: £${price.toFixed(2)} | Condition: ${item.condition || 'Not Set'} (Trade-Out)`;
      }
    }
  }).join('\n');

  const receiptContent = `
    Collectibles POS Receipt
    -----------------------
    Transaction ID: ${id}
    Type: ${type}
    Date: ${new Date(timestamp).toLocaleString()}
    Items:
    ${itemLines}
    Price Paid by Customer: £${cash_in.toFixed(2)}
    Price Paid by Store: £${cash_out.toFixed(2)}
    ${type === 'trade' ? `Cash Due To Store: £${cashDue.toFixed(2)}\nCash Back To Customer: £${cashBack.toFixed(2)}` : ''}
    -----------------------
  `;

  fs.writeFileSync(receiptFile, receiptContent.trim());
  console.log('Receipt generated:', receiptFile);

  shell.openPath(receiptFile);
  event.reply('receipt-generated', receiptFile);
});