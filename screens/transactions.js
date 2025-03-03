// Imports required modules for Electron communication and utilities
const { ipcRenderer } = require('electron');  // Electron IPC for communicating with main process
const { cleanPrice, debounce } = require('../utils');  // Utility functions: cleanPrice formats prices, debounce delays event handling

// Renders the Transactions tab UI with transaction data
function render() {
  const content = document.getElementById('content');  // Gets the main content container from the DOM
  ipcRenderer.send('get-transactions');  // Requests all transaction data from the main process
  // Handles incoming transaction data from the main process
  ipcRenderer.once('transactions-data', (event, rows) => {
    const transactions = {};  // Object to group transactions by ID
    // Groups rows by transaction ID into a structured object
    rows.forEach(row => {
      const txId = row.transaction_id;  // Transaction ID from each row
      if (!transactions[txId]) {
        transactions[txId] = { 
          id: txId,  // Unique transaction ID
          type: row.transaction_type,  // Transaction type (buy, sell, trade)
          cash_in: row.cash_in,  // Cash received in transaction
          cash_out: row.cash_out,  // Cash paid out in transaction
          timestamp: row.timestamp,  // Transaction timestamp
          items: []  // Array to hold associated items
        };
      }
      if (row.item_id) {  // If row includes an item
        const attributes = row.attributes ? JSON.parse(row.attributes) : {};  // Parses item attributes, defaults to empty object
        transactions[txId].items.push({
          item_id: row.item_id,  // Unique item ID
          name: row.item_name,  // Item name
          role: row.role,  // Item role (trade_in, trade_out, sold)
          trade_value: row.trade_value,  // Trade value for trade-ins
          negotiated_price: row.negotiated_price,  // Negotiated price for sales/trade-outs
          original_price: row.original_price,  // Original listed price
          image_url: row.image_url,  // URL of item image
          condition: row.condition,  // Item condition
          type: row.type,  // Item type (e.g., pokemon_tcg)
          attributes  // Item-specific attributes
        });
      }
    });

    // Converts transactions object to array for sorting and filtering
    let allTransactions = Object.entries(transactions);  // Array of [id, transaction] pairs
    let sortedTransactions = allTransactions.sort((a, b) => new Date(b[1].timestamp) - new Date(a[1].timestamp));  // Default sort by timestamp descending
    let currentSortKey = 'timestamp';  // Tracks current sorting column
    let isAsc = false;  // Tracks sort direction (false for descending initially)
    let searchTerm = '';  // Holds current search filter
    let startDate = '';  // Start date filter
    let endDate = '';  // End date filter
    let currentPage = 1;  // Tracks current page for pagination
    const itemsPerPage = 10;  // Number of transactions per page

    // Renders the transaction table with pagination and filters applied
    function renderTransactions(filteredTransactions) {
      const totalCashIn = filteredTransactions.reduce((sum, [, tx]) => sum + (parseFloat(tx.cash_in) || 0), 0);  // Calculates total cash received
      const totalCashOut = filteredTransactions.reduce((sum, [, tx]) => sum + (parseFloat(tx.cash_out) || 0), 0);  // Calculates total cash paid
      const totalPages = Math.ceil(filteredTransactions.length / itemsPerPage);  // Calculates total pages for pagination
      const startIndex = (currentPage - 1) * itemsPerPage;  // Start index for current page
      const paginatedTransactions = filteredTransactions.slice(startIndex, startIndex + itemsPerPage);  // Slices transactions for current page

      // Calculates transaction type statistics
      const stats = {
        total: filteredTransactions.length,  // Total number of transactions
        sells: filteredTransactions.filter(([, tx]) => tx.type === 'sell').length,  // Number of sell transactions
        buys: filteredTransactions.filter(([, tx]) => tx.type === 'buy').length,  // Number of buy transactions
        trades: filteredTransactions.filter(([, tx]) => tx.type === 'trade').length  // Number of trade transactions
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
      `;  // Sets the HTML content for the Transactions tab

      // Adds sorting functionality to table headers
      const table = document.querySelector('.transactions-table');
      table.querySelectorAll('th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
          const key = th.dataset.sort;  // Gets column key to sort by
          if (key === 'timestamp') {
            isAsc = !isAsc;  // Toggles direction for timestamp
            sortedTransactions.sort((a, b) => isAsc 
              ? new Date(a[1].timestamp) - new Date(b[1].timestamp)  // Ascending by timestamp
              : new Date(b[1].timestamp) - new Date(a[1].timestamp));  // Descending by timestamp
          } else {
            if (key === currentSortKey) isAsc = !isAsc;  // Toggles direction if same key
            else {
              currentSortKey = key;  // Sets new sort key
              isAsc = false;  // Defaults to descending
            }
            sortedTransactions.sort((a, b) => isAsc 
              ? (a[1][key] || 0) - (b[1][key] || 0)  // Ascending numeric sort
              : (b[1][key] || 0) - (a[1][key] || 0));  // Descending numeric sort
          }
          th.classList.toggle('asc', isAsc);  // Updates sort direction indicator
          renderTransactions(sortedTransactions);  // Re-renders with sorted transactions
        });
      });

      // Adds search filter with debounce to reduce re-renders
      document.getElementById('transactions-search').addEventListener('input', debounce((e) => {
        searchTerm = e.target.value.toLowerCase();  // Updates search term
        applyFilters();  // Applies filters and re-renders
      }, 600));  // 600ms delay for debounce

      // Adds start date filter
      document.getElementById('transactions-start-date').addEventListener('change', (e) => {
        startDate = e.target.value;  // Updates start date
        applyFilters();  // Applies filters and re-renders
      });
      
      // Adds end date filter
      document.getElementById('transactions-end-date').addEventListener('change', (e) => {
        endDate = e.target.value;  // Updates end date
        applyFilters();  // Applies filters and re-renders
      });

      // Pagination: Previous page button
      document.getElementById('prev-page').addEventListener('click', () => {
        if (currentPage > 1) {
          currentPage--;  // Decrements page number
          renderTransactions(sortedTransactions);  // Re-renders with previous page
        }
      });
      
      // Pagination: Next page button
      document.getElementById('next-page').addEventListener('click', () => {
        if (currentPage < totalPages) {
          currentPage++;  // Increments page number
          renderTransactions(sortedTransactions);  // Re-renders with next page
        }
      });

      // Exports transactions to CSV
      document.getElementById('export-csv').addEventListener('click', () => {
        let csvContent = 'ID,Type,Cash In,Cash Out,Timestamp,Items\n';  // CSV header
        filteredTransactions.forEach(([id, tx]) => {  // Uses filteredTransactions from closure
          const itemsStr = tx.items.map(item => 
            `${item.name} (${item.type}${formatAttributes(item.attributes)}) (${item.condition || 'Not Set'}) (${item.role === 'trade_in' ? 'Trade-In' : item.role === 'trade_out' ? 'Trade-Out' : 'Sold'}) - ${item.role === 'trade_in' ? cleanPrice(item.trade_value || 0) : cleanPrice(item.negotiated_price || item.original_price || 0)}`
          ).join('; ');  // Formats items as a single string
          csvContent += `${id},${tx.type || 'Unknown'},${cleanPrice(tx.cash_in || 0)},${cleanPrice(tx.cash_out || 0)},${tx.timestamp},"${itemsStr.replace(/"/g, '""')}"\n`;  // Adds transaction row
        });
        const blob = new Blob([csvContent], { type: 'text/csv' });  // Creates CSV blob
        const url = window.URL.createObjectURL(blob);  // Creates temporary URL
        const a = document.createElement('a');
        a.href = url;
        a.download = `transactions_${new Date().toISOString().split('T')[0]}.csv`;  // Sets filename with date
        a.click();  // Triggers download
        window.URL.revokeObjectURL(url);  // Cleans up URL
      });

      // Binds toggle events for showing/hiding item details
      function bindToggleEvents() {
        document.querySelectorAll('.toggle-items').forEach(button => {
          button.addEventListener('click', () => {
            const id = button.dataset.id;  // Gets transaction ID from button
            const itemsList = document.getElementById(`items-${id}`);  // Gets items list for transaction
            const isVisible = itemsList.style.display !== 'none';  // Checks current visibility
            itemsList.style.display = isVisible ? 'none' : 'block';  // Toggles visibility
            button.textContent = isVisible ? 'Show Items' : 'Hide Items';  // Updates button text
          });
        });
      }
      bindToggleEvents();  // Applies toggle events to current items

      // Binds print receipt button events
      document.querySelectorAll('.print-receipt').forEach(button => {
        button.addEventListener('click', () => {
          const transactionId = button.dataset.transactionId;  // Gets transaction ID from button
          const transaction = transactions[transactionId];  // Retrieves transaction data
          ipcRenderer.send('generate-receipt', transaction);  // Sends print request to main process
        });
      });

      // Applies search and date filters to the transaction list
      function applyFilters() {
        let filtered = allTransactions;  // Starts with all transactions
        if (searchTerm) {
          filtered = filtered.filter(([id, tx]) => {
            const itemNames = tx.items.map(item => item.name.toLowerCase()).join(' ');  // Combines item names for search
            const itemConditions = tx.items.map(item => (item.condition || '').toLowerCase()).join(' ');  // Combines conditions
            return (
              id.toLowerCase().includes(searchTerm) ||  // Filters by ID
              (tx.type || '').toLowerCase().includes(searchTerm) ||  // Filters by type
              itemNames.includes(searchTerm) ||  // Filters by item names
              itemConditions.includes(searchTerm)  // Filters by conditions
            );
          });
        }
        if (startDate) {
          filtered = filtered.filter(([, tx]) => new Date(tx.timestamp) >= new Date(startDate));  // Filters by start date
        }
        if (endDate) {
          filtered = filtered.filter(([, tx]) => new Date(tx.timestamp) <= new Date(endDate));  // Filters by end date
        }
        sortedTransactions = filtered.sort((a, b) => {
          const aVal = currentSortKey === 'timestamp' ? new Date(a[1][currentSortKey]) : (a[1][currentSortKey] || 0);  // Gets sort value
          const bVal = currentSortKey === 'timestamp' ? new Date(b[1][currentSortKey]) : (b[1][currentSortKey] || 0);
          return isAsc ? aVal - bVal : bVal - aVal;  // Sorts based on current key and direction
        });
        currentPage = 1;  // Resets to first page after filtering
        renderTransactions(sortedTransactions);  // Re-renders with filtered transactions
      }

      // Formats item attributes for display as a string
      function formatAttributes(attributes) {
        if (!attributes || Object.keys(attributes).length === 0) return '';  // Returns empty string if no attributes
        return ' - ' + Object.entries(attributes).map(([key, value]) => `${key}: ${value}`).join(', ');  // Formats attributes as "key: value"
      }
    }

    renderTransactions(sortedTransactions);  // Initial render with all transactions
  });
}

// Handles receipt generation confirmation from the main process
ipcRenderer.on('receipt-generated', (event, filePath) => {
  console.log('Receipt opened:', filePath);  // Logs when receipt is successfully opened
});

// Exports the render function for use in the main process navigation
module.exports = { render };