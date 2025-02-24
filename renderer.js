const { ipcRenderer } = require('electron');

let cart = [];
let tradedItems = [];
let buyItems = [];

function showScreen(screen) {
  const content = document.getElementById('content');
  if (screen === 'pos') {
    ipcRenderer.send('get-inventory');
    ipcRenderer.on('inventory-data', (event, inventory) => {
      content.innerHTML = `
        <h3>Sell to Customer</h3>
        <div>
          <h4>Inventory</h4>
          <ul>
            ${inventory.map(item => `
              <li>${item.name} (£${item.price}) <button onclick="addToCart('${item.id}', '${item.name}', ${item.price})">Add</button></li>
            `).join('')}
          </ul>
        </div>
        <div>
          <h4>Cart</h4>
          <ul id="cart-items">
            ${cart.map(item => `
              <li>
                ${item.name} - 
                <input type="number" value="${item.negotiatedPrice}" onchange="updatePrice('${item.id}', this.value)" style="width: 60px;">
                (Original: £${item.price})
              </li>
            `).join('')}
          </ul>
          <p>Total: £${cart.reduce((sum, item) => sum + (item.negotiatedPrice || item.price), 0).toFixed(2)}</p>
          ${tradedItems.length > 0 ? `<p>Trade Credit: £${tradedItems.reduce((sum, item) => sum + item.tradeValue, 0).toFixed(2)}</p>` : ''}
          <button onclick="completeTransaction('sell')">Complete Sell</button>
        </div>
      `;
    });
  } else if (screen === 'buy') {
    content.innerHTML = `
      <h3>Buy from Customer</h3>
      <input id="buy-name" placeholder="Name">
      <input id="buy-type" placeholder="Type (e.g., pokemon_card)">
      <input id="buy-price" type="number" placeholder="Market Price">
      <input id="buy-trade-value" type="number" placeholder="Trade Value">
      <button onclick="addToBuy()">Add Item</button>
      <ul id="buy-items">
        ${buyItems.map(item => `
          <li>${item.name} - £${item.tradeValue}</li>
        `).join('')}
      </ul>
      <p>Total Payout: £${buyItems.reduce((sum, item) => sum + item.tradeValue, 0).toFixed(2)}</p>
      <button onclick="completeBuy()">Complete Buy</button>
      <button onclick="proceedToTrade()">Proceed to Trade</button>
    `;
  } else if (screen === 'transactions') {
    ipcRenderer.send('get-transactions');
    ipcRenderer.on('transactions-data', (event, transactions) => {
      content.innerHTML = `
        <h3>Transactions</h3>
        <ul>
          ${transactions.map(tx => `
            <li>ID: ${tx.id}, Type: ${tx.type}, Cash In: £${tx.cash_in || 0}, Cash Out: £${tx.cash_out || 0}, Time: ${tx.timestamp}</li>
          `).join('')}
        </ul>
      `;
    });
  }
}

function addToCart(id, name, price) {
  cart.push({ id, name, price, negotiatedPrice: price, role: 'sold' });
  showScreen('pos');
}

function updatePrice(id, newPrice) {
  cart = cart.map(item => item.id === id ? { ...item, negotiatedPrice: parseFloat(newPrice) || item.price } : item);
  showScreen('pos');
}

function completeTransaction(type) {
  const items = type === 'sell' ? cart : [...tradedItems, ...cart];
  const cashIn = type === 'sell' ? cart.reduce((sum, item) => sum + (item.negotiatedPrice || item.price), 0) : 0;
  const cashOut = type === 'buy' ? buyItems.reduce((sum, item) => sum + item.tradeValue, 0) : 0;
  ipcRenderer.send('complete-transaction', { items, type, cashIn, cashOut });
  ipcRenderer.on('transaction-complete', () => {
    cart = [];
    tradedItems = [];
    buyItems = [];
    showScreen('pos');
  });
}

function addToBuy() {
  const name = document.getElementById('buy-name').value;
  const type = document.getElementById('buy-type').value;
  const price = parseFloat(document.getElementById('buy-price').value) || 0;
  const tradeValue = parseFloat(document.getElementById('buy-trade-value').value) || 0;
  const id = Date.now().toString();
  buyItems.push({ id, name, type, price, tradeValue, role: 'trade_in' });
  showScreen('buy');
}

function completeBuy() {
  completeTransaction('buy');
}

function proceedToTrade() {
  tradedItems = buyItems;
  buyItems = [];
  showScreen('pos');
}

// Initial load
showScreen('pos');