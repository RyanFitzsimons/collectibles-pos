// Imports required modules for Electron communication, utilities, and cart management
const { ipcRenderer } = require('electron');  // Electron IPC for communicating with main process
const { cleanPrice, debounce } = require('../utils');  // Utility functions: cleanPrice formats prices, debounce delays event handling
const { sellCart } = require('../cart');  // Cart module providing the sellCart array

// Fetches inventory data from the main process for the Sell tab
function fetchInventory(page, searchTerm) {
  ipcRenderer.send('get-inventory', { page, limit: 50, search: searchTerm });  // Requests inventory data with pagination and search term
  ipcRenderer.once('inventory-data', (event, { items, total }) => {
    render(page, searchTerm, sellCart, items, total);  // Renders Sell tab with fetched inventory
  });
}

// Renders the Sell tab UI with inventory and cart sections
function render(page, searchTerm, cart, inventory = null, total = null) {
  console.log('Rendering Sell tab with:', { inventory, total });  // Logs rendering data for debugging
  const content = document.getElementById('content');  // Gets the main content container from the DOM
  if (!inventory || total === null) {
    fetchInventory(page, searchTerm);  // Fetches inventory if not provided
    return;
  }

  const totalListed = cart.reduce((sum, item) => sum + item.price, 0);  // Calculates total listed price of cart items
  const totalNegotiated = cart.reduce((sum, item) => sum + (parseFloat(item.negotiatedPrice) || item.price), 0);  // Calculates total negotiated price
  const totalPages = Math.ceil(total / 50);  // Calculates total pages for inventory pagination
  content.innerHTML = `
    <h3>Sell to Customer</h3>
    <div>
      <h4>Inventory</h4>
      <input id="sell-search" type="text" placeholder="Search inventory (e.g., Charizard, PS4)" value="${searchTerm}">
      <ul id="sell-inventory-list">
        ${inventory.map(item => `
          <li>
            ${item.image_url ? `<img src="${item.image_url}" alt="${item.name}">` : ''}  // Displays item image if available
            ${item.name} (${item.type}${formatAttributes(item.attributes)}) - ${cleanPrice(item.price)} (${item.condition || 'Not Set'}) 
            <button class="add-to-sell-cart" data-id="${item.id}" data-name="${item.name}" data-price="${item.price}" data-image="${encodeURIComponent(item.image_url || '')}" data-type="${item.type}" data-condition="${item.condition || ''}" data-attributes='${JSON.stringify(item.attributes)}'>Add</button>
          </li>
        `).join('')}  // Lists inventory items with Add buttons
      </ul>
      <div>
        <button id="sell-prev-page" ${page === 1 ? 'disabled' : ''}>Previous</button>  // Previous page button, disabled on first page
        <span>Page ${page} of ${totalPages}</span>  // Displays current page info
        <button id="sell-next-page" ${page >= totalPages ? 'disabled' : ''}>Next</button>  // Next page button, disabled on last page
      </div>
    </div>
    <div>
      <h4>Sell Cart</h4>
      <ul id="sell-cart-items">
        ${cart.map(item => `
          <li>
            ${item.image_url ? `<img src="${decodeURIComponent(item.image_url)}" alt="${item.name}" style="max-width: 50px;">` : 'No Image'}  // Displays cart item image
            ${item.name} (${item.type}${formatAttributes(item.attributes)}) - 
            <input type="number" value="${item.negotiatedPrice || item.price}" class="sell-price-input" data-id="${item.id}" style="width: 60px;">  // Editable negotiated price
            (Original: ${cleanPrice(item.price)}, ${item.condition || 'Not Set'})  // Shows original price and condition
          </li>
        `).join('')}  // Lists cart items with editable prices
      </ul>
      <p>Total Listed: ${cleanPrice(totalListed.toFixed(2))}, Items: ${cart.length}</p>  // Displays total listed price and item count
      <p>Total Negotiated: ${cleanPrice(totalNegotiated.toFixed(2))}</p>  // Displays total negotiated price
      <button id="complete-sell">Complete Sell</button>  // Button to complete transaction
      <button id="clear-sell-cart">Clear Cart</button>  // Button to clear cart
    </div>
  `;  // Sets the HTML content for the Sell tab

  // Adds event listener for inventory search with debounce to reduce fetch frequency
  document.getElementById('sell-search').addEventListener('input', debounce((e) => {
    fetchInventory(1, e.target.value);  // Fetches page 1 with new search term
  }, 600));  // 600ms delay for debounce

  // Pagination: Previous page button
  document.getElementById('sell-prev-page').addEventListener('click', () => fetchInventory(page - 1, searchTerm));  // Fetches previous page
  // Pagination: Next page button
  document.getElementById('sell-next-page').addEventListener('click', () => fetchInventory(page + 1, searchTerm));  // Fetches next page
  // Completes the sell transaction
  document.getElementById('complete-sell').addEventListener('click', completeSellTransaction);  // Triggers transaction completion
  // Clears the sell cart
  document.getElementById('clear-sell-cart').addEventListener('click', clearSellCart);  // Clears the cart

  // Adds items from inventory to sell cart
  document.querySelectorAll('.add-to-sell-cart').forEach(button => {
    button.addEventListener('click', () => {
      const { id, name, price, image, type, condition, attributes } = button.dataset;  // Gets item data from button attributes
      addToSellCart(id, name, parseFloat(price), decodeURIComponent(image), type, condition, JSON.parse(attributes));  // Adds item to cart
    });
  });

  // Updates negotiated prices in the sell cart
  document.querySelectorAll('.sell-price-input').forEach(input => {
    input.addEventListener('change', (e) => updateSellPrice(input.dataset.id, e.target.value));  // Updates price on change
  });
}

// Formats attributes for display as a string
function formatAttributes(attributes) {
  if (!attributes || Object.keys(attributes).length === 0) return '';  // Returns empty string if no attributes
  return ' - ' + Object.entries(attributes).map(([key, value]) => `${key}: ${value}`).join(', ');  // Formats attributes as "key: value"
}

// Adds an item from inventory to the sell cart
function addToSellCart(id, name, price, image_url, type, condition, attributes) {
  console.log('Adding to sell cart:', { id, name, price, image_url, type, condition, attributes });  // Logs item being added
  sellCart.push({
    id,  // Unique item ID from inventory
    name,  // Item name
    price,  // Original listed price
    image_url,  // URL of item image
    type,  // Item type
    condition,  // Item condition
    attributes: attributes || {},  // Item attributes, defaults to empty object
    role: 'sold'  // Marks item as sold to customer
  });
  fetchInventory(sellPage, sellSearchTerm);  // Refreshes Sell tab with updated cart (Note: sellPage, sellSearchTerm assumed global from prior context)
}

// Updates the negotiated price for an item in the sell cart
function updateSellPrice(id, value) {
  const index = sellCart.findIndex(item => item.id === id);  // Finds item index in sellCart by ID
  if (index !== -1) {
    sellCart[index].negotiatedPrice = parseFloat(value) || sellCart[index].price;  // Updates negotiated price, falls back to original if invalid
    console.log('Updated sell price:', sellCart[index]);  // Logs updated item
  }
  fetchInventory(sellPage, sellSearchTerm);  // Refreshes Sell tab with updated total (Note: assumes global vars)
}

// Completes a sell transaction and clears the cart
function completeSellTransaction() {
  console.log('Completing sell transaction:', { sellCart });  // Logs transaction start
  const items = sellCart.slice();  // Creates a copy of the cart items
  const cashIn = sellCart.reduce((sum, item) => sum + parseFloat(item.negotiatedPrice || item.price), 0);  // Total cash received from customer
  const cashOut = 0;  // No cash paid out by store for sell
  ipcRenderer.send('complete-transaction', { items, type: 'sell', cashIn, cashOut });  // Sends transaction data to main process
  ipcRenderer.once('transaction-complete', (event, data) => {
    console.log('Sell transaction completed');  // Logs successful completion
    sellCart.length = 0;  // Clears the cart
    require('../renderer').showScreen('sell');  // Reloads the Sell screen
  });
  ipcRenderer.once('transaction-error', (event, error) => console.error('Sell transaction failed:', error));  // Logs any transaction errors
}

// Clears the sell cart and refreshes the tab
function clearSellCart() {
  sellCart.length = 0;  // Empties the sellCart array
  fetchInventory(sellPage, sellSearchTerm);  // Refreshes UI with empty cart (Note: assumes global vars)
}

// Exports functions for use in other modules or main process
module.exports = { render, addToSellCart, updateSellPrice, completeSellTransaction, clearSellCart };