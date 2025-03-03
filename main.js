// Imports required modules for environment config, Electron, file operations, database, and HTTP requests
require('dotenv').config();  // Loads environment variables from .env file
const { app, BrowserWindow, ipcMain, net, shell } = require('electron');  // Electron modules for app, window, IPC, network, and shell operations
const path = require('path');  // Node module for handling file paths
const fs = require('fs');  // Node module for file system operations
const sqlite3 = require('sqlite3').verbose();  // SQLite3 module for database operations with verbose logging
const axios = require('axios');  // Library for making HTTP requests (e.g., API calls)

// Sets up the SQLite database path and connection
const dbPath = path.join(__dirname, 'inventory.db');  // Defines path to inventory database file
const db = new sqlite3.Database(dbPath, (err) => {  // Creates or opens database connection
  if (err) {
    console.error('Failed to open database:', err);  // Logs error if database fails to open
  } else {
    console.log('Database opened successfully:', dbPath);  // Logs success with database path
  }
});

// Cache for exchange rates to avoid frequent API calls
let cachedExchangeRates = { USD_TO_GBP: 0.79, EUR_TO_GBP: 0.85 };  // Default fallback exchange rates
let lastFetched = 0;  // Timestamp of last exchange rate fetch
const CACHE_DURATION = 60 * 60 * 1000;  // Cache duration set to 1 hour in milliseconds

// Fetches exchange rates from ExchangeRate-API
async function getExchangeRates() {
  const now = Date.now();  // Gets current timestamp
  if (now - lastFetched < CACHE_DURATION) {  // Checks if cache is still valid
    console.log('Using cached exchange rates:', cachedExchangeRates);  // Logs cache usage
    return cachedExchangeRates;  // Returns cached rates if not expired
  }

  try {
    const response = await axios.get('https://v6.exchangerate-api.com/v6/' + process.env.EXCHANGERATE_API_KEY + '/latest/GBP');  // Fetches rates from API with GBP base
    const rates = response.data.conversion_rates;  // Extracts conversion rates from response
    console.log('Fetched fresh exchange rates:', rates);  // Logs fetched rates
    cachedExchangeRates = {
      USD_TO_GBP: 1 / rates.USD,  // Inverts USD rate for USD → GBP conversion
      EUR_TO_GBP: 1 / rates.EUR   // Inverts EUR rate for EUR → GBP conversion
    };
    lastFetched = now;  // Updates last fetch timestamp
    return cachedExchangeRates;  // Returns fresh rates
  } catch (err) {
    console.error('Exchange rate fetch error:', err.message);  // Logs any fetch errors
    return cachedExchangeRates;  // Returns cached (or fallback) rates on error
  }
}

// Initializes database tables on app start
db.serialize(() => {  // Ensures database operations run sequentially
  // Creates items table for generic inventory items (replaces old collectibles table)
  db.run('CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, type TEXT, name TEXT, price REAL, stock INTEGER, image_url TEXT, condition TEXT)', (err) => {
    if (err) console.error('Error creating items table:', err);  // Logs error if table creation fails
    else console.log('Items table created or already exists');  // Confirms table setup
  });
  // Creates table for type-specific item attributes
  db.run('CREATE TABLE IF NOT EXISTS item_attributes (item_id TEXT, key TEXT, value TEXT, PRIMARY KEY (item_id, key))', (err) => {
    if (err) console.error('Error creating item_attributes table:', err);  // Logs error if table creation fails
    else console.log('Item_attributes table created');  // Confirms table setup
  });
  // Creates table for transaction records (buy, sell, trade)
  db.run('CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, type TEXT, cash_in REAL, cash_out REAL, timestamp TEXT)', (err) => {
    if (err) console.error('Error creating transactions table:', err);  // Logs error if table creation fails
    else console.log('Transactions table created or already exists');  // Confirms table setup
  });
  // Creates table for items within transactions (links items to transactions)
  db.run('CREATE TABLE IF NOT EXISTS transaction_items (id INTEGER PRIMARY KEY AUTOINCREMENT, transaction_id TEXT, item_id TEXT, name TEXT, role TEXT, trade_value REAL, negotiated_price REAL, original_price REAL, image_url TEXT, condition TEXT, type TEXT, attributes TEXT)', (err) => {
    if (err) console.error('Error creating transaction_items table:', err);  // Logs error if table creation fails
    else console.log('Transaction_items table created or already exists');  // Confirms table setup
  });
  // Creates table for cash reconciliation records
  db.run('CREATE TABLE IF NOT EXISTS cash_reconciliations (id TEXT PRIMARY KEY, date TEXT, starting_cash REAL, total_cash_in REAL, total_cash_out REAL, expected_cash REAL, actual_cash REAL, discrepancy REAL, notes TEXT)', (err) => {
    if (err) console.error('Error creating cash_reconciliations table:', err);  // Logs error if table creation fails
    else console.log('Cash_reconciliations table created or already exists');  // Confirms table setup
  });
});

let mainWindow;  // Variable to hold the main application window instance

// Sets up the main application window
function createWindow() {
  mainWindow = new BrowserWindow({  // Creates a new BrowserWindow instance
    width: 1000,  // Sets window width to 1000 pixels
    height: 800,  // Sets window height to 800 pixels
    webPreferences: {
      nodeIntegration: true,  // Enables Node.js integration in renderer process
      contextIsolation: false  // Disables context isolation for direct Node access
    }
  });
  mainWindow.loadFile('index.html');  // Loads the main HTML file into the window
}

// Initializes app when Electron is ready
app.whenReady().then(() => {
  createWindow();  // Creates the main window
  app.on('activate', () => {  // Handles app activation (e.g., clicking dock icon on macOS)
    if (BrowserWindow.getAllWindows().length === 0) createWindow();  // Creates window if none exist
  });
});

// Quits app when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();  // Quits app on non-macOS platforms
});

// Handles adding a new item to inventory (e.g., during Buy or Trade-In)
ipcMain.on('add-item', async (event, item) => {
  let imageUrl = null;  // Variable to store the final image URL

  // Downloads and caches image if provided and not already a file URL
  if (item.image_url && !item.image_url.startsWith('file://')) {
    imageUrl = path.join(__dirname, 'images', `${item.id}-${item.tcg_id || 'item'}.png`);  // Constructs local image path
    try {
      await new Promise((resolve, reject) => {  // Wraps image download in a Promise
        const request = net.request(item.image_url);  // Initiates HTTP request for image
        request.on('response', (response) => {
          if (response.statusCode !== 200) {  // Checks for successful response
            reject(new Error(`Failed to fetch image: ${response.statusCode}`));
            return;
          }
          const chunks = [];  // Array to collect response data chunks
          response.on('data', (chunk) => chunks.push(chunk));  // Collects data chunks
          response.on('end', () => {
            fs.mkdirSync(path.join(__dirname, 'images'), { recursive: true });  // Creates images directory if needed
            const buffer = Buffer.concat(chunks);  // Combines chunks into a single buffer
            fs.writeFileSync(imageUrl, buffer);  // Writes image to disk
            console.log('Image downloaded and saved:', imageUrl);  // Logs successful save
            resolve();  // Resolves the Promise
          });
          response.on('error', reject);  // Rejects on response error
        });
        request.on('error', reject);  // Rejects on request error
        request.end();  // Ends the request
      });
    } catch (err) {
      console.error('Image download error:', err);  // Logs download error
      event.reply('add-item-error', err.message);  // Sends error to renderer
      return;
    }
  }

  const finalItem = {  // Constructs final item object with updated image URL
    ...item,  // Spreads original item properties
    image_url: imageUrl ? `file://${imageUrl}` : item.image_url  // Sets local file URL or keeps original
  };
  
  // Adds item to items table if it’s a trade-in (bought item)
  if (item.role === 'trade_in') {
    db.run('INSERT INTO items (id, type, name, price, stock, image_url, condition) VALUES (?, ?, ?, ?, ?, ?, ?)', 
      [item.id, item.type || 'pokemon_tcg', item.name, item.price, 1, finalItem.image_url, item.condition || null],  // Inserts item with stock set to 1
      (err) => {
        if (err) {
          console.error('Add item error:', err);  // Logs insertion error
          event.reply('add-item-error', err.message);  // Sends error to renderer
        } else {
          // Adds type-specific attributes if present
          if (item.attributes && Object.keys(item.attributes).length > 0) {
            const attributeInserts = Object.entries(item.attributes).map(([key, value]) => 
              new Promise((resolve, reject) => {
                db.run('INSERT OR IGNORE INTO item_attributes (item_id, key, value) VALUES (?, ?, ?)', 
                  [item.id, key, value], (err) => {  // Inserts attribute, skips duplicates
                    if (err) reject(err);
                    else resolve();
                  });
              })
            );
            Promise.all(attributeInserts)  // Waits for all attribute inserts to complete
              .then(() => {
                console.log('Item and attributes added to DB:', finalItem);  // Logs successful addition
                event.reply('add-item-success', finalItem);  // Sends success to renderer
              })
              .catch(err => {
                console.error('Error adding attributes:', err);  // Logs attribute insertion error
                event.reply('add-item-error', err.message);  // Sends error to renderer
              });
          } else {
            console.log('Item added to DB (no attributes):', finalItem);  // Logs success without attributes
            event.reply('add-item-success', finalItem);  // Sends success to renderer
          }
        }
      });
  } else {
    event.reply('add-item-success', finalItem);  // Sends success for non-trade-in items (e.g., trade-out/sell)
  }
});

// Processes a completed transaction (Buy, Sell, Trade)
ipcMain.on('complete-transaction', (event, { items, type, cashIn, cashOut }) => {
  const txId = Date.now().toString();  // Generates unique transaction ID based on timestamp
  // Records transaction header in transactions table
  db.run('INSERT INTO transactions (id, type, cash_in, cash_out, timestamp) VALUES (?, ?, ?, ?, ?)', 
    [txId, type, cashIn, cashOut, new Date().toISOString()],  // Inserts transaction with current timestamp
    (err) => {
      if (err) {
        console.error('Transaction insert error:', err);  // Logs insertion error
        return event.reply('transaction-error', err.message);  // Sends error to renderer
      }
      // Records each item in the transaction with attributes
      const itemInserts = items.map(item => new Promise((resolve, reject) => {
        const attributesJson = JSON.stringify(item.attributes || {});  // Converts attributes to JSON string
        if (item.role === 'trade_in') {  // Handles trade-in items
          const imageUrl = item.image_url && !item.image_url.startsWith('file://') 
            ? `file://${path.join(__dirname, 'images', `${item.id}-${item.tcg_id || 'item'}.png`)}` 
            : item.image_url;  // Uses cached URL or original
          db.run('INSERT INTO transaction_items (transaction_id, item_id, name, role, trade_value, original_price, image_url, condition, type, attributes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', 
            [txId, item.id, item.name, item.role, item.tradeValue, item.price, imageUrl, item.condition, item.type, attributesJson], (err) => {
              if (err) reject(err);
              else resolve();
            });
        } else if (item.role === 'sold' || item.role === 'trade_out') {  // Handles sold or trade-out items
          db.get('SELECT image_url, condition, type FROM items WHERE id = ?', [item.id], (err, row) => {  // Fetches existing item data
            if (err) return reject(err);
            const imageUrl = row ? row.image_url : item.image_url;  // Uses stored URL if available
            const condition = row ? row.condition : item.condition;  // Uses stored condition if available
            const itemType = row ? row.type : item.type;  // Uses stored type if available
            db.run('INSERT INTO transaction_items (transaction_id, item_id, name, role, negotiated_price, original_price, image_url, condition, type, attributes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', 
              [txId, item.id, item.name, item.role, item.negotiatedPrice, item.price, imageUrl, condition, itemType, attributesJson], (err) => {
                if (err) reject(err);
                else resolve();
              });
          });
        }
      }));
      // Updates stock and confirms transaction
      Promise.all(itemInserts)  // Waits for all item inserts to complete
        .then(() => {
          db.run('UPDATE items SET stock = stock - 1 WHERE id IN (SELECT item_id FROM transaction_items WHERE transaction_id = ? AND role IN ("sold", "trade_out"))', [txId], (err) => {  // Decrements stock for sold/trade-out items
            if (err) console.error('Error updating stock:', err);  // Logs stock update error (no reply to renderer)
            event.reply('transaction-complete', { txId, type });  // Sends success to renderer
          });
        })
        .catch(err => event.reply('transaction-error', err.message));  // Sends error to renderer if any insert fails
    }
  );
});

// Fetches inventory items available for Sell/Trade-Out (stock > 0)
ipcMain.on('get-inventory', (event, { page = 1, limit = 50, search = '' } = {}) => {
  const offset = (page - 1) * limit;  // Calculates offset for pagination
  const query = `
    SELECT i.*, GROUP_CONCAT(a.key || ':' || a.value) as attributes 
    FROM items i 
    LEFT JOIN item_attributes a ON i.id = a.item_id
    WHERE i.stock > 0 
    AND (i.name LIKE ? OR EXISTS (SELECT 1 FROM item_attributes WHERE item_id = i.id AND value LIKE ?))
    GROUP BY i.id
    ORDER BY i.name 
    LIMIT ? OFFSET ?
  `;  // SQL query to fetch items with stock > 0, supporting search
  const params = [`%${search}%`, `%${search}%`, limit, offset];  // Parameters for query with wildcard search
  
  db.all(query, params, (err, rows) => {  // Executes query to fetch items
    if (err) {
      console.error('Get inventory error:', err);  // Logs query error
      event.reply('inventory-data', { items: [], total: 0 });  // Sends empty result on error
      return;
    }
    const formattedRows = rows.map(row => ({  // Formats rows with attributes as objects
      ...row,
      attributes: row.attributes ? Object.fromEntries(row.attributes.split(',').map(attr => attr.split(':'))) : {}
    }));
    db.get('SELECT COUNT(*) as total FROM items WHERE stock > 0 AND (name LIKE ? OR EXISTS (SELECT 1 FROM item_attributes WHERE item_id = items.id AND value LIKE ?))', [`%${search}%`, `%${search}%`], (err, countResult) => {  // Gets total count
      if (err) {
        console.error('Get inventory count error:', err);  // Logs count error
        event.reply('inventory-data', { items: formattedRows, total: 0 });  // Sends partial result on error
      } else {
        event.reply('inventory-data', { items: formattedRows, total: countResult.total });  // Sends items and total count
      }
    });
  });
});

// Fetches all inventory items (including stock = 0) for Inventory tab
ipcMain.on('get-all-inventory', (event, { page = 1, limit = 50, search = '' } = {}) => {
  const offset = (page - 1) * limit;  // Calculates offset for pagination
  const query = `
    SELECT i.*, GROUP_CONCAT(a.key || ':' || a.value) as attributes 
    FROM items i 
    LEFT JOIN item_attributes a ON i.id = a.item_id
    WHERE i.name LIKE ? OR EXISTS (SELECT 1 FROM item_attributes WHERE item_id = i.id AND value LIKE ?)
    GROUP BY i.id
    ORDER BY i.name 
    LIMIT ? OFFSET ?
  `;  // SQL query to fetch all items, supporting search
  const params = [`%${search}%`, `%${search}%`, limit, offset];  // Parameters for query with wildcard search
  
  db.all(query, params, (err, rows) => {  // Executes query to fetch items
    if (err) {
      console.error('Get all inventory error:', err);  // Logs query error
      event.reply('all-inventory-data', { items: [], total: 0 });  // Sends empty result on error
      return;
    }
    const formattedRows = rows.map(row => ({  // Formats rows with attributes as objects
      ...row,
      attributes: row.attributes ? Object.fromEntries(row.attributes.split(',').map(attr => attr.split(':'))) : {}
    }));
    db.get('SELECT COUNT(*) as total FROM items WHERE name LIKE ? OR EXISTS (SELECT 1 FROM item_attributes WHERE item_id = items.id AND value LIKE ?)', [`%${search}%`, `%${search}%`], (err, countResult) => {  // Gets total count
      if (err) {
        console.error('Get all inventory count error:', err);  // Logs count error
        event.reply('all-inventory-data', { items: formattedRows, total: 0 });  // Sends partial result on error
      } else {
        console.log('All inventory fetched:', formattedRows.length);  // Logs successful fetch
        event.reply('all-inventory-data', { items: formattedRows, total: countResult.total });  // Sends items and total count
      }
    });
  });
});

// Updates an existing inventory item’s details
ipcMain.on('update-inventory-item', (event, item) => {
  db.run('UPDATE items SET name = ?, price = ?, condition = ? WHERE id = ?', 
    [item.name, item.price, item.condition, item.id],  // Updates item fields by ID
    (err) => {
      if (err) {
        console.error('Update inventory item error:', err);  // Logs update error
        event.reply('update-inventory-error', err.message);  // Sends error to renderer
      } else {
        console.log('Inventory item updated:', item.id);  // Logs successful update
        event.reply('update-inventory-success', item);  // Sends success to renderer
      }
    }
  );
});

// Updates an inventory item’s attributes
ipcMain.on('update-item-attributes', (event, { item_id, attributes }) => {
  // Deletes existing attributes for this item
  db.run('DELETE FROM item_attributes WHERE item_id = ?', [item_id], (err) => {
    if (err) {
      console.error('Error deleting old attributes:', err);  // Logs deletion error
      event.reply('update-attributes-error', err.message);  // Sends error to renderer
      return;
    }
    // Inserts new attributes
    const attributeInserts = Object.entries(attributes).map(([key, value]) => 
      new Promise((resolve, reject) => {
        db.run('INSERT INTO item_attributes (item_id, key, value) VALUES (?, ?, ?)', 
          [item_id, key, value], (err) => {  // Inserts each attribute
            if (err) reject(err);
            else resolve();
          });
      })
    );
    Promise.all(attributeInserts)  // Waits for all attribute inserts to complete
      .then(() => {
        console.log('Attributes updated for item:', item_id);  // Logs successful update
        event.reply('update-attributes-success', { item_id, attributes });  // Sends success to renderer
      })
      .catch(err => {
        console.error('Error updating attributes:', err);  // Logs attribute insertion error
        event.reply('update-attributes-error', err.message);  // Sends error to renderer
      });
  });
});

// Fetches transaction data for Transactions tab display
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
  `, (err, rows) => {  // Joins transactions with their items
    if (err) {
      console.error('Error fetching transactions:', err);  // Logs query error
      event.sender.send('transactions-error', err);  // Sends error to renderer
    } else {
      console.log('Transactions fetched:', rows.length);  // Logs successful fetch
      event.sender.send('transactions-data', rows);  // Sends transaction data to renderer
    }
  });
});

// Fetches cash totals for Reports tab reconciliation
ipcMain.on('get-cash-totals', (event, { startDate = '', endDate = '' } = {}) => {
  let query = 'SELECT SUM(cash_in) AS total_cash_in, SUM(cash_out) AS total_cash_out FROM transactions';  // Base query for totals
  let params = [];
  if (startDate || endDate) {  // Adds date range filter if provided
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
  db.get(query, params, (err, row) => {  // Executes query to fetch totals
    if (err) {
      console.error('Error fetching cash totals:', err);  // Logs query error
      event.reply('cash-totals-error', err.message);  // Sends error to renderer
    } else {
      console.log('Cash totals fetched:', row);  // Logs successful fetch
      event.reply('cash-totals-data', {  // Sends totals to renderer
        total_cash_in: row.total_cash_in || 0,  // Total cash in, defaults to 0
        total_cash_out: row.total_cash_out || 0  // Total cash out, defaults to 0
      });
    }
  });
});

// Saves a cash reconciliation record in Reports tab
ipcMain.on('save-reconciliation', (event, reconciliation) => {
  const id = Date.now().toString();  // Generates unique ID based on timestamp
  db.run('INSERT INTO cash_reconciliations (id, date, starting_cash, total_cash_in, total_cash_out, expected_cash, actual_cash, discrepancy, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', 
    [id, reconciliation.date, reconciliation.starting_cash, reconciliation.total_cash_in, reconciliation.total_cash_out, reconciliation.expected_cash, reconciliation.actual_cash, reconciliation.discrepancy, reconciliation.notes],  // Inserts reconciliation data
    (err) => {
      if (err) {
        console.error('Error saving reconciliation:', err);  // Logs insertion error
        event.reply('reconciliation-error', err.message);  // Sends error to renderer
      } else {
        console.log('Reconciliation saved:', id);  // Logs successful save
        event.reply('reconciliation-success', { id, ...reconciliation });  // Sends success to renderer
      }
    }
  );
});

// Fetches all cash reconciliation records for Reports tab display
ipcMain.on('get-reconciliations', (event) => {
  db.all('SELECT * FROM cash_reconciliations ORDER BY date DESC', (err, rows) => {  // Fetches all reconciliations, sorted by date descending
    if (err) {
      console.error('Error fetching reconciliations:', err);  // Logs query error
      event.reply('reconciliations-error', err.message);  // Sends error to renderer
    } else {
      console.log('Reconciliations fetched:', rows.length);  // Logs successful fetch
      event.reply('reconciliations-data', rows);  // Sends reconciliation data to renderer
    }
  });
});

// Fetches all Pokémon TCG cards with detailed pricing
ipcMain.on('get-tcg-card', async (event, name) => {
  try {
    let allCards = [];  // Array to store all fetched cards
    let page = 1;  // Starting page for pagination
    let hasMore = true;  // Flag to continue fetching pages

    while (hasMore) {  // Loops until all pages are fetched
      const response = await axios.get('https://api.pokemontcg.io/v2/cards', {
        params: { q: `name:${name}`, page: page, pageSize: 250 },  // Queries cards by name with pagination
        headers: { 'X-Api-Key': process.env.POKEMON_TCG_API_KEY }  // Authenticates with API key
      });
      const cards = response.data.data;  // Extracts card data from response
      allCards = allCards.concat(cards);  // Adds cards to total collection
      const totalCount = response.data.totalCount || 0;  // Gets total count from API
      hasMore = allCards.length < totalCount && cards.length > 0;  // Continues if more cards exist
      page++;  // Increments page number
    }

    const exchangeRates = await getExchangeRates();  // Fetches current exchange rates

    const filteredCards = allCards.map(card => {  // Formats each card with pricing data
      const tcgPrices = card.tcgplayer?.prices || {};  // TCGPlayer prices or empty object
      const cmPrices = card.cardmarket?.prices || {};  // Cardmarket prices or empty object
      return {
        id: card.id,  // Card ID
        name: card.name,  // Card name
        type: 'pokemon_tcg',  // Fixed type for TCG cards
        image_url: card.images.large,  // Large image URL (no caching here)
        tcg_id: card.id,  // TCG-specific ID
        card_set: card.set.name,  // Card set name
        rarity: card.rarity,  // Card rarity
        prices: {
          tcgplayer: Object.keys(tcgPrices).reduce((acc, rarity) => {  // Converts TCGPlayer prices to GBP
            const rarityPrices = tcgPrices[rarity];
            acc[rarity] = {
              market: rarityPrices.market || 0,  // Market price in USD
              market_gbp: (rarityPrices.market || 0) * exchangeRates.USD_TO_GBP,  // Converted to GBP
              low: rarityPrices.low || 0,  // Low price in USD
              low_gbp: (rarityPrices.low || 0) * exchangeRates.USD_TO_GBP  // Converted to GBP
            };
            return acc;
          }, {}),
          cardmarket: {  // Converts Cardmarket prices to GBP
            average: cmPrices.averageSellPrice || 0,  // Average sell price in EUR
            average_gbp: (cmPrices.averageSellPrice || 0) * exchangeRates.EUR_TO_GBP,  // Converted to GBP
            trend: cmPrices.trendPrice || 0,  // Trend price in EUR
            trend_gbp: (cmPrices.trendPrice || 0) * exchangeRates.EUR_TO_GBP  // Converted to GBP
          }
        }
      };
    });

    console.log('Fetched TCG card data:', filteredCards);  // Logs fetched card data
    event.reply('tcg-card-data', filteredCards);  // Sends card data to renderer
  } catch (err) {
    console.error('Pokémon TCG fetch error:', err.message);  // Logs fetch error
    event.reply('tcg-card-error', err.message);  // Sends error to renderer
  }
});

// Fetches video game data from Giant Bomb API
ipcMain.on('get-game-data', async (event, { name, platform }) => {
  try {
    const response = await axios({  // Makes API request to Giant Bomb
      method: 'GET',
      url: 'https://www.giantbomb.com/api/search/',
      params: {
        api_key: process.env.GIANTBOMB_API_KEY,  // Authenticates with API key
        format: 'json',  // Requests JSON response
        query: name,  // Searches by game name
        resources: 'game',  // Limits to game resources
        limit: 100,  // Caps results at 100 for selection
        field_list: 'id,name,platforms,original_release_date,deck,image,genres'  // Specifies desired fields
      }
    });

    const games = response.data.results.map(game => {  // Formats each game result
      const imageUrl = game.image && game.image.medium_url ? game.image.medium_url : null;  // Gets medium image URL or null
      const matchedPlatform = platform && game.platforms && game.platforms.some(p => p.abbreviation === platform) 
        ? platform  // Uses specified platform if matched
        : game.platforms?.map(p => p.abbreviation).join(', ') || 'Multiple';  // Lists all platforms otherwise
      return {
        id: game.id.toString(),  // Game ID as string
        name: game.name,  // Game name
        type: 'video_game',  // Fixed type for video games
        price: 0,  // Default price (Giant Bomb doesn’t provide; user adjusts)
        tradeValue: 0,  // Default trade value (user adjusts)
        image_url: imageUrl,  // Raw image URL (caching handled below)
        platform: matchedPlatform,  // Platform info
        release_date: game.original_release_date || null,  // Release date or null
        description: game.deck || null,  // Game description or null
        genres: game.genres ? game.genres.map(g => g.name).join(', ') : null  // Genres as comma-separated string or null
      };
    });

    // Caches image for the first game result if available
    if (games.length > 0 && games[0].image_url) {
      const cacheDir = path.join(__dirname, 'images', 'cache');  // Cache directory for game images
      const cacheFileName = `video_game_${games[0].name.replace(/\s+/g, '_')}_${platform ? platform.replace(/\s+/g, '_') : 'default'}.png`;  // Unique filename
      const cachePath = path.join(cacheDir, cacheFileName);  // Full cache path

      if (!fs.existsSync(cachePath)) {  // Checks if image isn’t already cached
        const imageResponse = await axios({  // Fetches image data
          method: 'GET',
          url: games[0].image_url,
          responseType: 'arraybuffer'
        });
        fs.mkdirSync(cacheDir, { recursive: true });  // Creates cache directory if needed
        fs.writeFileSync(cachePath, Buffer.from(imageResponse.data));  // Saves image to disk
        console.log('Image downloaded and cached:', cachePath);  // Logs successful caching
      }
      games[0].image_url = `file://${cachePath}`;  // Updates first game’s URL to local path
    }

    console.log('Fetched game data:', games);  // Logs fetched game data
    event.reply('game-data', games);  // Sends game data to renderer
  } catch (err) {
    console.error('Giant Bomb game fetch error:', err.message);  // Logs fetch error
    event.reply('game-data-error', err.message);  // Sends error to renderer
  }
});

// Generates a receipt file for a transaction and opens it
ipcMain.on('generate-receipt', (event, transaction) => {
  const { id, type, cash_in, cash_out, timestamp, items } = transaction;  // Destructures transaction data
  const receiptDir = path.join(__dirname, 'receipts');  // Directory for receipts
  fs.mkdirSync(receiptDir, { recursive: true });  // Creates receipts directory if needed
  const receiptFile = path.join(receiptDir, `${id}-receipt.txt`);  // Full path for receipt file

  const cashDue = type === 'trade' ? Math.max(cash_in - cash_out, 0) : 0;  // Cash due from customer in trade
  const cashBack = type === 'trade' ? Math.max(cash_out - cash_in, 0) : 0;  // Cash back to customer in trade

  // Customizes item lines based on transaction type
  const itemLines = items.map(item => {
    if (type === 'buy') {  // Buy transaction: shows trade value
      return `  - ${item.name} (${item.type}) | Trade Value: £${(item.trade_value || 0).toFixed(2)} | Condition: ${item.condition || 'Not Set'}`;
    } else if (type === 'sell') {  // Sell transaction: shows negotiated price
      const price = item.negotiated_price || item.original_price || 0;
      return `  - ${item.name} (${item.type}) | Price: £${price.toFixed(2)} | Condition: ${item.condition || 'Not Set'}`;
    } else if (type === 'trade') {  // Trade transaction: differentiates trade-in and trade-out
      if (item.role === 'trade_in') {
        return `  - ${item.name} (${item.type}) | Trade Value: £${(item.trade_value || 0).toFixed(2)} | Condition: ${item.condition || 'Not Set'} (Trade-In)`;
      } else if (item.role === 'trade_out') {
        const price = item.negotiated_price || item.original_price || 0;
        return `  - ${item.name} (${item.type}) | Price: £${price.toFixed(2)} | Condition: ${item.condition || 'Not Set'} (Trade-Out)`;
      }
    }
  }).join('\n');  // Joins item lines with newlines

  // Debugs timestamp and ensures valid date
  console.log('Generating receipt for transaction:', { id, timestamp });  // Logs receipt generation start
  const date = timestamp ? new Date(timestamp) : new Date();  // Uses provided timestamp or current time
  const formattedDate = date.toLocaleString();  // Formats date as local string

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
  `;  // Constructs receipt text content

  fs.writeFileSync(receiptFile, receiptContent.trim());  // Writes receipt to file, trims whitespace
  console.log('Receipt generated:', receiptFile);  // Logs successful generation

  shell.openPath(receiptFile);  // Opens the receipt file with default system application
  event.reply('receipt-generated', receiptFile);  // Sends receipt file path to renderer
});