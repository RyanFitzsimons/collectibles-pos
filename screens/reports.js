const { ipcRenderer } = require('electron');
const { cleanPrice } = require('../utils');

// Render the Reports tab UI with cash reconciliation and past records
function render() {
  const content = document.getElementById('content');
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
  `;

  // Fetch and display reconciliations
  ipcRenderer.send('get-reconciliations');
  ipcRenderer.once('reconciliations-data', (event, rows) => {
    const tbody = document.getElementById('reconciliations-list');
    tbody.innerHTML = rows.map(row => `
      <tr>
        <td>${new Date(row.date).toLocaleString()}</td>
        <td>${cleanPrice(row.starting_cash.toFixed(2))}</td>
        <td>${cleanPrice(row.total_cash_in.toFixed(2))}</td>
        <td>${cleanPrice(row.total_cash_out.toFixed(2))}</td>
        <td>${cleanPrice(row.expected_cash.toFixed(2))}</td>
        <td>${cleanPrice(row.actual_cash.toFixed(2))}</td>
        <td>${cleanPrice(row.discrepancy.toFixed(2))}</td>
        <td>${row.notes || ''}</td>
      </tr>
    `).join('');
  });

  document.getElementById('reconcile-cash').addEventListener('click', () => {
    const modal = document.getElementById('reconciliation-modal');
    modal.style.display = 'flex';
    const startDate = document.getElementById('reconcile-start-date').value;
    const endDate = document.getElementById('reconcile-end-date').value;
    ipcRenderer.send('get-cash-totals', { startDate, endDate });
  });

  ipcRenderer.on('cash-totals-data', (event, { total_cash_in, total_cash_out }) => {
    const startingCashInput = document.getElementById('reconcile-starting-cash');
    const cashInInput = document.getElementById('reconcile-cash-in');
    const cashOutInput = document.getElementById('reconcile-cash-out');
    const expectedCashInput = document.getElementById('reconcile-expected-cash');
    
    cashInInput.value = total_cash_in.toFixed(2);
    cashOutInput.value = total_cash_out.toFixed(2);
    
    function updateCalculations() {
      const startingCash = parseFloat(startingCashInput.value) || 0;
      const totalCashIn = parseFloat(cashInInput.value) || 0;
      const totalCashOut = parseFloat(cashOutInput.value) || 0;
      const expectedCash = startingCash + totalCashIn - totalCashOut;
      expectedCashInput.value = expectedCash.toFixed(2);
      updateDiscrepancy();
    }

    startingCashInput.addEventListener('input', updateCalculations);
    updateCalculations(); // Initial calc
  });

  document.getElementById('reconcile-actual-cash').addEventListener('input', updateDiscrepancy);

  document.getElementById('save-reconciliation').addEventListener('click', () => {
    const reconciliation = {
      date: new Date().toISOString(),
      starting_cash: parseFloat(document.getElementById('reconcile-starting-cash').value) || 0,
      total_cash_in: parseFloat(document.getElementById('reconcile-cash-in').value) || 0,
      total_cash_out: parseFloat(document.getElementById('reconcile-cash-out').value) || 0,
      expected_cash: parseFloat(document.getElementById('reconcile-expected-cash').value) || 0,
      actual_cash: parseFloat(document.getElementById('reconcile-actual-cash').value) || 0,
      discrepancy: parseFloat(document.getElementById('reconcile-discrepancy').value) || 0,
      notes: document.getElementById('reconcile-notes').value || ''
    };
    ipcRenderer.send('save-reconciliation', reconciliation);
    ipcRenderer.once('reconciliation-success', () => {
      document.getElementById('reconciliation-modal').style.display = 'none';
      render(); // Refresh to show new reconciliation
    });
  });

  document.getElementById('close-reconciliation').addEventListener('click', () => {
    document.getElementById('reconciliation-modal').style.display = 'none';
  });

  function updateDiscrepancy() {
    const expected = parseFloat(document.getElementById('reconcile-expected-cash').value) || 0;
    const actual = parseFloat(document.getElementById('reconcile-actual-cash').value) || 0;
    document.getElementById('reconcile-discrepancy').value = (expected - actual).toFixed(2);
  }
}

module.exports = { render };