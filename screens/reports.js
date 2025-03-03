// Imports required modules for Electron communication and price formatting
const { ipcRenderer } = require('electron');  // Electron IPC for communicating with main process
const { cleanPrice } = require('../utils');  // Utility function to format prices with £ symbol

// Renders the Reports tab UI with cash reconciliation and past records
function render() {
  const content = document.getElementById('content');  // Gets the main content container from the DOM
  content.innerHTML = `
    <div class="section">
      <h3>Reports</h3>
      <button id="reconcile-cash">Reconcile Cash</button>
      <div id="reconciliation-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000;">
        <div style="background: #2C2F33; margin: 50px auto; padding: 20px; width: 400px; border-radius: 4px;">
          <h4>Cash Reconciliation</h4>
          <div class="input-group">
            <label>Date Range</label>
            <input id="reconcile-start-date" type="date">
            <input id="reconcile-end-date" type="date">
          </div>
          <div class="input-group">
            <label>Starting Cash (\u00A3)</label>
            <input id="reconcile-starting-cash" type="number" step="0.01" value="0">
          </div>
          <div class="input-group">
            <label>Total Cash In (\u00A3)</label>
            <input id="reconcile-cash-in" type="number" step="0.01" disabled>
          </div>
          <div class="input-group">
            <label>Total Cash Out (\u00A3)</label>
            <input id="reconcile-cash-out" type="number" step="0.01" disabled>
          </div>
          <div class="input-group">
            <label>Expected Cash (\u00A3)</label>
            <input id="reconcile-expected-cash" type="number" step="0.01" disabled>
          </div>
          <div class="input-group">
            <label>Actual Cash (\u00A3)</label>
            <input id="reconcile-actual-cash" type="number" step="0.01" value="0">
          </div>
          <div class="input-group">
            <label>Discrepancy (\u00A3)</label>
            <input id="reconcile-discrepancy" type="number" step="0.01" disabled>
          </div>
          <div class="input-group">
            <label>Notes</label>
            <textarea id="reconcile-notes" placeholder="e.g., Short due to miscount" rows="3" style="width: 100%; padding: 8px;"></textarea>
          </div>
          <button id="save-reconciliation">Save</button>
          <button id="close-reconciliation">Close</button>
        </div>
      </div>
      <h4>Previous Reconciliations</h4>
      <table class="reconciliations-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Starting Cash</th>
            <th>Total Cash In</th>
            <th>Total Cash Out</th>
            <th>Expected Cash</th>
            <th>Actual Cash</th>
            <th>Discrepancy</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody id="reconciliations-list"></tbody>
      </table>
    </div>
  `;  // Sets the HTML content for the Reports tab with reconciliation modal and table

  // Requests all past reconciliations from the main process
  ipcRenderer.send('get-reconciliations');  // Sends request to fetch reconciliation data
  
  // Handles received reconciliation data
  ipcRenderer.once('reconciliations-data', (event, rows) => {
    const tbody = document.getElementById('reconciliations-list');  // Gets table body for past reconciliations
    tbody.innerHTML = rows.map(row => `
      <tr>
        <td>${new Date(row.date).toLocaleString()}</td>  // Formats date as local string
        <td>${cleanPrice(row.starting_cash.toFixed(2))}</td>  // Formats starting cash
        <td>${cleanPrice(row.total_cash_in.toFixed(2))}</td>  // Formats total cash in
        <td>${cleanPrice(row.total_cash_out.toFixed(2))}</td>  // Formats total cash out
        <td>${cleanPrice(row.expected_cash.toFixed(2))}</td>  // Formats expected cash
        <td>${cleanPrice(row.actual_cash.toFixed(2))}</td>  // Formats actual cash
        <td>${cleanPrice(row.discrepancy.toFixed(2))}</td>  // Formats discrepancy
        <td>${row.notes || ''}</td>  // Displays notes or empty string if none
      </tr>
    `).join('');  // Populates table with reconciliation rows
  });

  // Opens the reconciliation modal and fetches cash totals
  document.getElementById('reconcile-cash').addEventListener('click', () => {
    const modal = document.getElementById('reconciliation-modal');  // Gets reconciliation modal
    modal.style.display = 'flex';  // Shows the modal
    const startDate = document.getElementById('reconcile-start-date').value;  // Gets start date input
    const endDate = document.getElementById('reconcile-end-date').value;  // Gets end date input
    ipcRenderer.send('get-cash-totals', { startDate, endDate });  // Requests cash totals for date range
  });

  // Updates modal fields with cash totals received from main process
  ipcRenderer.on('cash-totals-data', (event, { total_cash_in, total_cash_out }) => {
    const startingCashInput = document.getElementById('reconcile-starting-cash');  // Starting cash input
    const cashInInput = document.getElementById('reconcile-cash-in');  // Total cash in input
    const cashOutInput = document.getElementById('reconcile-cash-out');  // Total cash out input
    const expectedCashInput = document.getElementById('reconcile-expected-cash');  // Expected cash input
    
    cashInInput.value = total_cash_in.toFixed(2);  // Sets total cash in
    cashOutInput.value = total_cash_out.toFixed(2);  // Sets total cash out
    
    // Updates expected cash and discrepancy when inputs change
    function updateCalculations() {
      const startingCash = parseFloat(startingCashInput.value) || 0;  // Parses starting cash, defaults to 0
      const totalCashIn = parseFloat(cashInInput.value) || 0;  // Parses total cash in
      const totalCashOut = parseFloat(cashOutInput.value) || 0;  // Parses total cash out
      const expectedCash = startingCash + totalCashIn - totalCashOut;  // Calculates expected cash
      expectedCashInput.value = expectedCash.toFixed(2);  // Updates expected cash field
      updateDiscrepancy();  // Recalculates discrepancy
    }

    startingCashInput.addEventListener('input', updateCalculations);  // Updates on starting cash change
    updateCalculations();  // Runs initial calculation
  });

  // Updates discrepancy when actual cash changes
  document.getElementById('reconcile-actual-cash').addEventListener('input', updateDiscrepancy);

  // Saves the reconciliation data to the main process
  document.getElementById('save-reconciliation').addEventListener('click', () => {
    const reconciliation = {
      date: new Date().toISOString(),  // Current timestamp in ISO format
      starting_cash: parseFloat(document.getElementById('reconcile-starting-cash').value) || 0,  // Starting cash amount
      total_cash_in: parseFloat(document.getElementById('reconcile-cash-in').value) || 0,  // Total cash received
      total_cash_out: parseFloat(document.getElementById('reconcile-cash-out').value) || 0,  // Total cash paid
      expected_cash: parseFloat(document.getElementById('reconcile-expected-cash').value) || 0,  // Calculated expected cash
      actual_cash: parseFloat(document.getElementById('reconcile-actual-cash').value) || 0,  // Actual cash on hand
      discrepancy: parseFloat(document.getElementById('reconcile-discrepancy').value) || 0,  // Difference between expected and actual
      notes: document.getElementById('reconcile-notes').value || ''  // Additional notes
    };
    ipcRenderer.send('save-reconciliation', reconciliation);  // Sends reconciliation data to main process
    ipcRenderer.once('reconciliation-success', () => {
      document.getElementById('reconciliation-modal').style.display = 'none';  // Hides modal on success
      render();  // Refreshes Reports tab to show new reconciliation
    });
  });

  // Closes the reconciliation modal without saving
  document.getElementById('close-reconciliation').addEventListener('click', () => {
    document.getElementById('reconciliation-modal').style.display = 'none';  // Hides the modal
  });

  // Updates the discrepancy field based on expected and actual cash
  function updateDiscrepancy() {
    const expected = parseFloat(document.getElementById('reconcile-expected-cash').value) || 0;  // Parses expected cash
    const actual = parseFloat(document.getElementById('reconcile-actual-cash').value) || 0;  // Parses actual cash
    document.getElementById('reconcile-discrepancy').value = (expected - actual).toFixed(2);  // Sets discrepancy as difference
  }
}

// Exports the render function for use in main process navigation
module.exports = { render };