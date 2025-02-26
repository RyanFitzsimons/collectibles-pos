const { ipcRenderer } = require('electron');

let sellCart = [];
let tradeInCart = [];
let tradeOutCart = [];
let buyItems = [];

let sellPage = 1;
let tradeOutPage = 1;
const itemsPerPage = 50;

let sellSearchTerm = '';
let tradeOutSearchTerm = '';

function cleanPrice(price) {
  console.log('Cleaning price:', price, '->', Number(price).toFixed(2));
  return `\u00A3${Number(price).toFixed(2)}`; // Use Unicode £
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
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
          <button id="fetch-buy-card">Fetch Card</button>
        </div>
        <div id="tcg-modal-buy" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000;">
          <div style="background: white; margin: 50px auto; padding: 20px; width: 80%; max-height: 80%; overflow-y: auto;">
            <h4>Select a Card</h4>
            <div id="tcg-card-list-buy" style="display: flex; flex-wrap: wrap; gap: 20px;"></div>
            <button id="close-tcg-modal-buy">Close</button>
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
        <p>Total Payout: ${cleanPrice(totalPayout.toFixed(2))}, Items: ${buyItems.length}</p>
        <button onclick="completeBuyTransaction()">Complete Buy</button>
        <button id="clear-buy-cart">Clear Cart</button>
      </div>
    `;
    document.getElementById('fetch-buy-card').addEventListener('click', () => fetchTcgCard('buy'));
    document.getElementById('close-tcg-modal-buy').addEventListener('click', () => closeTcgModal('buy'));
    document.getElementById('clear-buy-cart').addEventListener('click', clearBuyCart);
  } else if (screen === 'trade') {
    fetchInventory('trade-out', tradeOutPage, tradeOutSearchTerm);
  } else if (screen === 'transactions') {
    ipcRenderer.send('get-transactions');
    ipcRenderer.once('transactions-data', (event, rows) => {
      const transactions = {};
      rows.forEach(row => {
        const txId = row.transaction_id;
        if (!transactions[txId]) {
          transactions[txId] = { 
            id: txId, 
            type: row.transaction_type, 
            cash_in: row.cash_in, 
            cash_out: row.cash_out, 
            timestamp: row.timestamp, 
            items: [] 
          };
        }
        if (row.item_id) {
          transactions[txId].items.push({
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

        const stats = {
          total: filteredTransactions.length,
          sells: filteredTransactions.filter(([, tx]) => tx.type === 'sell').length,
          buys: filteredTransactions.filter(([, tx]) => tx.type === 'buy').length,
          trades: filteredTransactions.filter(([, tx]) => tx.type === 'trade').length
        };

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
            <p>Stats: Total: ${stats.total}, Sells: ${stats.sells}, Buys: ${stats.buys}, Trades: ${stats.trades}</p>
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
                  <tr class="${tx.type}">
                    <td>${id}</td>
                    <td>${tx.type || 'Unknown'}</td>
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
                            ${item.role === 'trade_in' ? `Trade Value: ${cleanPrice(item.trade_value || 0)}` : `Sold For: ${cleanPrice(item.negotiated_price || item.original_price || 0)}`}
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

        const table = document.querySelector('.transactions-table');
        table.querySelectorAll('th[data-sort]').forEach(th => {
          th.addEventListener('click', () => {
            const key = th.dataset.sort;
            if (key === 'timestamp') {
              isAsc = !isAsc;
              sortedTransactions.sort((a, b) => isAsc 
                ? new Date(a[1].timestamp) - new Date(b[1].timestamp) 
                : new Date(b[1].timestamp) - new Date(a[1].timestamp));
            } else {
              if (key === currentSortKey) isAsc = !isAsc;
              else {
                currentSortKey = key;
                isAsc = false;
              }
              sortedTransactions.sort((a, b) => isAsc 
                ? (a[1][key] || 0) - (b[1][key] || 0) 
                : (b[1][key] || 0) - (a[1][key] || 0));
            }
            th.classList.toggle('asc', isAsc);
            renderTransactions(sortedTransactions);
          });
        });

        document.getElementById('transactions-search').addEventListener('input', debounce((e) => {
          searchTerm = e.target.value.toLowerCase();
          applyFilters();
        }, 600));

        document.getElementById('transactions-start-date').addEventListener('change', (e) => {
          startDate = e.target.value;
          applyFilters();
        });
        document.getElementById('transactions-end-date').addEventListener('change', (e) => {
          endDate = e.target.value;
          applyFilters();
        });

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

        document.getElementById('export-csv').addEventListener('click', () => {
          let csvContent = 'ID,Type,Cash In,Cash Out,Timestamp,Items\n';
          filteredTransactions.forEach(([id, tx]) => {
            const itemsStr = tx.items.map(item => 
              `${item.name} (${item.card_set || 'Unknown Set'}) (${item.condition || 'Not Set'}) (${item.role === 'trade_in' ? 'Trade-In' : item.role === 'trade_out' ? 'Trade-Out' : 'Sold'}) - ${item.role === 'trade_in' ? cleanPrice(item.trade_value || 0) : cleanPrice(item.negotiated_price || item.original_price || 0)}`
            ).join('; ');
            csvContent += `${id},${tx.type || 'Unknown'},${cleanPrice(tx.cash_in || 0)},${cleanPrice(tx.cash_out || 0)},${tx.timestamp},"${itemsStr.replace(/"/g, '""')}"\n`;
          });
          const blob = new Blob([csvContent], { type: 'text/csv' });
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `transactions_${new Date().toISOString().split('T')[0]}.csv`;
          a.click();
          window.URL.revokeObjectURL(url);
        });

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

        function applyFilters() {
          let filtered = allTransactions;
          if (searchTerm) {
            filtered = filtered.filter(([id, tx]) => {
              const itemNames = tx.items.map(item => item.name.toLowerCase()).join(' ');
              return (
                id.toLowerCase().includes(searchTerm) ||
                (tx.type || '').toLowerCase().includes(searchTerm) ||
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
          currentPage = 1;
          renderTransactions(sortedTransactions);
        }
      }

      renderTransactions(sortedTransactions);
    });
  } else if (screen === 'inventory') {
    ipcRenderer.send('get-all-inventory');
    ipcRenderer.once('all-inventory-data', (event, { items, total }) => {
      let allItems = items;
      let sortedItems = allItems.sort((a, b) => a.name.localeCompare(b.name));
      let currentSortKey = 'name';
      let isAsc = true;
      let searchTerm = '';
      let currentPage = 1;
      const itemsPerPage = 10;

      function renderInventory(filteredItems) {
        const totalPages = Math.ceil(filteredItems.length / itemsPerPage);
        const startIndex = (currentPage - 1) * itemsPerPage;
        const paginatedItems = filteredItems.slice(startIndex, startIndex + itemsPerPage);

        content.innerHTML = `
          <div class="section">
            <h3>Inventory</h3>
            <div class="input-group">
              <label>Filter Inventory</label>
              <input id="inventory-search" type="text" placeholder="Search by Name or Set" value="${searchTerm}">
            </div>
            <table class="inventory-table">
              <thead>
                <tr>
                  <th data-sort="id">ID</th>
                  <th data-sort="name">Name</th>
                  <th data-sort="price">Price</th>
                  <th>Trade Value</th>
                  <th data-sort="stock">Stock</th>
                  <th data-sort="condition">Condition</th>
                  <th data-sort="card_set">Set</th>
                  <th data-sort="rarity">Rarity</th>
                  <th>Image</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${paginatedItems.map(item => `
                  <tr>
                    <td>${item.id}</td>
                    <td><input id="name-${item.id}" value="${item.name}" disabled></td>
                    <td><input id="price-${item.id}" type="number" value="${item.price}" disabled></td>
                    <td>${cleanPrice(item.trade_value || Math.floor(item.price * 0.5))}</td>
                    <td>${item.stock}</td>
                    <td><input id="condition-${item.id}" value="${item.condition || ''}" disabled></td>
                    <td><input id="card_set-${item.id}" value="${item.card_set || ''}" disabled></td>
                    <td><input id="rarity-${item.id}" value="${item.rarity || ''}" disabled></td>
                    <td>${item.image_url ? `<img src="${item.image_url}" alt="${item.name}" style="max-width: 50px;">` : 'No Image'}</td>
                    <td>
                      <button class="edit-item" data-id="${item.id}">Edit</button>
                      <button class="save-item" data-id="${item.id}" style="display: none;">Save</button>
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

        const table = document.querySelector('.inventory-table');
        table.querySelectorAll('th[data-sort]').forEach(th => {
          th.addEventListener('click', () => {
            const key = th.dataset.sort;
            if (key === currentSortKey) isAsc = !isAsc;
            else {
              currentSortKey = key;
              isAsc = true;
            }
            sortedItems.sort((a, b) => {
              const aVal = a[key] || '';
              const bVal = b[key] || '';
              return isAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
            });
            th.classList.toggle('asc', isAsc);
            renderInventory(sortedItems);
          });
        });

        document.getElementById('inventory-search').addEventListener('input', debounce((e) => {
          searchTerm = e.target.value.toLowerCase();
          applyFilters();
        }, 600));

        document.getElementById('prev-page').addEventListener('click', () => {
          if (currentPage > 1) {
            currentPage--;
            renderInventory(sortedItems);
          }
        });
        document.getElementById('next-page').addEventListener('click', () => {
          if (currentPage < totalPages) {
            currentPage++;
            renderInventory(sortedItems);
          }
        });

        document.querySelectorAll('.edit-item').forEach(button => {
          button.addEventListener('click', () => {
            const id = button.dataset.id;
            button.style.display = 'none';
            document.querySelector(`.save-item[data-id="${id}"]`).style.display = 'inline';
            ['name', 'price', 'condition', 'card_set', 'rarity'].forEach(field => {
              document.getElementById(`${field}-${id}`).disabled = false;
            });
          });
        });

        document.querySelectorAll('.save-item').forEach(button => {
          button.addEventListener('click', () => {
            const id = button.dataset.id;
            const updatedItem = {
              id,
              name: document.getElementById(`name-${id}`).value,
              price: parseFloat(document.getElementById(`price-${id}`).value) || 0,
              condition: document.getElementById(`condition-${id}`).value,
              card_set: document.getElementById(`card_set-${id}`).value,
              rarity: document.getElementById(`rarity-${id}`).value
            };
            ipcRenderer.send('update-inventory-item', updatedItem);
            ipcRenderer.once('update-inventory-success', () => {
              button.style.display = 'none';
              document.querySelector(`.edit-item[data-id="${id}"]`).style.display = 'inline';
              ['name', 'price', 'condition', 'card_set', 'rarity'].forEach(field => {
                document.getElementById(`${field}-${id}`).disabled = true;
              });
              allItems = allItems.map(i => i.id === id ? { ...i, ...updatedItem } : i);
              renderInventory(allItems);
            });
            ipcRenderer.once('update-inventory-error', (event, error) => console.error('Update failed:', error));
          });
        });
      }

      function applyFilters() {
        let filtered = allItems;
        if (searchTerm) {
          filtered = filtered.filter(item => 
            item.name.toLowerCase().includes(searchTerm) || 
            (item.card_set || '').toLowerCase().includes(searchTerm)
          );
        }
        sortedItems = filtered.sort((a, b) => {
          const aVal = a[currentSortKey] || '';
          const bVal = b[currentSortKey] || '';
          return isAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        });
        currentPage = 1;
        renderInventory(sortedItems);
      }

      renderInventory(allItems);
    });
  }
}

function fetchInventory(context, page, searchTerm) {
  ipcRenderer.send('get-inventory', { page, limit: itemsPerPage, search: searchTerm });
  ipcRenderer.once('inventory-data', (event, { items, total }) => {
    if (context === 'sell') {
      renderSellTab(items, total);
      sellPage = page;
    } else if (context === 'trade-out') {
      renderTradeTab(items, total);
      tradeOutPage = page;
    }
  });
}

function renderSellTab(inventory, total) {
  console.log('Rendering Sell tab with:', { inventory, total });
  const totalListed = sellCart.reduce((sum, item) => sum + item.price, 0);
  const totalNegotiated = sellCart.reduce((sum, item) => sum + (item.negotiatedPrice || item.price), 0);
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
      <p>Total Listed: ${cleanPrice(totalListed.toFixed(2))}, Items: ${sellCart.length}</p>
      <p>Total Negotiated: ${cleanPrice(totalNegotiated.toFixed(2))}</p>
      <button onclick="completeSellTransaction()">Complete Sell</button>
      <button id="clear-sell-cart">Clear Cart</button>
    </div>
  `;
  document.getElementById('sell-search').addEventListener('input', debounce((e) => {
    sellSearchTerm = e.target.value;
    fetchInventory('sell', 1, sellSearchTerm);
  }, 600));
  document.getElementById('clear-sell-cart').addEventListener('click', clearSellCart);
}

function renderTradeTab(inventory, total) {
  const tradeInTotal = tradeInCart.reduce((sum, item) => sum + item.tradeValue, 0);
  const tradeOutTotal = tradeOutCart.reduce((sum, item) => sum + (item.negotiatedPrice || item.price), 0);
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
            <button id="fetch-trade-in-card">Fetch Card</button>
          </div>
          <div id="tcg-modal-trade-in" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000;">
            <div style="background: white; margin: 50px auto; padding: 20px; width: 80%; max-height: 80%; overflow-y: auto;">
              <h4>Select a Card</h4>
              <div id="tcg-card-list-trade-in" style="display: flex; flex-wrap: wrap; gap: 20px;"></div>
              <button id="close-tcg-modal-trade-in">Close</button>
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
          <p>Total Trade-In Value: ${cleanPrice(tradeInTotal.toFixed(2))}, Items: ${tradeInCart.length}</p>
          <button id="clear-trade-in-cart">Clear Cart</button>
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
          <p>Total Trade-Out Value: ${cleanPrice(tradeOutTotal.toFixed(2))}, Items: ${tradeOutCart.length}</p>
          <p>Cash Due: ${cleanPrice(cashDue.toFixed(2))}</p>
          ${cashBack > 0 ? `<p>Cash Back: ${cleanPrice(cashBack.toFixed(2))}</p>` : ''}
          <button onclick="completeTradeTransaction()">Complete Trade</button>
          <button id="clear-trade-out-cart">Clear Cart</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('trade-out-search').addEventListener('input', debounce((e) => {
    tradeOutSearchTerm = e.target.value;
    fetchInventory('trade-out', 1, tradeOutSearchTerm);
  }, 600));
  document.getElementById('fetch-trade-in-card').addEventListener('click', () => fetchTcgCard('trade-in'));
  document.getElementById('close-tcg-modal-trade-in').addEventListener('click', () => closeTcgModal('trade-in'));
  document.getElementById('clear-trade-in-cart').addEventListener('click', clearTradeInCart);
  document.getElementById('clear-trade-out-cart').addEventListener('click', clearTradeOutCart);
}

function addToSellCart(id, name, price, image_url, card_set, condition) {
  sellCart.push({ id, name, price, image_url, card_set, condition, role: 'sold' });
  renderSellTab(inventory, totalPages);
}

function updateSellPrice(id, value) {
  const index = sellCart.findIndex(item => item.id === id);
  if (index !== -1) sellCart[index].negotiatedPrice = parseFloat(value) || sellCart[index].price;
  renderSellTab(inventory, totalPages);
}

function addToTradeInCart() {
  const conditionCategory = document.getElementById('trade-in-condition-category').value;
  const conditionValue = document.getElementById('trade-in-condition-value').value;
  const condition = conditionCategory ? `${conditionCategory}${conditionValue ? ' ' + conditionValue : ''}` : conditionValue;
  const tradeInItem = {
    id: Date.now().toString(),
    name: document.getElementById('trade-in-name').value,
    type: document.getElementById('trade-in-type').value,
    price: parseFloat(document.getElementById('trade-in-price').value) || 0,
    tradeValue: parseFloat(document.getElementById('trade-in-value').value) || 0,
    condition: condition || null,
    image_url: document.getElementById('trade-in-image-url').value || null,
    tcg_id: document.getElementById('trade-in-tcg-id').value || null,
    card_set: document.getElementById('trade-in-card-set').value || null,
    rarity: document.getElementById('trade-in-rarity').value || null,
    role: 'trade_in'
  };
  tradeInCart.push(tradeInItem);
  ipcRenderer.send('add-item', tradeInItem);
  ipcRenderer.once('add-item-success', () => renderTradeTab(inventory, totalPages));
  ipcRenderer.once('add-item-error', (event, error) => console.error('Add item failed:', error));
}

function addToTradeOutCart(id, name, price, image_url, card_set, condition) {
  tradeOutCart.push({ id, name, price, image_url, card_set, condition, role: 'trade_out' });
  renderTradeTab(inventory, totalPages);
}

function updateTradeOutPrice(id, value) {
  const index = tradeOutCart.findIndex(item => item.id === id);
  if (index !== -1) tradeOutCart[index].negotiatedPrice = parseFloat(value) || tradeOutCart[index].price;
  renderTradeTab(inventory, totalPages);
}

function fetchTcgCard(context) {
  const input = document.getElementById(`${context}-tcg-card-name`);
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
    if (!cardList) {
      console.error(`No card list found for context: ${context}`);
      return;
    }
    cardList.innerHTML = '';
    cards.forEach((card, index) => {
      const cardDiv = document.createElement('div');
      cardDiv.style = 'border: 1px solid #ccc; padding: 10px; width: 200px; text-align: center;';
      cardDiv.innerHTML = `
        <img src="${card.image_url}" alt="${card.name}" style="width: auto; height: auto; max-width: 180px; max-height: 250px;">
        <p><strong>${card.name}</strong></p>
        <p>Set: ${card.card_set}</p>
        <p>Rarity: ${card.rarity}</p>
        <p>Price: ${cleanPrice(card.price.toFixed(2))}</p>
        <button class="select-tcg-card" data-index="${index}">Select</button>
      `;
      cardList.appendChild(cardDiv);
    });
    const modal = document.getElementById(`tcg-modal-${context}`);
    if (modal) modal.style.display = 'flex';

    document.querySelectorAll(`#tcg-card-list-${context} .select-tcg-card`).forEach(button => {
      button.addEventListener('click', () => {
        const index = parseInt(button.dataset.index);
        selectTcgCard(cards[index], context);
      });
    });
  });
  ipcRenderer.once('tcg-card-error', (event, error) => console.error(`TCG card fetch failed for ${context}:`, error));
}

function selectTcgCard(card, context) {
  console.log(`Selected TCG card for ${context}:`, card);
  const prefix = context === 'trade-in' ? 'trade-in' : context;
  const nameField = document.getElementById(`${prefix}-name`);
  const typeField = document.getElementById(`${prefix}-type`);
  const priceField = document.getElementById(`${prefix}-price`);
  const tradeValueField = document.getElementById(`${prefix}-trade-value`) || document.getElementById(`${prefix}-value`);
  const conditionCategoryField = document.getElementById(`${prefix}-condition-category`);
  const conditionValueField = document.getElementById(`${prefix}-condition-value`);
  const tcgIdField = document.getElementById(`${prefix}-tcg-id`);
  const cardSetField = document.getElementById(`${prefix}-card-set`);
  const rarityField = document.getElementById(`${prefix}-rarity`);
  const imageUrlField = document.getElementById(`${prefix}-image-url`);

  if (!nameField) console.error(`No ${prefix}-name field found`);
  if (!typeField) console.error(`No ${prefix}-type field found`);
  if (!priceField) console.error(`No ${prefix}-price field found`);
  if (!tradeValueField) console.error(`No ${prefix}-trade-value/value field found`);

  if (nameField) nameField.value = card.name;
  if (typeField) typeField.value = card.type;
  if (priceField) priceField.value = card.price;
  if (tradeValueField) tradeValueField.value = Math.floor(card.price * 0.5);
  if (conditionCategoryField) conditionCategoryField.value = '';
  if (conditionValueField) conditionValueField.value = card.condition || '';
  if (tcgIdField) tcgIdField.value = card.tcg_id || '';
  if (cardSetField) cardSetField.value = card.card_set || '';
  if (rarityField) rarityField.value = card.rarity || '';
  if (imageUrlField) imageUrlField.value = card.image_url || '';
  
  closeTcgModal(context);
}

function closeTcgModal(context) {
  document.getElementById(`tcg-modal-${context}`).style.display = 'none';
}

function completeSellTransaction() {
  console.log('Completing sell transaction:', { sellCart });
  const items = sellCart.slice();
  const cashIn = sellCart.reduce((sum, item) => sum + parseFloat(item.negotiatedPrice || item.price), 0);
  const cashOut = 0;
  ipcRenderer.send('complete-transaction', { items, type: 'sell', cashIn, cashOut });
  ipcRenderer.once('transaction-complete', (event, data) => {
    console.log('Sell transaction completed');
    sellCart.length = 0;
    showScreen('sell');
  });
  ipcRenderer.once('transaction-error', (event, error) => console.error('Sell transaction failed:', error));
}

function completeBuyTransaction() {
  console.log('Completing buy transaction:', { buyItems });
  const items = buyItems.slice();
  const cashIn = 0;
  const cashOut = buyItems.reduce((sum, item) => sum + parseFloat(item.tradeValue), 0);
  ipcRenderer.send('complete-transaction', { items, type: 'buy', cashIn, cashOut });
  ipcRenderer.once('transaction-complete', (event, data) => {
    console.log('Buy transaction completed');
    buyItems.length = 0;
    showScreen('buy');
  });
  ipcRenderer.once('transaction-error', (event, error) => console.error('Buy transaction failed:', error));
}

function completeTradeTransaction() {
  console.log('Completing trade transaction:', { tradeInCart, tradeOutCart });
  const items = [...tradeInCart, ...tradeOutCart];
  const cashIn = tradeOutCart.reduce((sum, item) => sum + parseFloat(item.negotiatedPrice || item.price), 0);
  const cashOut = tradeInCart.reduce((sum, item) => sum + parseFloat(item.tradeValue), 0);
  ipcRenderer.send('complete-transaction', { items, type: 'trade', cashIn, cashOut });
  ipcRenderer.once('transaction-complete', (event, data) => {
    console.log('Trade transaction completed');
    tradeInCart.length = 0;
    tradeOutCart.length = 0;
    showScreen('trade');
  });
  ipcRenderer.once('transaction-error', (event, error) => console.error('Trade transaction failed:', error));
}

function addToBuy() {
  const conditionCategory = document.getElementById('buy-condition-category').value;
  const conditionValue = document.getElementById('buy-condition-value').value;
  const condition = conditionCategory ? `${conditionCategory}${conditionValue ? ' ' + conditionValue : ''}` : conditionValue;
  const buyItem = {
    id: Date.now().toString(),
    name: document.getElementById('buy-name').value,
    type: document.getElementById('buy-type').value,
    price: parseFloat(document.getElementById('buy-price').value) || 0,
    tradeValue: parseFloat(document.getElementById('buy-trade-value').value) || 0,
    condition: condition || null,
    image_url: document.getElementById('buy-image-url').value || null,
    tcg_id: document.getElementById('buy-tcg-id').value || null,
    card_set: document.getElementById('buy-card-set').value || null,
    rarity: document.getElementById('buy-rarity').value || null,
    role: 'trade_in'
  };
  buyItems.push(buyItem);
  console.log('Adding to buy:', buyItem);
  ipcRenderer.send('add-item', buyItem);
  ipcRenderer.once('add-item-success', () => showScreen('buy'));
  ipcRenderer.once('add-item-error', (event, error) => console.error('Add item failed:', error));
}

function clearSellCart() {
  sellCart.length = 0;
  fetchInventory('sell', sellPage, sellSearchTerm);
}

function clearBuyCart() {
  buyItems.length = 0;
  showScreen('buy');
}

function clearTradeInCart() {
  tradeInCart.length = 0;
  fetchInventory('trade-out', tradeOutPage, tradeOutSearchTerm);
}

function clearTradeOutCart() {
  tradeOutCart.length = 0;
  fetchInventory('trade-out', tradeOutPage, tradeOutSearchTerm);
}

// Initial render
showScreen('sell');