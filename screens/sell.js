const { ipcRenderer } = require('electron');
const { cleanPrice, debounce } = require('../utils');
const { sellCart } = require('../cart'); // Updated import

// Fetch inventory data from main process for Sell tab
function fetchInventory(page, searchTerm) {
  ipcRenderer.send('get-inventory', { page, limit: 50, search: searchTerm });
  ipcRenderer.once('inventory-data', (event, { items, total }) => {
    render(page, searchTerm, sellCart, items, total);
  });
}

// Render the Sell tab UI with inventory and cart
function render(page, searchTerm, cart, inventory = null, total = null) {
  console.log('Rendering Sell tab with:', { inventory, total });
  const content = document.getElementById('content');
  if (!inventory || total === null) {
    fetchInventory(page, searchTerm);
    return;
  }

  const totalListed = cart.reduce((sum, item) => sum + item.price, 0);
  const totalNegotiated = cart.reduce((sum, item) => sum + (parseFloat(item.negotiatedPrice) || item.price), 0);
  const totalPages = Math.ceil(total / 50);
  content.innerHTML = `
    <h3>Sell to Customer</h3>
    <div>
      <h4>Inventory</h4>
      <input id="sell-search" type="text" placeholder="Search inventory (e.g., Charizard, Base Set)" value="${searchTerm}">
      <ul id="sell-inventory-list">
        ${inventory.map(item => `
          <li>
            ${item.image_url ? `<img src="${item.image_url}" alt="${item.name}">` : ''}
            ${item.name} (${item.card_set || 'Unknown Set'}) - ${cleanPrice(item.price)} (${item.condition || 'Not Set'}) 
            <button class="add-to-sell-cart" data-id="${item.id}" data-name="${item.name}" data-price="${item.price}" data-image="${encodeURIComponent(item.image_url || '')}" data-set="${item.card_set || ''}" data-condition="${item.condition || ''}">Add</button>
          </li>
        `).join('')}
      </ul>
      <div>
        <button id="sell-prev-page" ${page === 1 ? 'disabled' : ''}>Previous</button>
        <span>Page ${page} of ${totalPages}</span>
        <button id="sell-next-page" ${page >= totalPages ? 'disabled' : ''}>Next</button>
      </div>
    </div>
    <div>
      <h4>Sell Cart</h4>
      <ul id="sell-cart-items">
        ${cart.map(item => `
          <li>
            ${item.image_url ? `<img src="${decodeURIComponent(item.image_url)}" alt="${item.name}" style="max-width: 50px;">` : 'No Image'}
            ${item.name} (${item.card_set || 'Unknown Set'}) - 
            <input type="number" value="${item.negotiatedPrice || item.price}" class="sell-price-input" data-id="${item.id}" style="width: 60px;">
            (Original: ${cleanPrice(item.price)}, ${item.condition || 'Not Set'})
          </li>
        `).join('')}
      </ul>
      <p>Total Listed: ${cleanPrice(totalListed.toFixed(2))}, Items: ${cart.length}</p>
      <p>Total Negotiated: ${cleanPrice(totalNegotiated.toFixed(2))}</p>
      <button id="complete-sell">Complete Sell</button>
      <button id="clear-sell-cart">Clear Cart</button>
    </div>
  `;

  // Event listeners
  document.getElementById('sell-search').addEventListener('input', debounce((e) => {
    fetchInventory(1, e.target.value);
  }, 600));
  document.getElementById('sell-prev-page').addEventListener('click', () => fetchInventory(page - 1, searchTerm));
  document.getElementById('sell-next-page').addEventListener('click', () => fetchInventory(page + 1, searchTerm));
  document.getElementById('complete-sell').addEventListener('click', completeSellTransaction);
  document.getElementById('clear-sell-cart').addEventListener('click', clearSellCart);
  document.querySelectorAll('.add-to-sell-cart').forEach(button => {
    button.addEventListener('click', () => {
      const { id, name, price, image, set, condition } = button.dataset;
      addToSellCart(id, name, parseFloat(price), decodeURIComponent(image), set, condition);
    });
  });
  document.querySelectorAll('.sell-price-input').forEach(input => {
    input.addEventListener('change', (e) => updateSellPrice(input.dataset.id, e.target.value));
  });
}

// Add an item from inventory to the Sell cart
function addToSellCart(id, name, price, image_url, card_set, condition) {
  console.log('Adding to sell cart:', { id, name, price, image_url, card_set, condition });
  sellCart.push({ id, name, price, image_url, card_set, condition, role: 'sold' });
  fetchInventory(sellPage, sellSearchTerm); // Refresh Sell tab with updated cart
}

// Update the negotiated price for an item in the Sell cart
function updateSellPrice(id, value) {
  const index = sellCart.findIndex(item => item.id === id);
  if (index !== -1) {
    sellCart[index].negotiatedPrice = parseFloat(value) || sellCart[index].price;
    console.log('Updated sell price:', sellCart[index]);
  }
  fetchInventory(sellPage, sellSearchTerm); // Refresh Sell tab with updated total
}

// Complete a Sell transaction and clear the cart
function completeSellTransaction() {
  console.log('Completing sell transaction:', { sellCart });
  const items = sellCart.slice();
  const cashIn = sellCart.reduce((sum, item) => sum + parseFloat(item.negotiatedPrice || item.price), 0);
  const cashOut = 0;
  ipcRenderer.send('complete-transaction', { items, type: 'sell', cashIn, cashOut });
  ipcRenderer.once('transaction-complete', (event, data) => {
    console.log('Sell transaction completed');
    sellCart.length = 0;
    require('../renderer').showScreen('sell');
  });
  ipcRenderer.once('transaction-error', (event, error) => console.error('Sell transaction failed:', error));
}

// Clear the Sell cart and refresh the tab
function clearSellCart() {
  sellCart.length = 0;
  fetchInventory(sellPage, sellSearchTerm);
}

module.exports = { render, addToSellCart, updateSellPrice, completeSellTransaction, clearSellCart };