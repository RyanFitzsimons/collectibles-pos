const { ipcRenderer } = require('electron');

let sellCart = [];
let tradeInCart = [];
let tradeOutCart = [];
let buyItems = [];
let currentInventory = [];
let sellPage = 1;
let tradeOutPage = 1;
const itemsPerPage = 5;
let sellTotal = 0;
let tradeOutTotal = 0;
let sellSearchTerm = '';
let tradeOutSearchTerm = '';

// Debounce function to limit search frequency
function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// Enhanced cleanPrice with explicit £
function cleanPrice(price) {
  const raw = String(price);
  const cleaned = raw.replace(/[^0-9.]/g, ''); // Only numbers and decimals
  console.log(`Cleaning price: "${raw}" -> "${cleaned}"`); // Debug log
  return `\u00A3${cleaned}`; // Unicode £
}

function showScreen(screen) {
  console.log('Showing screen:', screen, { sellCart, tradeInCart, tradeOutCart, buyItems });
  const content = document.getElementById('content');
  
  if (screen === 'sell') {
    fetchInventory('sell', sellPage, sellSearchTerm);
  } else if (screen === 'buy') {
    const totalPayout = buyItems.reduce((sum, item) => sum + item.tradeValue, 0);
    content.innerHTML = `
      <div class="section">
        <h3>Add Item</h3>
        <div class="input-group">
          <label>Search TCG Card</label>
          <input id="buy-tcg-card-name" placeholder="e.g., Charizard" type="text">
          <button onclick="fetchTcgCard('buy')">Fetch Card</button>
        </div>
        <div id="tcg-modal-buy" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000;">
          <div style="background: white; margin: 50px auto; padding: 20px; width: 80%; max-height: 80%; overflow-y: auto;">
            <h4>Select a Card</h4>
            <div id="tcg-card-list-buy" style="display: flex; flex-wrap: wrap; gap: 20px;"></div>
            <button onclick="closeTcgModal('buy')">Close</button>
          </div>
        </div>
        <div class="input-group">
          <label>Card Name</label>
          <input id="buy-name" placeholder="Enter card name" type="text">
        </div>
        <div class="input-group">
          <label>Type</label>
          <input id="buy-type" placeholder="e.g., pokemon_card" type="text">
        </div>
        <div class="input-group">
          <label>Market Price (\u00A3)</label>
          <input id="buy-price" placeholder="Enter price" type="number">
        </div>
        <div class="input-group">
          <label>Trade Value (\u00A3)</label>
          <input id="buy-trade-value" placeholder="Enter trade value" type="number">
        </div>
        <div class="input-group">
          <label>Condition</label>
          <select id="buy-condition-category">
            <option value="">Select Category</option>
            <option value="Raw">Raw</option>
            <option value="PSA">PSA</option>
            <option value="CGC">CGC</option>
            <option value="BGS">BGS</option>
            <option value="TAG">TAG</option>
            <option value="Other">Other</option>
          </select>
          <input id="buy-condition-value" placeholder="e.g., NM, 7" type="text">
        </div>
        <div class="input-group">
          <label>Image</label>
          <input id="buy-image" type="file" accept="image/*">
        </div>
        <input id="buy-tcg-id" type="hidden">
        <input id="buy-card-set" type="hidden">
        <input id="buy-rarity" type="hidden">
        <input id="buy-image-url" type="hidden">
        <button onclick="addToBuy()">Add Item</button>
      </div>
      <div class="section">
        <h3>Buy Cart</h3>
        <ul id="buy-items">
          ${buyItems.map(item => `
            <li>
              ${item.image_url ? `<img src="${item.image_url}" alt="${item.name}" style="max-width: 50px;">` : ''}
              ${item.name} (${item.card_set || 'Unknown Set'}) - ${cleanPrice(item.tradeValue)} (${item.condition || 'Not Set'})
            </li>
          `).join('')}
        </ul>
        <p>Total Payout: ${cleanPrice(totalPayout.toFixed(2))}</p>
        <button onclick="completeBuyTransaction()">Complete Buy</button>
      </div>
    `;
  } else if (screen === 'trade') {
    fetchInventory('trade-out', tradeOutPage, tradeOutSearchTerm);
  } else if (screen === 'transactions') {
    ipcRenderer.send('get-transactions');
    ipcRenderer.once('transactions-data', (event, rows) => {
      const transactions = {};
      rows.forEach(row => {
        if (!transactions[row.id]) {
          transactions[row.id] = { type: row.type, cash_in: row.cash_in, cash_out: row.cash_out, timestamp: row.timestamp, items: [] };
        }
        if (row.item_id) {
          transactions[row.id].items.push({
            item_id: row.item_id,
            name: row.item_name,
            role: row.role,
            trade_value: row.trade_value,
            negotiated_price: row.negotiated_price,
            original_price: row.original_price,
            image_url: row.image_url,
            condition: row.condition,
            card_set: row.card_set
          });
        }
      });

      let allTransactions = Object.entries(transactions);
      let sortedTransactions = allTransactions.sort((a, b) => new Date(b[1].timestamp) - new Date(a[1].timestamp));
      let currentSortKey = 'timestamp';
      let isAsc = false;
      let searchTerm = '';
      let startDate = '';
      let endDate = '';
      let currentPage = 1;
      const itemsPerPage = 10;

      function renderTransactions(filteredTransactions) {
        const totalCashIn = filteredTransactions.reduce((sum, [, tx]) => sum + (parseFloat(tx.cash_in) || 0), 0);
        const totalCashOut = filteredTransactions.reduce((sum, [, tx]) => sum + (parseFloat(tx.cash_out) || 0), 0);
        const totalPages = Math.ceil(filteredTransactions.length / itemsPerPage);
        const startIndex = (currentPage - 1) * itemsPerPage;
        const paginatedTransactions = filteredTransactions.slice(startIndex, startIndex + itemsPerPage);

        content.innerHTML = `
          <div class="section">
            <h3>Transactions</h3>
            <div class="input-group">
              <label>Filter Transactions</label>
              <input id="transactions-search" type="text" placeholder="Search by ID, Type, or Item Name" value="${searchTerm}">
            </div>
            <div class="input-group">
              <label>Start Date</label>
              <input id="transactions-start-date" type="date" value="${startDate}">
              <label>End Date</label>
              <input id="transactions-end-date" type="date" value="${endDate}">
            </div>
            <p>Total Cash In: ${cleanPrice(totalCashIn.toFixed(2))}</p>
            <p>Total Cash Out: ${cleanPrice(totalCashOut.toFixed(2))}</p>
            <button id="export-csv">Export to CSV</button>
            <table class="transactions-table">
              <thead>
                <tr>
                  <th data-sort="id">ID</th>
                  <th data-sort="type">Type</th>
                  <th data-sort="cash_in">Cash In</th>
                  <th data-sort="cash_out">Cash Out</th>
                  <th data-sort="timestamp">Timestamp</th>
                  <th>Items</th>
                </tr>
              </thead>
              <tbody>
                ${paginatedTransactions.map(([id, tx]) => `
                  <tr>
                    <td>${id}</td>
                    <td>${tx.type}</td>
                    <td>${cleanPrice(tx.cash_in || 0)}</td>
                    <td>${cleanPrice(tx.cash_out || 0)}</td>
                    <td>${tx.timestamp}</td>
                    <td>
                      <button class="toggle-items" data-id="${id}">Show Items</button>
                      <ul class="items-list" id="items-${id}" style="display: none;">
                        ${tx.items.map(item => `
                          <li>
                            ${item.image_url ? `<img src="${item.image_url}" alt="${item.name}">` : ''}
                            ${item.name} (${item.card_set || 'Unknown Set'}) (${item.condition || 'Not Set'}) (${item.role === 'trade_in' ? 'Trade-In' : item.role === 'trade_out' ? 'Trade-Out' : 'Sold'}) - 
                            ${item.role === 'trade_in' ? `Trade Value: ${cleanPrice(item.trade_value)}` : `Sold For: ${cleanPrice(item.negotiated_price || item.original_price)}`}
                          </li>
                        `).join('')}
                      </ul>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
            <div class="pagination">
              <button id="prev-page" ${currentPage === 1 ? 'disabled' : ''}>Previous</button>
              <span>Page ${currentPage} of ${totalPages}</span>
              <button id="next-page" ${currentPage >= totalPages ? 'disabled' : ''}>Next</button>
            </div>
          </div>
        `;

        // Sorting
        const table = document.querySelector('.transactions-table');
        table.querySelectorAll('th[data-sort]').forEach(th => {
          th.addEventListener('click', () => {
            const key = th.dataset.sort;
            if (key === currentSortKey) {
              isAsc = !isAsc;
            } else {
              currentSortKey = key;
              isAsc = false;
            }
            th.classList.toggle('asc', isAsc);
            sortedTransactions.sort((a, b) => {
              const aVal = key === 'timestamp' ? new Date(a[1][key]) : (a[1][key] || 0);
              const bVal = key === 'timestamp' ? new Date(b[1][key]) : (b[1][key] || 0);
              return isAsc ? aVal - bVal : bVal - aVal;
            });
            renderTransactions(sortedTransactions);
          });
        });

        // Debounced Filtering
        document.getElementById('transactions-search').addEventListener('input', debounce((e) => {
          searchTerm = e.target.value.toLowerCase();
          applyFilters();
        }, 600));

        // Date Range Filtering
        document.getElementById('transactions-start-date').addEventListener('change', (e) => {
          startDate = e.target.value;
          applyFilters();
        });
        document.getElementById('transactions-end-date').addEventListener('change', (e) => {
          endDate = e.target.value;
          applyFilters();
        });

        // Pagination
        document.getElementById('prev-page').addEventListener('click', () => {
          if (currentPage > 1) {
            currentPage--;
            renderTransactions(sortedTransactions);
          }
        });
        document.getElementById('next-page').addEventListener('click', () => {
          if (currentPage < totalPages) {
            currentPage++;
            renderTransactions(sortedTransactions);
          }
        });

        // Export to CSV
        document.getElementById('export-csv').addEventListener('click', () => {
          let csvContent = 'ID,Type,Cash In,Cash Out,Timestamp,Items\n';
          filteredTransactions.forEach(([id, tx]) => {
            const itemsStr = tx.items.map(item => 
              `${item.name} (${item.card_set || 'Unknown Set'}) (${item.condition || 'Not Set'}) (${item.role === 'trade_in' ? 'Trade-In' : item.role === 'trade_out' ? 'Trade-Out' : 'Sold'}) - ${item.role === 'trade_in' ? cleanPrice(item.trade_value) : cleanPrice(item.negotiated_price || item.original_price)}`
            ).join('; ');
            csvContent += `${id},${tx.type},${cleanPrice(tx.cash_in || 0)},${cleanPrice(tx.cash_out || 0)},${tx.timestamp},"${itemsStr.replace(/"/g, '""')}"\n`;
          });
          const blob = new Blob([csvContent], { type: 'text/csv' });
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `transactions_${new Date().toISOString().split('T')[0]}.csv`;
          a.click();
          window.URL.revokeObjectURL(url);
        });

        // Toggle items
        function bindToggleEvents() {
          document.querySelectorAll('.toggle-items').forEach(button => {
            button.addEventListener('click', () => {
              const id = button.dataset.id;
              const itemsList = document.getElementById(`items-${id}`);
              const isVisible = itemsList.style.display !== 'none';
              itemsList.style.display = isVisible ? 'none' : 'block';
              button.textContent = isVisible ? 'Show Items' : 'Hide Items';
            });
          });
        }
        bindToggleEvents();

        // Apply all filters
        function applyFilters() {
          let filtered = allTransactions;
          if (searchTerm) {
            filtered = filtered.filter(([id, tx]) => {
              const itemNames = tx.items.map(item => item.name.toLowerCase()).join(' ');
              return (
                id.toLowerCase().includes(searchTerm) ||
                tx.type.toLowerCase().includes(searchTerm) ||
                itemNames.includes(searchTerm)
              );
            });
          }
          if (startDate) {
            filtered = filtered.filter(([, tx]) => new Date(tx.timestamp) >= new Date(startDate));
          }
          if (endDate) {
            filtered = filtered.filter(([, tx]) => new Date(tx.timestamp) <= new Date(endDate));
          }
          sortedTransactions = filtered.sort((a, b) => {
            const aVal = currentSortKey === 'timestamp' ? new Date(a[1][currentSortKey]) : (a[1][currentSortKey] || 0);
            const bVal = currentSortKey === 'timestamp' ? new Date(b[1][currentSortKey]) : (b[1][currentSortKey] || 0);
            return isAsc ? aVal - bVal : bVal - aVal;
          });
          currentPage = 1; // Reset to first page on filter
          renderTransactions(sortedTransactions);
        }
      }

      renderTransactions(sortedTransactions);
    });
  }
}

function renderSellTab(inventory, total) {
  console.log('Rendering Sell tab with:', { inventory, total });
  const totalListed = sellCart.reduce((sum, item) => sum + parseFloat(item.price), 0);
  const totalNegotiated = sellCart.reduce((sum, item) => sum + parseFloat(item.negotiatedPrice || item.price), 0);
  const totalPages = Math.ceil(total / itemsPerPage);
  document.getElementById('content').innerHTML = `
    <h3>Sell to Customer</h3>
    <div>
      <h4>Inventory</h4>
      <input id="sell-search" type="text" placeholder="Search inventory (e.g., Charizard, Base Set)" value="${sellSearchTerm}">
      <ul id="sell-inventory-list">
        ${inventory.map(item => `
          <li>
            ${item.image_url ? `<img src="${item.image_url}" alt="${item.name}">` : ''}
            ${item.name} (${item.card_set || 'Unknown Set'}) - ${cleanPrice(item.price)} (${item.condition || 'Not Set'}) <button onclick="addToSellCart('${item.id}', '${item.name}', ${item.price}, '${item.image_url || ''}', '${item.card_set || ''}', '${item.condition || ''}')">Add</button>
          </li>
        `).join('')}
      </ul>
      <div>
        <button onclick="fetchInventory('sell', ${sellPage - 1}, sellSearchTerm)" ${sellPage === 1 ? 'disabled' : ''}>Previous</button>
        <span>Page ${sellPage} of ${totalPages}</span>
        <button onclick="fetchInventory('sell', ${sellPage + 1}, sellSearchTerm)" ${sellPage >= totalPages ? 'disabled' : ''}>Next</button>
      </div>
    </div>
    <div>
      <h4>Sell Cart</h4>
      <ul id="sell-cart-items">
        ${sellCart.map(item => `
          <li>
            ${item.image_url ? `<img src="${item.image_url}" alt="${item.name}" style="max-width: 50px;">` : ''}
            ${item.name} (${item.card_set || 'Unknown Set'}) - 
            <input type="number" value="${item.negotiatedPrice}" onchange="updateSellPrice('${item.id}', this.value)" style="width: 60px;">
            (Original: ${cleanPrice(item.price)}, ${item.condition || 'Not Set'})
          </li>
        `).join('')}
      </ul>
      <p>Total Listed: ${cleanPrice(totalListed.toFixed(2))}</p>
      <p>Total Negotiated: ${cleanPrice(totalNegotiated.toFixed(2))}</p>
      <button onclick="completeSellTransaction()">Complete Sell</button>
    </div>
  `;
  document.getElementById('sell-search').addEventListener('input', debounce((e) => {
    sellSearchTerm = e.target.value;
    fetchInventory('sell', 1, sellSearchTerm);
  }, 600));
}

function renderTradeTab(inventory, total) {
  const tradeInTotal = tradeInCart.reduce((sum, item) => sum + parseFloat(item.tradeValue), 0);
  const tradeOutTotal = tradeOutCart.reduce((sum, item) => sum + parseFloat(item.negotiatedPrice || item.price), 0);
  const cashDue = Math.max(tradeOutTotal - tradeInTotal, 0);
  const cashBack = tradeInTotal > tradeOutTotal ? tradeInTotal - tradeOutTotal : 0;
  const totalPages = Math.ceil(total / itemsPerPage);

  document.getElementById('content').innerHTML = `
    <div class="trade-container">
      <div class="trade-section trade-in">
        <div class="section">
          <h3>Add Trade-In Item</h3>
          <div class="input-group">
            <label>Search TCG Card</label>
            <input id="trade-in-tcg-card-name" placeholder="e.g., Charizard" type="text">
            <button onclick="fetchTcgCard('trade-in')">Fetch Card</button>
          </div>
          <div id="tcg-modal-trade-in" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000;">
            <div style="background: white; margin: 50px auto; padding: 20px; width: 80%; max-height: 80%; overflow-y: auto;">
              <h4>Select a Card</h4>
              <div id="tcg-card-list-trade-in" style="display: flex; flex-wrap: wrap; gap: 20px;"></div>
              <button onclick="closeTcgModal('trade-in')">Close</button>
            </div>
          </div>
          <div class="input-group">
            <label>Card Name</label>
            <input id="trade-in-name" placeholder="Enter card name" type="text">
          </div>
          <div class="input-group">
            <label>Type</label>
            <input id="trade-in-type" placeholder="e.g., pokemon_card" type="text">
          </div>
          <div class="input-group">
            <label>Market Price (\u00A3)</label>
            <input id="trade-in-price" placeholder="Enter price" type="number">
          </div>
          <div class="input-group">
            <label>Trade Value (\u00A3)</label>
            <input id="trade-in-value" placeholder="Enter trade value" type="number">
          </div>
          <div class="input-group">
            <label>Condition</label>
            <select id="trade-in-condition-category">
              <option value="">Select Category</option>
              <option value="Raw">Raw</option>
              <option value="PSA">PSA</option>
              <option value="CGC">CGC</option>
              <option value="BGS">BGS</option>
              <option value="TAG">TAG</option>
              <option value="Other">Other</option>
            </select>
            <input id="trade-in-condition-value" placeholder="e.g., NM, 7" type="text">
          </div>
          <div class="input-group">
            <label>Image</label>
            <input id="trade-in-image" type="file" accept="image/*">
          </div>
          <input id="trade-in-tcg-id" type="hidden">
          <input id="trade-in-card-set" type="hidden">
          <input id="trade-in-rarity" type="hidden">
          <input id="trade-in-image-url" type="hidden">
          <button onclick="addToTradeInCart()">Add Trade-In</button>
        </div>
        <div class="section">
          <h3>Trade-In Cart</h3>
          <ul id="trade-in-items">
            ${tradeInCart.map(item => `
              <li>
                ${item.image_url ? `<img src="${item.image_url}" alt="${item.name}" style="max-width: 50px;">` : ''}
                ${item.name} (${item.card_set || 'Unknown Set'}) - ${cleanPrice(item.tradeValue)} (${item.condition || 'Not Set'})
              </li>
            `).join('')}
          </ul>
          <p>Total Trade-In Value: ${cleanPrice(tradeInTotal.toFixed(2))}</p>
        </div>
      </div>
      <div class="trade-section trade-out">
        <div class="section">
          <h3>Trade-Out Inventory</h3>
          <input id="trade-out-search" type="text" placeholder="Search inventory (e.g., Charizard, Base Set)" value="${tradeOutSearchTerm}">
          <ul id="trade-out-inventory-list">
            ${inventory.map(item => `
              <li>
                ${item.image_url ? `<img src="${item.image_url}" alt="${item.name}">` : ''}
                ${item.name} (${item.card_set || 'Unknown Set'}) - ${cleanPrice(item.price)} (${item.condition || 'Not Set'}) <button onclick="addToTradeOutCart('${item.id}', '${item.name}', ${item.price}, '${item.image_url || ''}', '${item.card_set || ''}', '${item.condition || ''}')">Add</button>
              </li>
            `).join('')}
          </ul>
          <div>
            <button onclick="fetchInventory('trade-out', ${tradeOutPage - 1}, tradeOutSearchTerm)" ${tradeOutPage === 1 ? 'disabled' : ''}>Previous</button>
            <span>Page ${tradeOutPage} of ${totalPages}</span>
            <button onclick="fetchInventory('trade-out', ${tradeOutPage + 1}, tradeOutSearchTerm)" ${tradeOutPage >= totalPages ? 'disabled' : ''}>Next</button>
          </div>
        </div>
        <div class="section">
          <h3>Trade-Out Cart</h3>
          <ul id="trade-out-items">
            ${tradeOutCart.map(item => `
              <li>
                ${item.image_url ? `<img src="${item.image_url}" alt="${item.name}" style="max-width: 50px;">` : ''}
                ${item.name} (${item.card_set || 'Unknown Set'}) - 
                <input type="number" value="${item.negotiatedPrice}" onchange="updateTradeOutPrice('${item.id}', this.value)" style="width: 60px;">
                (Original: ${cleanPrice(item.price)}, ${item.condition || 'Not Set'})
              </li>
            `).join('')}
          </ul>
          <p>Total Trade-Out Value: ${cleanPrice(tradeOutTotal.toFixed(2))}</p>
          <p>Cash Due: ${cleanPrice(cashDue.toFixed(2))}</p>
          ${cashBack > 0 ? `<p>Cash Back: ${cleanPrice(cashBack.toFixed(2))}</p>` : ''}
          <button onclick="completeTradeTransaction()">Complete Trade</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('trade-out-search').addEventListener('input', debounce((e) => {
    tradeOutSearchTerm = e.target.value;
    fetchInventory('trade-out', 1, tradeOutSearchTerm);
  }, 600));
}

function fetchInventory(context, page, searchTerm) {
  if (page < 1) return;
  ipcRenderer.send('get-inventory', { page, limit: itemsPerPage, search: searchTerm });
  ipcRenderer.once('inventory-data', (event, { items, total }) => {
    currentInventory = items;
    if (context === 'sell') {
      sellPage = page;
      sellTotal = total;
      renderSellTab(items, total);
    } else if (context === 'trade-out') {
      tradeOutPage = page;
      tradeOutTotal = total;
      renderTradeTab(items, total);
    }
  });
}

function addToSellCart(id, name, price, imageUrl, card_set, condition) {
  console.log('Adding to sell cart:', { id, name, price, imageUrl, card_set, condition });
  sellCart.push({ id, name, price, negotiatedPrice: price, image_url: imageUrl, card_set, condition, role: 'sold' });
  showScreen('sell');
}

function updateSellPrice(id, newPrice) {
  console.log('Updating sell price:', { id, newPrice });
  sellCart = sellCart.map(item => item.id === id ? { ...item, negotiatedPrice: parseFloat(newPrice) || item.price } : item);
  showScreen('sell');
}

function completeSellTransaction() {
  console.log('Completing sell transaction:', { sellCart });
  const items = sellCart;
  const cashIn = sellCart.reduce((sum, item) => sum + (item.negotiatedPrice || item.price), 0);
  const cashOut = 0;
  ipcRenderer.send('complete-transaction', { items, type: 'sell', cashIn, cashOut });
  ipcRenderer.once('transaction-complete', () => {
    console.log('Sell transaction completed');
    sellCart = [];
    showScreen('sell');
  });
  ipcRenderer.once('transaction-error', (event, error) => console.error('Sell transaction failed:', error));
}

function addToBuy() {
  const name = document.getElementById('buy-name').value;
  const type = document.getElementById('buy-type').value;
  const price = parseFloat(document.getElementById('buy-price').value) || 0;
  const tradeValue = parseFloat(document.getElementById('buy-trade-value').value) || 0;
  const conditionCategory = document.getElementById('buy-condition-category').value || '';
  const conditionValue = document.getElementById('buy-condition-value').value || '';
  const condition = conditionCategory && conditionValue ? `${conditionCategory} - ${conditionValue}` : null;
  const image = document.getElementById('buy-image').files[0];
  const id = Date.now().toString();
  const tcg_id = document.getElementById('buy-tcg-id').value || null;
  const card_set = document.getElementById('buy-card-set').value || null;
  const rarity = document.getElementById('buy-rarity').value || null;
  const image_url = document.getElementById('buy-image-url').value || null;

  console.log('Adding to buy:', { id, name, type, price, tradeValue, condition, image: image ? image.name : null, tcg_id, card_set, rarity, image_url });
  ipcRenderer.send('add-item', {
    id,
    name,
    type,
    price,
    tradeValue,
    condition,
    imagePath: image ? image.path : null,
    imageName: image ? image.name : null,
    image_url,
    role: 'trade_in',
    tcg_id,
    card_set,
    rarity
  });
  ipcRenderer.once('add-item-success', (event, item) => {
    buyItems.push(item);
    showScreen('buy');
  });
  ipcRenderer.once('add-item-error', (event, error) => console.error('Add item failed:', error));
}

function fetchTcgCard(context) {
  const input = document.getElementById(`${context}-tcg-card-name`); // Fixed selector
  if (!input) {
    console.error(`No input found for context: ${context}`);
    return;
  }
  const cardName = input.value;
  if (!cardName) {
    console.error('No card name provided for', context);
    return;
  }
  console.log(`Fetching TCG card for ${context}:`, cardName);
  ipcRenderer.send('get-tcg-card', cardName);
  ipcRenderer.once('tcg-card-data', (event, cards) => {
    console.log(`Received TCG card data for ${context}:`, cards);
    const cardList = document.getElementById(`tcg-card-list-${context}`);
    cardList.innerHTML = '';
    cards.forEach(card => {
      const cardDiv = document.createElement('div');
      cardDiv.style = 'border: 1px solid #ccc; padding: 10px; width: 200px; text-align: center;';
      cardDiv.innerHTML = `
        <img src="${card.image_url}" alt="${card.name}" style="width: auto; height: auto; max-width: 180px; max-height: 250px;">
        <p><strong>${card.name}</strong></p>
        <p>Set: ${card.card_set}</p>
        <p>Rarity: ${card.rarity}</p>
        <p>Price: ${cleanPrice(card.price.toFixed(2))}</p>
        <button onclick='selectTcgCard(${JSON.stringify(card)}, "${context}")'>Select</button>
      `;
      cardList.appendChild(cardDiv);
    });
    document.getElementById(`tcg-modal-${context}`).style.display = 'flex';
  });
  ipcRenderer.once('tcg-card-error', (event, error) => console.error(`TCG card fetch failed for ${context}:`, error));
}

function selectTcgCard(card, context) {
  console.log(`Selected TCG card for ${context}:`, card);
  document.getElementById(`${context}-name`).value = card.name;
  document.getElementById(`${context}-type`).value = card.type;
  document.getElementById(`${context}-price`).value = card.price;
  document.getElementById(`${context}-value`).value = Math.floor(card.price * 0.5);
  document.getElementById(`${context}-condition-category`).value = '';
  document.getElementById(`${context}-condition-value`).value = '';
  document.getElementById(`${context}-tcg-id`).value = card.tcg_id;
  document.getElementById(`${context}-card-set`).value = card.card_set;
  document.getElementById(`${context}-rarity`).value = card.rarity;
  document.getElementById(`${context}-image-url`).value = card.image_url;

  closeTcgModal(context);
}

function closeTcgModal(context) {
  document.getElementById(`tcg-modal-${context}`).style.display = 'none';
}

function completeBuyTransaction() {
  console.log('Completing buy transaction:', { buyItems });
  const items = buyItems;
  const cashIn = 0;
  const cashOut = buyItems.reduce((sum, item) => sum + item.tradeValue, 0);
  ipcRenderer.send('complete-transaction', { items, type: 'buy', cashIn, cashOut });
  ipcRenderer.once('transaction-complete', () => {
    console.log('Buy transaction completed');
    buyItems = [];
    showScreen('buy');
  });
  ipcRenderer.once('transaction-error', (event, error) => console.error('Buy transaction failed:', error));
}

function addToTradeOutCart(id, name, price, imageUrl, card_set, condition) {
  console.log('Adding to trade-out cart:', { id, name, price, imageUrl, card_set, condition });
  tradeOutCart.push({ id, name, price, negotiatedPrice: price, image_url: imageUrl, card_set, condition, role: 'trade_out' });
  showScreen('trade');
}

function updateTradeOutPrice(id, newPrice) {
  console.log('Updating trade-out price:', { id, newPrice });
  tradeOutCart = tradeOutCart.map(item => item.id === id ? { ...item, negotiatedPrice: parseFloat(newPrice) || item.price } : item);
  showScreen('trade');
}

function addToTradeInCart() {
  const name = document.getElementById('trade-in-name').value;
  const type = document.getElementById('trade-in-type').value;
  const price = parseFloat(document.getElementById('trade-in-price').value) || 0;
  const tradeValue = parseFloat(document.getElementById('trade-in-value').value) || 0;
  const conditionCategory = document.getElementById('trade-in-condition-category').value || '';
  const conditionValue = document.getElementById('trade-in-condition-value').value || '';
  const condition = conditionCategory && conditionValue ? `${conditionCategory} - ${conditionValue}` : null;
  const image = document.getElementById('trade-in-image').files[0];
  const id = Date.now().toString();
  const tcg_id = document.getElementById('trade-in-tcg-id').value || null;
  const card_set = document.getElementById('trade-in-card-set').value || null;
  const rarity = document.getElementById('trade-in-rarity').value || null;
  const image_url = document.getElementById('trade-in-image-url').value || null;

  console.log('Adding to trade-in cart:', { id, name, type, price, tradeValue, condition, image: image ? image.name : null, tcg_id, card_set, rarity, image_url });
  ipcRenderer.send('add-item', {
    id,
    name,
    type,
    price,
    tradeValue,
    condition,
    imagePath: image ? image.path : null,
    imageName: image ? image.name : null,
    image_url,
    role: 'trade_in',
    tcg_id,
    card_set,
    rarity
  });
  ipcRenderer.once('add-item-success', (event, item) => {
    tradeInCart.push(item);
    showScreen('trade');
  });
  ipcRenderer.once('add-item-error', (event, error) => console.error('Add trade-in failed:', error));
}

function completeTradeTransaction() {
  console.log('Completing trade transaction:', { tradeInCart, tradeOutCart });
  const items = [...tradeInCart, ...tradeOutCart];
  const cashIn = tradeOutCart.reduce((sum, item) => sum + (item.negotiatedPrice || item.price), 0);
  const cashOut = tradeInCart.reduce((sum, item) => sum + item.tradeValue, 0);
  ipcRenderer.send('complete-transaction', { items, type: 'trade', cashIn, cashOut });
  ipcRenderer.once('transaction-complete', () => {
    console.log('Trade transaction completed');
    tradeInCart = [];
    tradeOutCart = [];
    showScreen('trade');
  });
  ipcRenderer.once('transaction-error', (event, error) => console.error('Trade transaction failed:', error));
}

// Initial load
showScreen('sell');