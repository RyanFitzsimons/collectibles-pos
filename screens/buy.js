// Imports required modules for Electron communication, utilities, and file operations
const { ipcRenderer } = require('electron');  // Electron IPC for communicating with main process
const { cleanPrice } = require('../utils');  // Utility function to format prices with £ symbol
const { buyItems } = require('../cart');  // Cart module providing the buyItems array
const axios = require('axios');  // Library for HTTP requests, used for fetching and caching images
const fs = require('fs');  // File system module for saving cached images
const path = require('path');  // Path utilities for constructing file paths

// Global variables for TCG card modal pagination
let allTcgCards = [];  // Array to store all fetched TCG cards
let currentTcgPage = 1;  // Tracks the current page of TCG cards displayed in the modal
const itemsPerPage = 12;  // Number of TCG cards shown per page in the modal

// Renders the Buy screen UI, including the form and cart sections
function render(cart) {
  const totalPayout = cart.reduce((sum, item) => sum + item.tradeValue, 0);  // Calculates total trade value of items in cart
  const content = document.getElementById('content');  // Gets the main content container from the DOM
  content.innerHTML = `
    <div class="section">
      <h3>Add Item</h3>
      <div class="input-group">
        <label>Item Type</label>
        <select id="buy-type-selector">
          <option value="pokemon_tcg">Pokémon TCG</option>
          <option value="video_game">Video Game</option>
          <option value="console">Console</option>
          <option value="football_shirt">Football Shirt</option>
          <option value="coin">Coin</option>
          <option value="other_tcg">Other TCG</option>
        </select>
      </div>
      <div class="input-group" id="buy-tcg-fetch" style="display: none;">
        <label>Search TCG Card</label>
        <input id="buy-tcg-card-name" placeholder="e.g., Charizard" type="text">
        <button id="fetch-buy-card">Fetch Card</button>
      </div>
      <div class="input-group" id="buy-game-fetch" style="display: none;">
        <label>Search Game</label>
        <input id="buy-game-name" placeholder="e.g., FIFA 21" type="text">
        <button id="fetch-game-data">Fetch Game</button>
      </div>
      <div id="tcg-modal-buy" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000;">
        <div style="background: white; margin: 50px auto; padding: 20px; width: 80%; max-height: 80%; overflow-y: auto;">
          <h4>Select a Card</h4>
          <div id="tcg-card-list-buy" style="display: flex; flex-wrap: wrap; gap: 20px;"></div>
          <div style="margin-top: 20px;">
            <button id="tcg-prev-page-buy" disabled>Previous</button>
            <span id="tcg-page-info-buy">Page 1</span>
            <button id="tcg-next-page-buy">Next</button>
          </div>
          <button id="close-tcg-modal-buy">Close</button>
        </div>
      </div>
      <div class="input-group">
        <label>Name</label>
        <input id="buy-name" placeholder="Enter item name" type="text">
      </div>
      <div id="buy-attributes"></div>
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
        <select id="buy-condition-category"></select>
        <input id="buy-condition-value" placeholder="e.g., scratches" type="text">
      </div>
      <div class="input-group">
        <label>Image</label>
        <input id="buy-image" type="file" accept="image/*">
      </div>
      <input id="buy-image-url" type="hidden">
      <button id="add-to-buy">Add Item</button>
    </div>
    <div class="section">
      <h3>Buy Cart</h3>
      <ul id="buy-items">
        ${cart.map(item => `
          <li>
            ${item.image_url ? `<img src="${item.image_url}" alt="${item.name}" style="max-width: 50px;">` : ''}
            ${item.name} (${item.type}) - ${cleanPrice(item.tradeValue)} (${item.condition || 'Not Set'})
          </li>
        `).join('')}
      </ul>
      <p>Total Payout: ${cleanPrice(totalPayout.toFixed(2))}, Items: ${cart.length}</p>
      <button id="complete-buy">Complete Buy</button>
      <button id="clear-buy-cart">Clear Cart</button>
    </div>
  `;  // Sets the HTML content for the Buy screen

  // Sets up event listener for item type selection
  const typeSelector = document.getElementById('buy-type-selector');
  typeSelector.addEventListener('change', () => {
    console.log('Type changed to:', typeSelector.value);  // Logs the selected type
    updateAttributeFields('buy');  // Updates form fields based on type
    updateConditionOptions('buy');  // Updates condition dropdown
  });
  updateAttributeFields('buy');  // Initial call to set up attributes
  updateConditionOptions('buy');  // Initial call to set up condition options

  // Adds event listeners for UI buttons
  document.getElementById('fetch-buy-card')?.addEventListener('click', () => fetchTcgCard('buy'));  // Fetches TCG card data
  document.getElementById('close-tcg-modal-buy')?.addEventListener('click', () => closeTcgModal('buy'));  // Closes TCG modal
  document.getElementById('fetch-game-data')?.addEventListener('click', fetchGameData);  // Fetches game data
  document.getElementById('close-game-modal-buy')?.addEventListener('click', () => closeGameModal('buy'));  // Closes game modal
  document.getElementById('add-to-buy').addEventListener('click', addToBuy);  // Adds item to cart
  document.getElementById('complete-buy').addEventListener('click', completeBuyTransaction);  // Completes buy transaction
  document.getElementById('clear-buy-cart').addEventListener('click', clearBuyCart);  // Clears the cart

  // Removes any existing TCG card data listeners to prevent duplicates
  ipcRenderer.removeAllListeners('tcg-card-data');
  ipcRenderer.on('tcg-card-data', (event, cards) => {
    console.log('Received TCG card data for buy:', cards.length);  // Logs number of cards received
    allTcgCards = cards;  // Stores fetched TCG cards
    currentTcgPage = 1;  // Resets to first page
    renderTcgModal('buy');  // Renders TCG selection modal
  });

  // Handles game data received from main process
  ipcRenderer.on('game-data', (event, games) => {
    const gameList = document.getElementById('game-list-buy');  // Gets container for game list
    gameList.innerHTML = '';  // Clears existing game entries
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
    document.getElementById('game-modal-buy').style.display = 'flex';  // Shows game selection modal
    document.querySelectorAll('#game-list-buy .select-game').forEach(button => {
      button.addEventListener('click', () => {
        const index = parseInt(button.dataset.index);  // Gets index of selected game
        selectGame(games[index], 'buy');  // Populates form with selected game
      });
    });
  });

  // Logs errors from main process for TCG card or game data fetching
  ipcRenderer.on('tcg-card-error', (event, error) => console.error('TCG card fetch error:', error));
  ipcRenderer.on('game-data-error', (event, error) => console.error('Game data fetch error:', error));
}

// Renders the TCG card selection modal with pagination
function renderTcgModal(context) {
  console.log(`Rendering TCG modal for ${context}`);  // Logs modal rendering start
  const modal = document.getElementById(`tcg-modal-${context}`);  // Gets modal element
  if (!modal) {
    console.error(`Modal #tcg-modal-${context} not found in DOM`);  // Error if modal missing
    return;
  }
  const cardList = document.getElementById(`tcg-card-list-${context}`);  // Gets card list container
  const totalPages = Math.ceil(allTcgCards.length / itemsPerPage);  // Calculates total pages
  const startIndex = (currentTcgPage - 1) * itemsPerPage;  // Start index for current page
  const paginatedCards = allTcgCards.slice(startIndex, startIndex + itemsPerPage);  // Slices cards for current page

  cardList.innerHTML = '';  // Clears existing cards in list
  paginatedCards.forEach((card, index) => {
    const cardDiv = document.createElement('div');
    cardDiv.style = 'border: 1px solid #ccc; padding: 10px; width: 220px; text-align: center;';  // Styles card element
    const priceHtml = `
      <p><strong>Prices:</strong></p>
      ${Object.entries(card.prices.tcgplayer).map(([rarity, prices]) => `
        <p>${rarity}: $${prices.market.toFixed(2)} (£${prices.market_gbp.toFixed(2)})</p>
      `).join('')}
      <p>Cardmarket Avg: €${card.prices.cardmarket.average.toFixed(2)} (£${card.prices.cardmarket.average_gbp.toFixed(2)})</p>
    `;  // Formats price data for display
    cardDiv.innerHTML = `
      ${card.image_url ? `<img src="${card.image_url}" alt="${card.name}" style="width: auto; height: auto; max-width: 180px; max-height: 250px;">` : 'No Image'}
      <p><strong>${card.name}</strong></p>
      <p>Set: ${card.card_set}</p>
      <p>Rarity: ${card.rarity || 'N/A'}</p>
      ${priceHtml}
      <button class="select-tcg-card" data-index="${startIndex + index}">Select</button>
    `;  // HTML for each card
    cardList.appendChild(cardDiv);  // Adds card to list
  });

  // Updates pagination controls
  document.getElementById(`tcg-page-info-${context}`).textContent = `Page ${currentTcgPage} of ${totalPages}`;  // Shows current page info
  document.getElementById(`tcg-prev-page-${context}`).disabled = currentTcgPage === 1;  // Disables Previous if on first page
  document.getElementById(`tcg-next-page-${context}`).disabled = currentTcgPage === totalPages;  // Disables Next if on last page

  document.getElementById(`tcg-prev-page-${context}`).onclick = () => {
    if (currentTcgPage > 1) {
      currentTcgPage--;  // Moves to previous page
      renderTcgModal(context);
    }
  };
  document.getElementById(`tcg-next-page-${context}`).onclick = () => {
    if (currentTcgPage < totalPages) {
      currentTcgPage++;  // Moves to next page
      renderTcgModal(context);
    }
  };

  modal.style.display = 'flex';  // Displays the modal
  document.querySelectorAll(`#tcg-card-list-${context} .select-tcg-card`).forEach(button => {
    button.addEventListener('click', () => {
      const index = parseInt(button.dataset.index);  // Gets index of selected card
      selectTcgCard(allTcgCards[index], context);  // Populates form with selected card
    });
  });
}

// Fetches TCG card data from the main process based on user input
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
  const tradeValueField = document.getElementById(`${prefix}-trade-value`);  // Trade value input
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

// Fetches game data from the main process based on user input
function fetchGameData() {
  const type = document.getElementById('buy-type-selector').value;  // Gets selected item type
  if (type !== 'video_game') return;  // Exits if not video game type
  const name = document.getElementById('buy-game-name').value || document.getElementById('buy-name').value;  // Gets game name from search or main field
  const platform = document.getElementById('buy-platform').value || '';  // Gets platform if specified
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
  const tradeValueField = document.getElementById(`${prefix}-trade-value`);  // Trade value input
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

// Adds an item to the buy cart from form inputs
function addToBuy() {
  const conditionCategory = document.getElementById('buy-condition-category').value;  // Gets condition category
  const conditionValue = document.getElementById('buy-condition-value').value;  // Gets condition details
  const condition = conditionCategory ? `${conditionCategory}${conditionValue ? ' ' + conditionValue : ''}` : conditionValue;  // Combines condition data
  const type = document.getElementById('buy-type-selector').value;  // Gets selected item type
  const attributes = {};  // Object to store type-specific attributes

  // Populates attributes based on item type
  if (type === 'pokemon_tcg' || type === 'other_tcg') {
    attributes.tcg_id = document.getElementById('buy-tcg_id')?.value || null;  // TCG ID
    attributes.card_set = document.getElementById('buy-card_set')?.value || null;  // Card set
    attributes.rarity = document.getElementById('buy-rarity')?.value || null;  // Rarity
  } else if (type === 'video_game') {
    attributes.platform = document.getElementById('buy-platform')?.value || null;  // Platform for video games
  } else if (type === 'console') {
    attributes.brand = document.getElementById('buy-brand')?.value || null;  // Console brand
    attributes.model = document.getElementById('buy-model')?.value || null;  // Console model
  } else if (type === 'football_shirt') {
    attributes.team = document.getElementById('buy-team')?.value || null;  // Shirt team
    attributes.year = document.getElementById('buy-year')?.value || null;  // Shirt year
  } else if (type === 'coin') {
    attributes.denomination = document.getElementById('buy-denomination')?.value || null;  // Coin denomination
    attributes.year_minted = document.getElementById('buy-year_minted')?.value || null;  // Coin year minted
  }

  const imageUrlField = document.getElementById('buy-image-url');  // Hidden image URL field
  const imageUrl = imageUrlField?.value || null;  // Gets cached image URL
  console.log('Adding item with image_url:', imageUrl);  // Logs image URL for debugging

  const buyItem = {
    id: Date.now().toString(),  // Generates unique ID based on current timestamp
    type,  // Item type from selector
    name: document.getElementById('buy-name').value,  // Item name from input
    price: parseFloat(document.getElementById('buy-price').value) || 0,  // Market price, defaults to 0 if invalid
    tradeValue: parseFloat(document.getElementById('buy-trade-value').value) || 0,  // Trade value, defaults to 0 if invalid
    condition: condition || null,  // Combined condition or null if empty
    image_url: imageUrl,  // Cached image URL or null
    attributes,  // Type-specific attributes
    role: 'trade_in'  // Marks item as a trade-in from customer
  };
  buyItems.push(buyItem);  // Adds item to buyItems cart array
  console.log('Adding to buy cart:', buyItem);  // Logs added item
  render(buyItems);  // Refreshes UI with updated cart
}

// Completes the buy transaction, sending items to the main process
function completeBuyTransaction() {
  console.log('Completing buy transaction:', { buyItems });  // Logs transaction start
  const items = buyItems.slice();  // Creates a copy of the cart items
  const cashIn = 0;  // No cash received from customer for Buy transaction
  const cashOut = buyItems.reduce((sum, item) => sum + parseFloat(item.tradeValue), 0);  // Total amount paid to customer
  
  items.forEach(item => {
    const itemData = { ...item, ...item.attributes };  // Merges item data with its attributes
    ipcRenderer.send('add-item', itemData);  // Sends each item to main process for inventory addition
  });
  
  ipcRenderer.send('complete-transaction', { items, type: 'buy', cashIn, cashOut });  // Sends transaction data to main process
  ipcRenderer.once('transaction-complete', (event, data) => {
    console.log('Buy transaction completed');  // Logs successful completion
    buyItems.length = 0;  // Clears the cart
    require('../renderer').showScreen('buy');  // Reloads the Buy screen
  });
  ipcRenderer.once('transaction-error', (event, error) => console.error('Buy transaction failed:', error));  // Logs any transaction errors
}

// Clears the buy cart and refreshes the UI
function clearBuyCart() {
  buyItems.length = 0;  // Empties the buyItems array
  require('../renderer').showScreen('buy');  // Reloads the Buy screen with an empty cart
}

// Updates the attribute fields in the form based on selected item type
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

// Updates condition options in the dropdown based on item type
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
module.exports = { render, fetchTcgCard, selectTcgCard, closeTcgModal, addToBuy, completeBuyTransaction, clearBuyCart, updateAttributeFields };