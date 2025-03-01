const { ipcRenderer } = require('electron');
const { cleanPrice } = require('../utils');
const { buyItems } = require('../cart');

let allTcgCards = [];
let currentTcgPage = 1;
const itemsPerPage = 12;

function render(cart) {
  const totalPayout = cart.reduce((sum, item) => sum + item.tradeValue, 0);
  const content = document.getElementById('content');
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
  `;

  const typeSelector = document.getElementById('buy-type-selector');
  typeSelector.addEventListener('change', () => {
    console.log('Type changed to:', typeSelector.value);
    updateAttributeFields('buy');
    updateConditionOptions('buy');
  });
  updateAttributeFields('buy');
  updateConditionOptions('buy');

  document.getElementById('fetch-buy-card')?.addEventListener('click', () => fetchTcgCard('buy'));
  document.getElementById('close-tcg-modal-buy')?.addEventListener('click', () => closeTcgModal('buy'));
  document.getElementById('fetch-game-data')?.addEventListener('click', fetchGameData);
  document.getElementById('close-game-modal-buy')?.addEventListener('click', () => closeGameModal('buy'));
  document.getElementById('add-to-buy').addEventListener('click', addToBuy);
  document.getElementById('complete-buy').addEventListener('click', completeBuyTransaction);
  document.getElementById('clear-buy-cart').addEventListener('click', clearBuyCart);

  

  // Remove any existing listeners to prevent duplicates
  ipcRenderer.removeAllListeners('tcg-card-data');
  ipcRenderer.on('tcg-card-data', (event, cards) => {
    console.log('Received TCG card data for buy:', cards.length);
    allTcgCards = cards;
    currentTcgPage = 1;
    renderTcgModal('buy');
  });

  ipcRenderer.on('game-data', (event, games) => {
    const gameList = document.getElementById('game-list-buy');
    gameList.innerHTML = '';
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
    document.getElementById('game-modal-buy').style.display = 'flex';
    document.querySelectorAll('#game-list-buy .select-game').forEach(button => {
      button.addEventListener('click', () => {
        const index = parseInt(button.dataset.index);
        selectGame(games[index], 'buy');
      });
    });
  });

  ipcRenderer.on('tcg-card-error', (event, error) => console.error('TCG card fetch error:', error));
  ipcRenderer.on('game-data-error', (event, error) => console.error('Game data fetch error:', error));
}

function renderTcgModal(context) {
  console.log(`Rendering TCG modal for ${context}`);
  const modal = document.getElementById(`tcg-modal-${context}`);
  if (!modal) {
    console.error(`Modal #tcg-modal-${context} not found in DOM`);
    return;
  }
  const cardList = document.getElementById(`tcg-card-list-${context}`);
  const totalPages = Math.ceil(allTcgCards.length / itemsPerPage);
  const startIndex = (currentTcgPage - 1) * itemsPerPage;
  const paginatedCards = allTcgCards.slice(startIndex, startIndex + itemsPerPage);

  cardList.innerHTML = '';
  paginatedCards.forEach((card, index) => {
    const cardDiv = document.createElement('div');
    cardDiv.style = 'border: 1px solid #ccc; padding: 10px; width: 220px; text-align: center;';
    const priceHtml = `
      <p><strong>Prices:</strong></p>
      ${Object.entries(card.prices.tcgplayer).map(([rarity, prices]) => `
        <p>${rarity}: $${prices.market.toFixed(2)} (£${prices.market_gbp.toFixed(2)})</p>
      `).join('')}
      <p>Cardmarket Avg: €${card.prices.cardmarket.average.toFixed(2)} (£${card.prices.cardmarket.average_gbp.toFixed(2)})</p>
    `;
    cardDiv.innerHTML = `
      ${card.image_url ? `<img src="${card.image_url}" alt="${card.name}" style="width: auto; height: auto; max-width: 180px; max-height: 250px;">` : 'No Image'}
      <p><strong>${card.name}</strong></p>
      <p>Set: ${card.card_set}</p>
      <p>Rarity: ${card.rarity || 'N/A'}</p>
      ${priceHtml}
      <button class="select-tcg-card" data-index="${startIndex + index}">Select</button>
    `;
    cardList.appendChild(cardDiv);
  });

  document.getElementById(`tcg-page-info-${context}`).textContent = `Page ${currentTcgPage} of ${totalPages}`;
  document.getElementById(`tcg-prev-page-${context}`).disabled = currentTcgPage === 1;
  document.getElementById(`tcg-next-page-${context}`).disabled = currentTcgPage === totalPages;

  document.getElementById(`tcg-prev-page-${context}`).onclick = () => {
    if (currentTcgPage > 1) {
      currentTcgPage--;
      renderTcgModal(context);
    }
  };
  document.getElementById(`tcg-next-page-${context}`).onclick = () => {
    if (currentTcgPage < totalPages) {
      currentTcgPage++;
      renderTcgModal(context);
    }
  };

  modal.style.display = 'flex';
  document.querySelectorAll(`#tcg-card-list-${context} .select-tcg-card`).forEach(button => {
    button.addEventListener('click', () => {
      const index = parseInt(button.dataset.index);
      selectTcgCard(allTcgCards[index], context);
    });
  });
}

function fetchTcgCard(context) {
  const input = document.getElementById(`${context}-tcg-card-name`);
  if (!input) return console.error(`No input found for context: ${context}`);
  const cardName = input.value;
  if (!cardName) return console.error('No card name provided for', context);
  console.log(`Fetching TCG card for ${context}:`, cardName);
  ipcRenderer.send('get-tcg-card', cardName);
}

function selectTcgCard(card, context) {
  console.log(`Selected TCG card for ${context}:`, card);
  const prefix = context;
  document.getElementById(`${prefix}-type-selector`).value = 'pokemon_tcg';
  updateAttributeFields(context);
  updateConditionOptions(context);
  const nameField = document.getElementById(`${prefix}-name`);
  const priceField = document.getElementById(`${prefix}-price`);
  const tradeValueField = document.getElementById(`${prefix}-trade-value`);
  const conditionCategoryField = document.getElementById(`${prefix}-condition-category`);
  const conditionValueField = document.getElementById(`${prefix}-condition-value`);
  const imageUrlField = document.getElementById(`${prefix}-image-url`);
  const tcgIdField = document.getElementById(`${prefix}-tcg_id`);
  const cardSetField = document.getElementById(`${prefix}-card_set`);
  const rarityField = document.getElementById(`${prefix}-rarity`);

  if (nameField) nameField.value = card.name;
  const defaultPrice = card.prices.tcgplayer.holofoil?.market_gbp || card.prices.cardmarket.average_gbp || 0;
  if (priceField) priceField.value = defaultPrice;
  if (tradeValueField) tradeValueField.value = Math.floor(defaultPrice * 0.5);
  if (conditionCategoryField) conditionCategoryField.value = '';
  if (conditionValueField) conditionValueField.value = '';
  if (imageUrlField) imageUrlField.value = card.image_url || '';
  if (tcgIdField) tcgIdField.value = card.tcg_id || '';
  if (cardSetField) cardSetField.value = card.card_set || '';
  if (rarityField) rarityField.value = card.rarity || '';
  
  closeTcgModal(context);
}

function fetchGameData() {
  const type = document.getElementById('buy-type-selector').value;
  if (type !== 'video_game') return;
  const name = document.getElementById('buy-game-name').value || document.getElementById('buy-name').value;
  const platform = document.getElementById('buy-platform').value || '';
  if (!name) return console.error('Name required for video game fetch');
  console.log('Fetching game data for:', name, platform || 'all platforms');
  ipcRenderer.send('get-game-data', { name, platform });
}

function selectGame(game, context) {
  console.log(`Selected game for ${context}:`, game);
  const prefix = context;
  document.getElementById(`${prefix}-type-selector`).value = 'video_game';
  updateAttributeFields(context);
  updateConditionOptions(context);
  const nameField = document.getElementById(`${prefix}-name`);
  const priceField = document.getElementById(`${prefix}-price`);
  const tradeValueField = document.getElementById(`${prefix}-trade-value`);
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
  
  closeGameModal(context);
}

function closeTcgModal(context) {
  document.getElementById(`tcg-modal-${context}`).style.display = 'none';
}

function closeGameModal(context) {
  document.getElementById(`game-modal-${context}`).style.display = 'none';
}

function addToBuy() {
  const conditionCategory = document.getElementById('buy-condition-category').value;
  const conditionValue = document.getElementById('buy-condition-value').value;
  const condition = conditionCategory ? `${conditionCategory}${conditionValue ? ' ' + conditionValue : ''}` : conditionValue;
  const type = document.getElementById('buy-type-selector').value;
  const attributes = {};
  if (type === 'pokemon_tcg' || type === 'other_tcg') {
    attributes.tcg_id = document.getElementById('buy-tcg_id')?.value || null;
    attributes.card_set = document.getElementById('buy-card_set')?.value || null;
    attributes.rarity = document.getElementById('buy-rarity')?.value || null;
  } else if (type === 'video_game') {
    attributes.platform = document.getElementById('buy-platform')?.value || null;
  } else if (type === 'console') {
    attributes.brand = document.getElementById('buy-brand')?.value || null;
    attributes.model = document.getElementById('buy-model')?.value || null;
  } else if (type === 'football_shirt') {
    attributes.team = document.getElementById('buy-team')?.value || null;
    attributes.year = document.getElementById('buy-year')?.value || null;
  } else if (type === 'coin') {
    attributes.denomination = document.getElementById('buy-denomination')?.value || null;
    attributes.year_minted = document.getElementById('buy-year_minted')?.value || null;
  }

  const buyItem = {
    id: Date.now().toString(),
    type,
    name: document.getElementById('buy-name').value,
    price: parseFloat(document.getElementById('buy-price').value) || 0,
    tradeValue: parseFloat(document.getElementById('buy-trade-value').value) || 0,
    condition: condition || null,
    image_url: document.getElementById('buy-image-url').value || null,
    attributes,
    role: 'trade_in'
  };
  buyItems.push(buyItem);
  console.log('Adding to buy cart:', buyItem);
  render(buyItems);
}

function completeBuyTransaction() {
  console.log('Completing buy transaction:', { buyItems });
  const items = buyItems.slice();
  const cashIn = 0;
  const cashOut = buyItems.reduce((sum, item) => sum + parseFloat(item.tradeValue), 0);
  
  items.forEach(item => {
    const itemData = { ...item, ...item.attributes };
    ipcRenderer.send('add-item', itemData);
  });
  
  ipcRenderer.send('complete-transaction', { items, type: 'buy', cashIn, cashOut });
  ipcRenderer.once('transaction-complete', (event, data) => {
    console.log('Buy transaction completed');
    buyItems.length = 0;
    require('../renderer').showScreen('buy');
  });
  ipcRenderer.once('transaction-error', (event, error) => console.error('Buy transaction failed:', error));
}

function clearBuyCart() {
  buyItems.length = 0;
  require('../renderer').showScreen('buy');
}

function updateAttributeFields(context) {
  const type = document.getElementById(`${context}-type-selector`).value;
  const attributesDiv = document.getElementById(`${context}-attributes`);
  const tcgFetchDiv = document.getElementById(`${context}-tcg-fetch`);
  const gameFetchDiv = document.getElementById(`${context}-game-fetch`);
  attributesDiv.innerHTML = '';
  if (tcgFetchDiv) tcgFetchDiv.style.display = (type === 'pokemon_tcg' || type === 'other_tcg') ? 'block' : 'none';
  if (gameFetchDiv) gameFetchDiv.style.display = (type === 'video_game') ? 'block' : 'none';

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

function updateConditionOptions(context) {
  const type = document.getElementById(`${context}-type-selector`).value;
  const conditionSelect = document.getElementById(`${context}-condition-category`);
  conditionSelect.innerHTML = '<option value="">Select Condition</option>';

  const options = {
    'pokemon_tcg': ['Raw', 'PSA', 'CGC', 'BGS', 'TAG', 'Other'],
    'other_tcg': ['Raw', 'PSA', 'CGC', 'BGS', 'TAG', 'Other'],
    'video_game': ['New', 'Used', 'CIB', 'Loose', 'Graded'],
    'console': ['New', 'Used', 'Refurbished', 'Broken'],
    'football_shirt': ['New', 'Worn', 'Signed', 'Game-Worn'],
    'coin': ['Uncirculated', 'Circulated', 'Proof', 'Graded']
  }[type] || [];

  options.forEach(option => {
    const opt = document.createElement('option');
    opt.value = option;
    opt.text = option;
    conditionSelect.appendChild(opt);
  });
}

module.exports = { render, fetchTcgCard, selectTcgCard, closeTcgModal, addToBuy, completeBuyTransaction, clearBuyCart, updateAttributeFields };