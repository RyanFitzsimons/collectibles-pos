// Imports
const { ipcRenderer } = require('electron');
const { cleanPrice, debounce } = require('../utils');

// Render the Transactions tab UI with transaction data
function render() {
  const content = document.getElementById('content');
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
        const attributes = row.attributes ? JSON.parse(row.attributes) : {};
        transactions[txId].items.push({
          item_id: row.item_id,
          name: row.item_name,
          role: row.role,
          trade_value: row.trade_value,
          negotiated_price: row.negotiated_price,
          original_price: row.original_price,
          image_url: row.image_url,
          condition: row.condition,
          type: row.type,
          attributes
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
            <input id="transactions-search" type="text" placeholder="Search by ID, Type, Item Name, or Condition" value="${searchTerm}">
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
                <th>Actions</th> <!-- New column for Print Receipt -->
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
                          ${item.name} (${item.type}${formatAttributes(item.attributes)}) (${item.condition || 'Not Set'}) (${item.role === 'trade_in' ? 'Trade-In' : item.role === 'trade_out' ? 'Trade-Out' : 'Sold'}) - 
                          ${item.role === 'trade_in' ? `Trade Value: ${cleanPrice(item.trade_value || 0)}` : `Sold For: ${cleanPrice(item.negotiated_price || item.original_price || 0)}`}
                        </li>
                      `).join('')}
                    </ul>
                  </td>
                  <td>
                    <button class="print-receipt" data-transaction-id="${id}">Print Receipt</button>
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
            `${item.name} (${item.type}${formatAttributes(item.attributes)}) (${item.condition || 'Not Set'}) (${item.role === 'trade_in' ? 'Trade-In' : item.role === 'trade_out' ? 'Trade-Out' : 'Sold'}) - ${item.role === 'trade_in' ? cleanPrice(item.trade_value || 0) : cleanPrice(item.negotiated_price || item.original_price || 0)}`
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

      // Add Print Receipt button handlers
      document.querySelectorAll('.print-receipt').forEach(button => {
        button.addEventListener('click', () => {
          const transactionId = button.dataset.transactionId;
          const transaction = transactions[transactionId];
          ipcRenderer.send('generate-receipt', transaction);
        });
      });

      function applyFilters() {
        let filtered = allTransactions;
        if (searchTerm) {
          filtered = filtered.filter(([id, tx]) => {
            const itemNames = tx.items.map(item => item.name.toLowerCase()).join(' ');
            const itemConditions = tx.items.map(item => (item.condition || '').toLowerCase()).join(' ');
            return (
              id.toLowerCase().includes(searchTerm) ||
              (tx.type || '').toLowerCase().includes(searchTerm) ||
              itemNames.includes(searchTerm) ||
              itemConditions.includes(searchTerm)
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

      function formatAttributes(attributes) {
        if (!attributes || Object.keys(attributes).length === 0) return '';
        return ' - ' + Object.entries(attributes).map(([key, value]) => `${key}: ${value}`).join(', ');
      }
    }

    renderTransactions(sortedTransactions);
  });
}

// Generate receipt to txt file
ipcRenderer.on('receipt-generated', (event, filePath) => {
  console.log('Receipt opened:', filePath);
});

module.exports = { render };