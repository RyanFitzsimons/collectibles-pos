// Imports required modules for Electron communication, utilities, cart management, and file operations
const { ipcRenderer } = require('electron');  // Electron IPC for communicating with main process
const { cleanPrice, debounce } = require('../utils');  // Utility functions: cleanPrice formats prices, debounce delays event handling
const { tradeInCart, tradeOutCart } = require('../cart');  // Cart module providing tradeInCart and tradeOutCart arrays
const axios = require('axios');  // Library for HTTP requests, used for fetching and caching images
const fs = require('fs');  // File system module for saving cached images
const path = require('path');  // Path utilities for constructing file paths

// Global variables for TCG card modal pagination and trade-out inventory tracking
let allTcgCards = [];  // Array to store all fetched TCG cards for trade-in modal
let currentTcgPage = 1;  // Tracks the current page of TCG cards in the modal
const itemsPerPage = 12;  // Number of TCG cards shown per page in the modal

// Fetches inventory data from the main process for the trade-out section
function fetchInventory(page, searchTerm) {
  ipcRenderer.send('get-inventory', { page, limit: 50, search: searchTerm });  // Requests inventory data with pagination and search term
  ipcRenderer.once('inventory-data', (event, { items, total }) => {
    render(page, searchTerm, tradeInCart, tradeOutCart, items, total);  // Renders Trade tab with fetched inventory
  });
}

// Renders the Trade screen UI, including trade-in form and trade-out inventory
function render(page, searchTerm, inCart, outCart, inventory = null, total = null) {
  const content = document.getElementById('content');  // Gets the main content container from the DOM
  if (!inventory || total === null) {
    fetchInventory(page, searchTerm);  // Fetches inventory if not provided
    return;
  }

  const tradeInTotal = inCart.reduce((sum, item) => sum + item.tradeValue, 0);  // Calculates total trade-in value (customer gives)
  const tradeOutTotal = outCart.reduce((sum, item) => sum + (parseFloat(item.negotiatedPrice) || item.price), 0);  // Calculates total trade-out value (customer gets)
  const cashDue = Math.max(tradeOutTotal - tradeInTotal, 0);  // Cash customer owes if trade-out exceeds trade-in
  const cashBack = tradeInTotal > tradeOutTotal ? tradeInTotal - tradeOutTotal : 0;  // Cash store owes if trade-in exceeds trade-out
  const totalPages = Math.ceil(total / 50);  // Calculates total pages for trade-out inventory pagination

  content.innerHTML = `
    <div class="trade-container">
      <div class="trade-section trade-in">
        <div class="section">
          <h3>Add Trade-In Item</h3>
          <div class="input-group">
            <label>Item Type</label>
            <select id="trade-in-type-selector">
              <option value="pokemon_tcg">Pokémon TCG</option>
              <option value="video_game">Video Game</option>
              <option value="console">Console</option>
              <option value="football_shirt">Football Shirt</option>
              <option value="coin">Coin</option>
              <option value="other_tcg">Other TCG</option>
            </select>
          </div>
          <div class="input-group" id="trade-in-tcg-fetch" style="display: none;">
            <label>Search TCG Card</label>
            <input id="trade-in-tcg-card-name" placeholder="e.g., Charizard" type="text">
            <button id="fetch-trade-in-card">Fetch Card</button>
          </div>
          <div class="input-group" id="trade-in-game-fetch" style="display: none;">
            <label>Search Game</label>
            <input id="trade-in-game-name" placeholder="e.g., FIFA 21" type="text">
            <button id="fetch-trade-in-game-data">Fetch Game</button>
          </div>
          <div id="tcg-modal-trade-in" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000;">
            <div style="background: white; margin: 50px auto; padding: 20px; width: 80%; max-height: 80%; overflow-y: auto;">
              <h4>Select a Card</h4>
              <div id="tcg-card-list-trade-in" style="display: flex; flex-wrap: wrap; gap: 20px;"></div>
              <div style="margin-top: 20px;">
                <button id="tcg-prev-page-trade-in" disabled>Previous</button>
                <span id="tcg-page-info-trade-in">Page 1</span>
                <button id="tcg-next-page-trade-in">Next</button>
              </div>
              <button id="close-tcg-modal-trade-in">Close</button>
            </div>
          </div>
          <div class="input-group">
            <label>Name</label>
            <input id="trade-in-name" placeholder="Enter item name" type="text">
          </div>
          <div id="trade-in-attributes"></div>
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
            <select id="trade-in-condition-category"></select>
            <input id="trade-in-condition-value" placeholder="e.g., scratches" type="text">
          </div>
          <div class="input-group">
            <label>Image</label>
            <input id="trade-in-image" type="file" accept="image/*">
          </div>
          <input id="trade-in-image-url" type="hidden">
          <button id="add-to-trade-in">Add Trade-In</button>
        </div>
        <div class="section">
          <h3>Trade-In Cart</h3>
          <ul id="trade-in-items">
            ${inCart.map(item => `
              <li>
                ${item.image_url ? `<img src="${item.image_url}" alt="${item.name}" style="max-width: 50px;">` : ''} 
                ${item.name} (${item.type}) - ${cleanPrice(item.tradeValue)} (${item.condition || 'Not Set'})
              </li>
            `).join('')}  
          </ul>
          <p>Total Trade-In Value: ${cleanPrice(tradeInTotal.toFixed(2))}, Items: ${inCart.length}</p>  
          <button id="clear-trade-in-cart">Clear Cart</button> 
          <h3>Trade-In Cart <span class="cart-count">(${inCart.length})</span></h3>
        </div>
      </div>
      <div class="trade-section trade-out">
        <div class="section">
          <h3>Trade-Out Inventory</h3>
          <input id="trade-out-search" type="text" placeholder="Search inventory" value="${searchTerm}">
          <ul id="trade-out-inventory-list">
            ${inventory.map(item => `
              <li>
                ${item.image_url ? `<img src="${item.image_url}" alt="${item.name}">` : ''}  
                ${item.name} (${item.type}) - ${cleanPrice(item.price)} (${item.condition || 'Not Set'}) 
                <button class="add-to-trade-out" data-id="${item.id}" data-name="${item.name}" data-price="${item.price}" data-image="${encodeURIComponent(item.image_url || '')}" data-set="${item.attributes.card_set || ''}" data-condition="${item.condition || ''}">Add</button>
              </li>
            `).join('')}  
          </ul>
          <div>
            <button id="trade-out-prev-page" ${page === 1 ? 'disabled' : ''}>Previous</button>  
            <span>Page ${page} of ${totalPages}</span> 
            <button id="trade-out-next-page" ${page >= totalPages ? 'disabled' : ''}>Next</button> 
          </div>
        </div>
        <div class="section">
          <h3>Trade-Out Cart</h3>
          <ul id="trade-out-items">
            ${outCart.map(item => `
              <li>
                ${item.image_url ? `<img src="${decodeURIComponent(item.image_url)}" alt="${item.name}" style="max-width: 50px;">` : 'No Image'}  
                ${item.name} (${item.type}) - 
                <input type="number" value="${item.negotiatedPrice || item.price}" class="trade-out-price-input" data-id="${item.id}" style="width: 60px;">  
                (Original: ${cleanPrice(item.price)}, ${item.condition || 'Not Set'})  
              </li>
            `).join('')}  
          </ul>
          <p>Total Trade-Out Value: ${cleanPrice(tradeOutTotal.toFixed(2))}, Items: ${outCart.length}</p>  
          <p>Cash Due: ${cleanPrice(cashDue.toFixed(2))}</p>  
          ${cashBack > 0 ? `<p>Cash Back: ${cleanPrice(cashBack.toFixed(2))}</p>` : ''} 
          <button id="complete-trade">Complete Trade</button>  
          <button id="clear-trade-out-cart">Clear Cart</button>
          <h3>Trade-Out Cart <span class="cart-count">(${outCart.length})</span></h3> 
        </div>
      </div>
    </div>
  `;  // Sets the HTML content for the Trade screen

  // Sets up trade-in form event listeners
  const typeSelector = document.getElementById('trade-in-type-selector');  // Gets trade-in type selector
  typeSelector.addEventListener('change', () => {
    console.log('Type changed to:', typeSelector.value);  // Logs type change
    updateAttributeFields('trade-in');  // Updates form fields based on type
    updateConditionOptions('trade-in');  // Updates condition dropdown
  });
  updateAttributeFields('trade-in');  // Initial call to set up attributes
  updateConditionOptions('trade-in');  // Initial call to set up condition options

  // Adds search functionality for trade-out inventory with debounce
  document.getElementById('trade-out-search').addEventListener('input', debounce((e) => {
    fetchInventory(1, e.target.value);  // Fetches page 1 with new search term
  }, 600));  // 600ms delay for debounce

  // Adds event listeners for UI buttons
  document.getElementById('fetch-trade-in-card')?.addEventListener('click', () => fetchTcgCard('trade-in'));  // Fetches TCG card data
  document.getElementById('close-tcg-modal-trade-in')?.addEventListener('click', () => closeTcgModal('trade-in'));  // Closes TCG modal
  document.getElementById('fetch-trade-in-game-data')?.addEventListener('click', fetchTradeInGameData);  // Fetches game data
  document.getElementById('close-game-modal-trade-in')?.addEventListener('click', () => closeGameModal('trade-in'));  // Closes game modal
  document.getElementById('add-to-trade-in').addEventListener('click', addToTradeInCart);  // Adds item to trade-in cart
  document.getElementById('complete-trade').addEventListener('click', completeTradeTransaction);  // Completes trade transaction
  document.getElementById('clear-trade-in-cart').addEventListener('click', clearTradeInCart);  // Clears trade-in cart
  document.getElementById('clear-trade-out-cart').addEventListener('click', clearTradeOutCart);  // Clears trade-out cart

  // Adds trade-out items from inventory to cart
  document.querySelectorAll('.add-to-trade-out').forEach(button => {
    button.addEventListener('click', () => {
      const { id, name, price, image, set, condition } = button.dataset;  // Gets item data from button attributes
      addToTradeOutCart(id, name, parseFloat(price), decodeURIComponent(image), set, condition);  // Adds item to trade-out cart
    });
  });

  // Updates negotiated prices in trade-out cart
  document.querySelectorAll('.trade-out-price-input').forEach(input => {
    input.addEventListener('change', (e) => updateTradeOutPrice(input.dataset.id, e.target.value));  // Updates price on change
  });

  // Removes existing TCG card data listeners to prevent duplicates
  ipcRenderer.removeAllListeners('tcg-card-data');
  ipcRenderer.on('tcg-card-data', (event, cards) => {
    allTcgCards = cards;  // Stores fetched TCG cards
    currentTcgPage = 1;  // Resets to first page
    renderTcgModal('trade-in');  // Shows TCG modal
  });

  // Handles game data received from main process
  ipcRenderer.removeAllListeners('game-data');
  ipcRenderer.on('game-data', (event, games) => {
    const gameList = document.getElementById('game-list-trade-in');  // Gets game list container
    if (!gameList) return console.error('Game list not found in DOM');  // Errors if list missing
    gameList.innerHTML = '';  // Clears existing game list
    games.forEach((game, index) => {
      const gameDiv = document.createElement('div');
      gameDiv.style = 'border: 1px solid #ccc; padding: 10px; width: 200px; text-align: center;';  // Styles game card
      gameDiv.innerHTML = `
        ${game.image_url ? `<img src="${game.image_url}" alt="${game.name}" style="width: auto; height: auto; max-width: 180px; max-height: 250px;">` : 'No Image'}
        <p><strong>${game.name}</strong></p>
        <p>Platforms: ${game.platform || 'Unknown'}</p>
        <p>Release: ${game.release_date || 'N/A'}</p>
        <p>Genres: ${game.genres || 'N/A'}</p>
        <button class="select-game" data-index="${index}">Select</button>
      `;  // HTML for each game card
      gameList.appendChild(gameDiv);  // Adds game card to list
    });
    const modal = document.getElementById('game-modal-trade-in');
    if (modal) modal.style.display = 'flex';  // Shows game modal
    document.querySelectorAll('#game-list-trade-in .select-game').forEach(button => {
      button.addEventListener('click', () => {
        const index = parseInt(button.dataset.index);  // Gets index of selected game
        selectGame(games[index], 'trade-in');  // Populates form with selected game
      });
    });
  });

  // Logs errors from main process for TCG card or game data fetching
  ipcRenderer.on('tcg-card-error', (event, error) => console.error('TCG card fetch error:', error));
  ipcRenderer.on('game-data-error', (event, error) => console.error('Game data fetch error:', error));
}

// Fetches TCG card data from the main process for trade-in
function fetchTcgCard(context) {
  const input = document.getElementById(`${context}-tcg-card-name`);  // Gets TCG search input field
  if (!input) return console.error(`No input found for context: ${context}`);  // Errors if input missing
  const cardName = input.value;
  if (!cardName) return console.error('No card name provided for', context);  // Errors if no name entered
  console.log(`Fetching TCG card for ${context}:`, cardName);  // Logs fetch attempt
  ipcRenderer.send('get-tcg-card', cardName);  // Sends fetch request to main process
}

// Handles selection of a TCG card from the modal, caching its image
async function selectTcgCard(card, context) {
  console.log(`Selected TCG card for ${context}:`, card);  // Logs selected card
  const prefix = context;
  document.getElementById(`${prefix}-type-selector`).value = 'pokemon_tcg';  // Sets type to Pokémon TCG
  updateAttributeFields(context);  // Updates form attributes
  updateConditionOptions(context);  // Updates condition dropdown
  const nameField = document.getElementById(`${prefix}-name`);  // Name input
  const priceField = document.getElementById(`${prefix}-price`);  // Market price input
  const tradeValueField = document.getElementById(`${prefix}-value`);  // Trade value input (note: 'trade-in-value' in HTML)
  const conditionCategoryField = document.getElementById(`${prefix}-condition-category`);  // Condition category dropdown
  const conditionValueField = document.getElementById(`${prefix}-condition-value`);  // Condition details input
  const imageUrlField = document.getElementById(`${prefix}-image-url`);  // Hidden image URL field
  const tcgIdField = document.getElementById(`${prefix}-tcg_id`);  // TCG ID hidden field
  const cardSetField = document.getElementById(`${prefix}-card_set`);  // Card set hidden field
  const rarityField = document.getElementById(`${prefix}-rarity`);  // Rarity hidden field

  // Populates form fields with card data
  if (nameField) nameField.value = card.name;  // Sets item name
  const defaultPrice = card.prices.tcgplayer.holofoil?.market_gbp || card.prices.cardmarket.average_gbp || 0;  // Default price from TCGPlayer or Cardmarket
  if (priceField) priceField.value = defaultPrice;  // Sets market price
  if (tradeValueField) tradeValueField.value = Math.floor(defaultPrice * 0.5);  // Sets trade value as half market price
  if (conditionCategoryField) conditionCategoryField.value = '';  // Resets condition category
  if (conditionValueField) conditionValueField.value = '';  // Resets condition details

  // Caches the card image locally if not already cached
  let finalImageUrl = card.image_url;
  if (finalImageUrl) {
    const cacheDir = path.join(__dirname, 'images');  // Directory for cached images
    const cacheFileName = `${card.id}.png`;  // Filename based on card ID
    const cachePath = path.join(cacheDir, cacheFileName);  // Full path for cached image

    if (!fs.existsSync(cachePath)) {  // Checks if image isn’t already cached
      try {
        const imageResponse = await axios.get(finalImageUrl, { responseType: 'arraybuffer' });  // Fetches image data
        fs.mkdirSync(cacheDir, { recursive: true });  // Creates directory if it doesn’t exist
        fs.writeFileSync(cachePath, Buffer.from(imageResponse.data));  // Saves image to disk
        console.log('Image cached on selection:', cachePath);  // Logs successful caching
      } catch (err) {
        console.error('Image cache error:', err.message);  // Logs any caching errors
      }
    }
    finalImageUrl = `file://${cachePath}`;  // Updates URL to local file path
  }
  if (imageUrlField) {
    imageUrlField.value = finalImageUrl || '';  // Sets hidden image URL field
    console.log(`Set image_url for ${prefix}: ${finalImageUrl}`);  // Logs image URL setting
  }
  if (tcgIdField) tcgIdField.value = card.tcg_id || '';  // Sets TCG ID
  if (cardSetField) cardSetField.value = card.card_set || '';  // Sets card set
  if (rarityField) rarityField.value = card.rarity || '';  // Sets rarity
  
  closeTcgModal(context);  // Closes the modal after selection
}

// Fetches game data from the main process for trade-in
function fetchTradeInGameData() {
  const type = document.getElementById('trade-in-type-selector').value;  // Gets selected item type
  if (type !== 'video_game') return;  // Exits if not video game type
  const name = document.getElementById('trade-in-game-name').value || document.getElementById('trade-in-name').value;  // Gets game name from search or main field
  const platform = document.getElementById('trade-in-platform').value || '';  // Gets platform if specified
  if (!name) return console.error('Name required for video game fetch');  // Errors if no name provided
  console.log('Fetching game data for:', name, platform || 'all platforms');  // Logs fetch attempt
  ipcRenderer.send('get-game-data', { name, platform });  // Sends fetch request to main process
}

// Handles selection of a game from the modal
function selectGame(game, context) {
  console.log(`Selected game for ${context}:`, game);  // Logs selected game
  const prefix = context;
  document.getElementById(`${prefix}-type-selector`).value = 'video_game';  // Sets type to video game
  updateAttributeFields(context);  // Updates form attributes
  updateConditionOptions(context);  // Updates condition dropdown
  const nameField = document.getElementById(`${prefix}-name`);  // Name input
  const priceField = document.getElementById(`${prefix}-price`);  // Price input
  const tradeValueField = document.getElementById(`${prefix}-value`);  // Trade value input (note: 'trade-in-value' in HTML)
  const conditionCategoryField = document.getElementById(`${prefix}-condition-category`);  // Condition category dropdown
  const conditionValueField = document.getElementById(`${prefix}-condition-value`);  // Condition details input
  const imageUrlField = document.getElementById(`${prefix}-image-url`);  // Hidden image URL field
  const platformField = document.getElementById(`${prefix}-platform`);  // Platform input

  // Populates form fields with game data
  if (nameField) nameField.value = game.name;  // Sets game name
  if (priceField) priceField.value = game.price;  // Sets price (assumes game.price exists)
  if (tradeValueField) tradeValueField.value = game.tradeValue;  // Sets trade value (assumes game.tradeValue exists)
  if (conditionCategoryField) conditionCategoryField.value = '';  // Resets condition category
  if (conditionValueField) conditionValueField.value = '';  // Resets condition details
  if (imageUrlField) imageUrlField.value = game.image_url || '';  // Sets image URL
  if (platformField) platformField.value = game.platform.split(', ')[0] || '';  // Sets first platform if multiple
  
  closeGameModal(context);  // Closes the modal after selection
}

// Closes the TCG card selection modal
function closeTcgModal(context) {
  document.getElementById(`tcg-modal-${context}`).style.display = 'none';  // Hides the TCG modal
}

// Closes the game selection modal
function closeGameModal(context) {
  document.getElementById(`game-modal-${context}`).style.display = 'none';  // Hides the game modal
}

// Adds an item to the trade-in cart from form inputs
function addToTradeInCart() {
  const conditionCategory = document.getElementById('trade-in-condition-category').value;  // Gets condition category
  const conditionValue = document.getElementById('trade-in-condition-value').value;  // Gets condition details
  const condition = conditionCategory ? `${conditionCategory}${conditionValue ? ' ' + conditionValue : ''}` : conditionValue;  // Combines condition data
  const type = document.getElementById('trade-in-type-selector').value;  // Gets selected item type
  const attributes = {};  // Object to store type-specific attributes
  
  // Populates attributes based on item type
  if (type === 'pokemon_tcg' || type === 'other_tcg') {
    attributes.tcg_id = document.getElementById('trade-in-tcg_id')?.value || null;  // TCG ID
    attributes.card_set = document.getElementById('trade-in-card_set')?.value || null;  // Card set
    attributes.rarity = document.getElementById('trade-in-rarity')?.value || null;  // Rarity
  } else if (type === 'video_game') {
    attributes.platform = document.getElementById('trade-in-platform')?.value || null;  // Platform for video games
  } else if (type === 'console') {
    attributes.brand = document.getElementById('trade-in-brand')?.value || null;  // Console brand
    attributes.model = document.getElementById('trade-in-model')?.value || null;  // Console model
  } else if (type === 'football_shirt') {
    attributes.team = document.getElementById('trade-in-team')?.value || null;  // Shirt team
    attributes.year = document.getElementById('trade-in-year')?.value || null;  // Shirt year
  } else if (type === 'coin') {
    attributes.denomination = document.getElementById('trade-in-denomination')?.value || null;  // Coin denomination
    attributes.year_minted = document.getElementById('trade-in-year_minted')?.value || null;  // Coin year minted
  }

  const tradeInItem = {
    id: Date.now().toString(),  // Generates unique ID based on current timestamp
    type,  // Item type from selector
    name: document.getElementById('trade-in-name').value,  // Item name from input
    price: parseFloat(document.getElementById('trade-in-price').value) || 0,  // Market price, defaults to 0 if invalid
    tradeValue: parseFloat(document.getElementById('trade-in-value').value) || 0,  // Trade value, defaults to 0 if invalid
    condition: condition || null,  // Combined condition or null if empty
    image_url: document.getElementById('trade-in-image-url').value || null,  // Image URL or null
    attributes,  // Type-specific attributes
    role: 'trade_in'  // Marks item as a trade-in from customer
  };
  tradeInCart.push(tradeInItem);  // Adds item to tradeInCart array
  console.log('Adding to trade-in cart:', tradeInItem);  // Logs added item
  render(tradeOutPage, tradeOutSearchTerm, tradeInCart, tradeOutCart);  // Refreshes UI with updated carts (Note: assumes tradeOutPage, tradeOutSearchTerm are global)
}

// Adds an item from inventory to the trade-out cart
function addToTradeOutCart(id, name, price, image_url, card_set, condition) {
  console.log('Adding to trade-out cart:', { id, name, price, image_url, card_set, condition });  // Logs item being added
  tradeOutCart.push({ 
    id,  // Item ID from inventory
    name,  // Item name
    price,  // Original price
    image_url: decodeURIComponent(image_url),  // Decoded image URL
    card_set,  // Card set (assumes TCG context, may need type check)
    condition,  // Item condition
    role: 'trade_out'  // Marks item as trade-out to customer
  });
  fetchInventory(tradeOutPage, tradeOutSearchTerm);  // Refreshes Trade tab (Note: assumes global vars)
}

// Updates the negotiated price for an item in the trade-out cart
function updateTradeOutPrice(id, value) {
  const index = tradeOutCart.findIndex(item => item.id === id);  // Finds item index in tradeOutCart by ID
  if (index !== -1) {
    tradeOutCart[index].negotiatedPrice = parseFloat(value) || tradeOutCart[index].price;  // Updates negotiated price, falls back to original if invalid
    console.log('Updated trade-out price:', tradeOutCart[index]);  // Logs updated item
  }
  fetchInventory(tradeOutPage, tradeOutSearchTerm);  // Refreshes Trade tab (Note: assumes global vars)
}

// Completes the trade transaction, sending carts to the main process
function completeTradeTransaction() {
  console.log('Completing trade transaction:', { tradeInCart, tradeOutCart });  // Logs transaction start
  const items = [...tradeInCart, ...tradeOutCart];  // Combines trade-in and trade-out items
  const cashIn = tradeOutCart.reduce((sum, item) => sum + parseFloat(item.negotiatedPrice || item.price), 0);  // Total cash received from customer
  const cashOut = tradeInCart.reduce((sum, item) => sum + parseFloat(item.tradeValue), 0);  // Total cash paid to customer
  
  tradeInCart.forEach(item => {
    const itemData = { ...item, ...item.attributes };  // Merges item data with its attributes
    ipcRenderer.send('add-item', itemData);  // Sends trade-in items to main process for inventory addition
  });
  
  ipcRenderer.send('complete-transaction', { items, type: 'trade', cashIn, cashOut });  // Sends transaction data to main process
  ipcRenderer.once('transaction-complete', (event, data) => {
    console.log('Trade transaction completed');  // Logs successful completion
    tradeInCart.length = 0;  // Clears trade-in cart
    tradeOutCart.length = 0;  // Clears trade-out cart
    require('../renderer').showScreen('trade');  // Reloads the Trade screen
  });
  ipcRenderer.once('transaction-error', (event, error) => console.error('Trade transaction failed:', error));  // Logs any transaction errors
}

// Clears the trade-in cart and refreshes the UI
function clearTradeInCart() {
  tradeInCart.length = 0;  // Empties the tradeInCart array
  fetchInventory(tradeOutPage, tradeOutSearchTerm);  // Refreshes UI (Note: assumes global vars)
}

// Clears the trade-out cart and refreshes the UI
function clearTradeOutCart() {
  tradeOutCart.length = 0;  // Empties the tradeOutCart array
  fetchInventory(tradeOutPage, tradeOutSearchTerm);  // Refreshes UI (Note: assumes global vars)
}

// Updates attribute fields in the trade-in form based on item type
function updateAttributeFields(context) {
  const type = document.getElementById(`${context}-type-selector`).value;  // Gets selected item type
  const attributesDiv = document.getElementById(`${context}-attributes`);  // Gets attributes container
  const tcgFetchDiv = document.getElementById(`${context}-tcg-fetch`);  // Gets TCG fetch section
  const gameFetchDiv = document.getElementById(`${context}-game-fetch`);  // Gets game fetch section
  attributesDiv.innerHTML = '';  // Clears existing attributes
  if (tcgFetchDiv) tcgFetchDiv.style.display = (type === 'pokemon_tcg' || type === 'other_tcg') ? 'block' : 'none';  // Shows TCG fetch for TCG types
  if (gameFetchDiv) gameFetchDiv.style.display = (type === 'video_game') ? 'block' : 'none';  // Shows game fetch for video games

  // Adds type-specific attribute fields to the form
  if (type === 'pokemon_tcg' || type === 'other_tcg') {
    attributesDiv.innerHTML = `
      <input id="${context}-tcg_id" type="hidden">
      <input id="${context}-card_set" type="hidden">
      <input id="${context}-rarity" type="hidden">
    `;  // Hidden fields for TCG attributes
  } else if (type === 'video_game') {
    attributesDiv.innerHTML = `
      <div class="input-group">
        <label>Platform</label>
        <input id="${context}-platform" placeholder="e.g., PS4" type="text">
      </div>
    `;  // Platform field for video games
  } else if (type === 'console') {
    attributesDiv.innerHTML = `
      <div class="input-group">
        <label>Brand</label>
        <input id="${context}-brand" placeholder="e.g., Sony" type="text">
      </div>
      <div class="input-group">
        <label>Model</label>
        <input id="${context}-model" placeholder="e.g., PS5" type="text">
      </div>
      <div class="input-group">
        <label>Name</label>
        <input id="${context}-name" placeholder="Enter item name" type="text">
      </div>
    `;  // Brand, model, and name fields for consoles
  } else if (type === 'football_shirt') {
    attributesDiv.innerHTML = `
      <div class="input-group">
        <label>Team</label>
        <input id="${context}-team" placeholder="e.g., Manchester United" type="text">
      </div>
      <div class="input-group">
        <label>Year</label>
        <input id="${context}-year" placeholder="e.g., 2023" type="text">
      </div>
    `;  // Team and year fields for football shirts
  } else if (type === 'coin') {
    attributesDiv.innerHTML = `
      <div class="input-group">
        <label>Denomination</label>
        <input id="${context}-denomination" placeholder="e.g., 50p" type="text">
      </div>
      <div class="input-group">
        <label>Year Minted</label>
        <input id="${context}-year_minted" placeholder="e.g., 1969" type="text">
      </div>
    `;  // Denomination and year minted fields for coins
  }
}

// Updates condition options in the trade-in form dropdown
function updateConditionOptions(context) {
  const type = document.getElementById(`${context}-type-selector`).value;  // Gets selected item type
  const conditionSelect = document.getElementById(`${context}-condition-category`);  // Gets condition dropdown
  conditionSelect.innerHTML = '<option value="">Select Condition</option>';  // Sets default empty option

  // Defines condition options for each item type
  const options = {
    'pokemon_tcg': ['Raw', 'PSA', 'CGC', 'BGS', 'TAG', 'Other'],  // TCG-specific conditions
    'other_tcg': ['Raw', 'PSA', 'CGC', 'BGS', 'TAG', 'Other'],  // Other TCG conditions
    'video_game': ['New', 'Used', 'CIB', 'Loose', 'Graded'],  // Video game conditions
    'console': ['New', 'Used', 'Refurbished', 'Broken'],  // Console conditions
    'football_shirt': ['New', 'Worn', 'Signed', 'Game-Worn'],  // Football shirt conditions
    'coin': ['Uncirculated', 'Circulated', 'Proof', 'Graded']  // Coin conditions
  }[type] || [];  // Gets options for type or empty array if none match

  // Populates condition dropdown with options
  options.forEach(option => {
    const opt = document.createElement('option');
    opt.value = option;
    opt.text = option;
    conditionSelect.appendChild(opt);  // Adds each option to dropdown
  });
}

// Exports functions for use in other modules or main process
module.exports = { render, fetchTcgCard, selectTcgCard, closeTcgModal, addToTradeInCart, addToTradeOutCart, updateTradeOutPrice, completeTradeTransaction, clearTradeInCart, clearTradeOutCart, updateAttributeFields };