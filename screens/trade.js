// Imports
const { ipcRenderer } = require('electron');
const { cleanPrice, debounce } = require('../utils');
const { tradeInCart, tradeOutCart } = require('../cart');
const axios = require('axios'); // Library for HTTP requests (e.g., image caching)
const fs = require('fs');  // File system module for saving images
const path = require('path'); // Path utilities for file operations

// Tracks the current page and search term for trade-out inventory
let allTcgCards = [];
let currentTcgPage = 1;
const itemsPerPage = 12;

// Fetches inventory data from the main process for trade-out section
function fetchInventory(page, searchTerm) {
  ipcRenderer.send('get-inventory', { page, limit: 50, search: searchTerm }); // Request inventory data with pagination and search
  ipcRenderer.once('inventory-data', (event, { items, total }) => {
    render(page, searchTerm, tradeInCart, tradeOutCart, items, total); // Render UI with fetched data
  });
}

// Renders the Trade screen UI, including trade-in form and trade-out inventory
function render(page, searchTerm, inCart, outCart, inventory = null, total = null) {
  const content = document.getElementById('content');
  if (!inventory || total === null) {
    fetchInventory(page, searchTerm); // Fetch inventory if not provided
    return;
  }

  const tradeInTotal = inCart.reduce((sum, item) => sum + item.tradeValue, 0); // Total trade-in value (customer gives)
  const tradeOutTotal = outCart.reduce((sum, item) => sum + (parseFloat(item.negotiatedPrice) || item.price), 0); // Total trade-out value (customer gets)
  const cashDue = Math.max(tradeOutTotal - tradeInTotal, 0); // Cash customer owes if trade-out exceeds trade-in
  const cashBack = tradeInTotal > tradeOutTotal ? tradeInTotal - tradeOutTotal : 0; // Cash store owes if trade-in exceeds trade-out
  const totalPages = Math.ceil(total / 50); // Total pages for trade-out inventory pagination

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
        </div>
      </div>
    </div>
  `;

  // Set up trade-in form event listeners
  const typeSelector = document.getElementById('trade-in-type-selector');
  typeSelector.addEventListener('change', () => {
    console.log('Type changed to:', typeSelector.value);
    updateAttributeFields('trade-in'); // Update form fields based on type
    updateConditionOptions('trade-in');
  });
  updateAttributeFields('trade-in');
  updateConditionOptions('trade-in');

  // Search trade-out inventory with debounce to reduce fetch frequency
  document.getElementById('trade-out-search').addEventListener('input', debounce((e) => {
    fetchInventory(1, e.target.value); // Fetch page 1 with new search term
  }, 600));

  // Add event listeners for buttons
  document.getElementById('fetch-trade-in-card')?.addEventListener('click', () => fetchTcgCard('trade-in'));
  document.getElementById('close-tcg-modal-trade-in')?.addEventListener('click', () => closeTcgModal('trade-in'));
  document.getElementById('fetch-trade-in-game-data')?.addEventListener('click', fetchTradeInGameData);
  document.getElementById('close-game-modal-trade-in')?.addEventListener('click', () => closeGameModal('trade-in'));
  document.getElementById('add-to-trade-in').addEventListener('click', addToTradeInCart);
  document.getElementById('complete-trade').addEventListener('click', completeTradeTransaction);
  document.getElementById('clear-trade-in-cart').addEventListener('click', clearTradeInCart);
  document.getElementById('clear-trade-out-cart').addEventListener('click', clearTradeOutCart);

  // Add trade-out items from inventory to cart
  document.querySelectorAll('.add-to-trade-out').forEach(button => {
    button.addEventListener('click', () => {
      const { id, name, price, image, set, condition } = button.dataset;
      addToTradeOutCart(id, name, parseFloat(price), decodeURIComponent(image), set, condition);
    });
  });
  // Update negotiated prices in trade-out cart
  document.querySelectorAll('.trade-out-price-input').forEach(input => {
    input.addEventListener('change', (e) => updateTradeOutPrice(input.dataset.id, e.target.value));
  });
  // Handle TCG card data from main process
  ipcRenderer.removeAllListeners('tcg-card-data');
  ipcRenderer.on('tcg-card-data', (event, cards) => {
    allTcgCards = cards; // Store fetched TCG cards
    currentTcgPage = 1; // Reset to first page
    renderTcgModal('trade-in'); // Show TCG modal
  });

  // Handle game data from main process
  ipcRenderer.removeAllListeners('game-data');
  ipcRenderer.on('game-data', (event, games) => {
    const gameList = document.getElementById('game-list-trade-in');
    if (!gameList) return console.error('Game list not found in DOM');
    gameList.innerHTML = ''; // Clear existing game list
    games.forEach((game, index) => {
      const gameDiv = document.createElement('div');
      gameDiv.style = 'border: 1px solid #ccc; padding: 10px; width: 200px; text-align: center;';
      gameDiv.innerHTML = `
        ${game.image_url ? `<img src="${game.image_url}" alt="${game.name}" style="width: auto; height: auto; max-width: 180px; max-height: 250px;">` : 'No Image'}
        <p><strong>${game.name}</strong></p>
        <p>Platforms: ${game.platform || 'Unknown'}</p>
        <p>Release: ${game.release_date || 'N/A'}</p>
        <p>Genres: ${game.genres || 'N/A'}</p>
        <button class="select-game" data-index="${index}">Select</button>
      `;
      gameList.appendChild(gameDiv);
    });
    const modal = document.getElementById('game-modal-trade-in');
    if (modal) modal.style.display = 'flex'; // Show game modal
    document.querySelectorAll('#game-list-trade-in .select-game').forEach(button => {
      button.addEventListener('click', () => {
        const index = parseInt(button.dataset.index);
        selectGame(games[index], 'trade-in'); // Select game and populate form
      });
    });
  });

  ipcRenderer.on('tcg-card-error', (event, error) => console.error('TCG card fetch error:', error));
  ipcRenderer.on('game-data-error', (event, error) => console.error('Game data fetch error:', error));
}

// Fetches TCG card data from the main process for trade-in
function fetchTcgCard(context) {
  const input = document.getElementById(`${context}-tcg-card-name`);
  if (!input) return console.error(`No input found for context: ${context}`);
  const cardName = input.value;
  if (!cardName) return console.error('No card name provided for', context);
  console.log(`Fetching TCG card for ${context}:`, cardName);
  ipcRenderer.send('get-tcg-card', cardName); // Send request to main process
}

// Handles selection of a TCG card from the modal, caching its image
async function selectTcgCard(card, context) {
  console.log(`Selected TCG card for ${context}:`, card);
  const prefix = context;
  document.getElementById(`${prefix}-type-selector`).value = 'pokemon_tcg';
  updateAttributeFields(context);
  updateConditionOptions(context);
  const nameField = document.getElementById(`${prefix}-name`);
  const priceField = document.getElementById(`${prefix}-price`);
  const tradeValueField = document.getElementById(`${prefix}-value`);
  const conditionCategoryField = document.getElementById(`${prefix}-condition-category`);
  const conditionValueField = document.getElementById(`${prefix}-condition-value`);
  const imageUrlField = document.getElementById(`${prefix}-image-url`);
  const tcgIdField = document.getElementById(`${prefix}-tcg_id`);
  const cardSetField = document.getElementById(`${prefix}-card_set`);
  const rarityField = document.getElementById(`${prefix}-rarity`);

  // Populate form fields with card data
  if (nameField) nameField.value = card.name;
  const defaultPrice = card.prices.tcgplayer.holofoil?.market_gbp || card.prices.cardmarket.average_gbp || 0;
  if (priceField) priceField.value = defaultPrice;
  if (tradeValueField) tradeValueField.value = Math.floor(defaultPrice * 0.5);
  if (conditionCategoryField) conditionCategoryField.value = '';
  if (conditionValueField) conditionValueField.value = '';

  // Cache the card image locally if not already cached
  let finalImageUrl = card.image_url;
  if (finalImageUrl) {
    const cacheDir = path.join(__dirname, 'images');
    const cacheFileName = `${card.id}.png`;
    const cachePath = path.join(cacheDir, cacheFileName);

    if (!fs.existsSync(cachePath)) {
      try {
        const imageResponse = await axios.get(finalImageUrl, { responseType: 'arraybuffer' });
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(cachePath, Buffer.from(imageResponse.data));
        console.log('Image cached on selection:', cachePath);
      } catch (err) {
        console.error('Image cache error:', err.message);
      }
    }
    finalImageUrl = `file://${cachePath}`;
  }
  if (imageUrlField) {
    imageUrlField.value = finalImageUrl || '';
    console.log(`Set image_url for ${prefix}: ${finalImageUrl}`);
  }
  if (tcgIdField) tcgIdField.value = card.tcg_id || '';
  if (cardSetField) cardSetField.value = card.card_set || '';
  if (rarityField) rarityField.value = card.rarity || '';
  
  closeTcgModal(context); // Close modal after selection
}

// Fetches game data from the main process for trade-in
function fetchTradeInGameData() {
  const type = document.getElementById('trade-in-type-selector').value;
  if (type !== 'video_game') return;
  const name = document.getElementById('trade-in-game-name').value || document.getElementById('trade-in-name').value;
  const platform = document.getElementById('trade-in-platform').value || '';
  if (!name) return console.error('Name required for video game fetch');
  console.log('Fetching game data for:', name, platform || 'all platforms');
  ipcRenderer.send('get-game-data', { name, platform });
}

// Handles selection of a game from the modal
function selectGame(game, context) {
  console.log(`Selected game for ${context}:`, game);
  const prefix = context;
  document.getElementById(`${prefix}-type-selector`).value = 'video_game';
  updateAttributeFields(context);
  updateConditionOptions(context);
  const nameField = document.getElementById(`${prefix}-name`);
  const priceField = document.getElementById(`${prefix}-price`);
  const tradeValueField = document.getElementById(`${prefix}-value`);
  const conditionCategoryField = document.getElementById(`${prefix}-condition-category`);
  const conditionValueField = document.getElementById(`${prefix}-condition-value`);
  const imageUrlField = document.getElementById(`${prefix}-image-url`);
  const platformField = document.getElementById(`${prefix}-platform`);

  if (nameField) nameField.value = game.name;
  if (priceField) priceField.value = game.price;
  if (tradeValueField) tradeValueField.value = game.tradeValue;
  if (conditionCategoryField) conditionCategoryField.value = '';
  if (conditionValueField) conditionValueField.value = '';
  if (imageUrlField) imageUrlField.value = game.image_url || '';
  if (platformField) platformField.value = game.platform.split(', ')[0] || '';
  
  closeGameModal(context); // Handles selection of a game from the modal
}

// Closes the TCG card selection modal
function closeTcgModal(context) {
  document.getElementById(`tcg-modal-${context}`).style.display = 'none';
}

// Closes the game selection modal
function closeGameModal(context) {
  document.getElementById(`game-modal-${context}`).style.display = 'none';
}

// Adds an item to the trade-in cart from form inputs
function addToTradeInCart() {
  const conditionCategory = document.getElementById('trade-in-condition-category').value;
  const conditionValue = document.getElementById('trade-in-condition-value').value;
  const condition = conditionCategory ? `${conditionCategory}${conditionValue ? ' ' + conditionValue : ''}` : conditionValue;
  const type = document.getElementById('trade-in-type-selector').value;
  const attributes = {};
  // Populate attributes based on item type
  if (type === 'pokemon_tcg' || type === 'other_tcg') {
    attributes.tcg_id = document.getElementById('trade-in-tcg_id')?.value || null;
    attributes.card_set = document.getElementById('trade-in-card_set')?.value || null;
    attributes.rarity = document.getElementById('trade-in-rarity')?.value || null;
  } else if (type === 'video_game') {
    attributes.platform = document.getElementById('trade-in-platform')?.value || null;
  } else if (type === 'console') {
    attributes.brand = document.getElementById('trade-in-brand')?.value || null;
    attributes.model = document.getElementById('trade-in-model')?.value || null;
  } else if (type === 'football_shirt') {
    attributes.team = document.getElementById('trade-in-team')?.value || null;
    attributes.year = document.getElementById('trade-in-year')?.value || null;
  } else if (type === 'coin') {
    attributes.denomination = document.getElementById('trade-in-denomination')?.value || null;
    attributes.year_minted = document.getElementById('trade-in-year_minted')?.value || null;
  }

  const tradeInItem = {
    id: Date.now().toString(), // Unique ID based on current time
    type,
    name: document.getElementById('trade-in-name').value,
    price: parseFloat(document.getElementById('trade-in-price').value) || 0,
    tradeValue: parseFloat(document.getElementById('trade-in-value').value) || 0,
    condition: condition || null,
    image_url: document.getElementById('trade-in-image-url').value || null,
    attributes,
    role: 'trade_in' // Trade-in item from customer
  };
  tradeInCart.push(tradeInItem);
  console.log('Adding to trade-in cart:', tradeInItem);
  render(tradeOutPage, tradeOutSearchTerm, tradeInCart, tradeOutCart);
}

// Adds an item from inventory to the trade-out cart
function addToTradeOutCart(id, name, price, image_url, card_set, condition) {
  console.log('Adding to trade-out cart:', { id, name, price, image_url, card_set, condition });
  tradeOutCart.push({ id, name, price, image_url: decodeURIComponent(image_url), card_set, condition, role: 'trade_out' });
  fetchInventory(tradeOutPage, tradeOutSearchTerm);
}

// Updates the negotiated price for an item in the trade-out cart
function updateTradeOutPrice(id, value) {
  const index = tradeOutCart.findIndex(item => item.id === id);
  if (index !== -1) {
    tradeOutCart[index].negotiatedPrice = parseFloat(value) || tradeOutCart[index].price;
    console.log('Updated trade-out price:', tradeOutCart[index]);
  }
  fetchInventory(tradeOutPage, tradeOutSearchTerm);
}

// Completes the trade transaction, sending carts to main process
function completeTradeTransaction() {
  console.log('Completing trade transaction:', { tradeInCart, tradeOutCart });
  const items = [...tradeInCart, ...tradeOutCart];
  const cashIn = tradeOutCart.reduce((sum, item) => sum + parseFloat(item.negotiatedPrice || item.price), 0); // Total customer pays
  const cashOut = tradeInCart.reduce((sum, item) => sum + parseFloat(item.tradeValue), 0); // Total store pays
  
  tradeInCart.forEach(item => {
    const itemData = { ...item, ...item.attributes };
    ipcRenderer.send('add-item', itemData); // Add trade-in items to inventory
  });
  
  ipcRenderer.send('complete-transaction', { items, type: 'trade', cashIn, cashOut });
  ipcRenderer.once('transaction-complete', (event, data) => {
    console.log('Trade transaction completed');
    tradeInCart.length = 0; // Clear trade-in cart
    tradeOutCart.length = 0; // Clear trade-out cart
    require('../renderer').showScreen('trade'); // Reload Trade screen
  });
  ipcRenderer.once('transaction-error', (event, error) => console.error('Trade transaction failed:', error));
}

// Clears the trade-in cart
function clearTradeInCart() {
  tradeInCart.length = 0; // Empty trade-in cart
  fetchInventory(tradeOutPage, tradeOutSearchTerm);
}

// Clears the trade-out cart
function clearTradeOutCart() {
  tradeOutCart.length = 0; // Empty trade-out cart
  fetchInventory(tradeOutPage, tradeOutSearchTerm);
}

// Updates attribute fields in the trade-in form based on item type
function updateAttributeFields(context) {
  const type = document.getElementById(`${context}-type-selector`).value;
  const attributesDiv = document.getElementById(`${context}-attributes`);
  const tcgFetchDiv = document.getElementById(`${context}-tcg-fetch`);
  const gameFetchDiv = document.getElementById(`${context}-game-fetch`);
  attributesDiv.innerHTML = ''; // Clear existing attributes
  if (tcgFetchDiv) tcgFetchDiv.style.display = (type === 'pokemon_tcg' || type === 'other_tcg') ? 'block' : 'none';
  if (gameFetchDiv) gameFetchDiv.style.display = (type === 'video_game') ? 'block' : 'none';

  // Add specific fields based on item type
  if (type === 'pokemon_tcg' || type === 'other_tcg') {
    attributesDiv.innerHTML = `
      <input id="${context}-tcg_id" type="hidden">
      <input id="${context}-card_set" type="hidden">
      <input id="${context}-rarity" type="hidden">
    `;
  } else if (type === 'video_game') {
    attributesDiv.innerHTML = `
      <div class="input-group">
        <label>Platform</label>
        <input id="${context}-platform" placeholder="e.g., PS4" type="text">
      </div>
    `;
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
    `;
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
    `;
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
    `;
  }
}

// Updates condition options in the trade-in form dropdown
function updateConditionOptions(context) {
  const type = document.getElementById(`${context}-type-selector`).value;
  const conditionSelect = document.getElementById(`${context}-condition-category`);
  conditionSelect.innerHTML = '<option value="">Select Condition</option>'; // Clear existing options

  const options = {
    'pokemon_tcg': ['Raw', 'PSA', 'CGC', 'BGS', 'TAG', 'Other'], // TCG-specific conditions
    'other_tcg': ['Raw', 'PSA', 'CGC', 'BGS', 'TAG', 'Other'], // TCG-specific conditions
    'video_game': ['New', 'Used', 'CIB', 'Loose', 'Graded'],
    'console': ['New', 'Used', 'Refurbished', 'Broken'], // Tech-specific conditions
    'football_shirt': ['New', 'Worn', 'Signed', 'Game-Worn'],
    'coin': ['Uncirculated', 'Circulated', 'Proof', 'Graded']
  }[type] || [];

  // Populate condition options
  options.forEach(option => {
    const opt = document.createElement('option');
    opt.value = option;
    opt.text = option;
    conditionSelect.appendChild(opt);
  });
}

module.exports = { render, fetchTcgCard, selectTcgCard, closeTcgModal, addToTradeInCart, addToTradeOutCart, updateTradeOutPrice, completeTradeTransaction, clearTradeInCart, clearTradeOutCart, updateAttributeFields };