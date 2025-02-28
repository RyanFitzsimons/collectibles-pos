const { ipcRenderer } = require('electron');
const { cleanPrice, debounce } = require('../utils');
const { tradeInCart, tradeOutCart } = require('../cart');

// Fetch inventory data from main process for Trade-Out
function fetchInventory(page, searchTerm) {
  ipcRenderer.send('get-inventory', { page, limit: 50, search: searchTerm });
  ipcRenderer.once('inventory-data', (event, { items, total }) => {
    render(page, searchTerm, tradeInCart, tradeOutCart, items, total);
  });
}

// Render the Trade tab UI with Trade-In and Trade-Out sections
function render(page, searchTerm, inCart, outCart, inventory = null, total = null) {
  const content = document.getElementById('content');
  if (!inventory || total === null) {
    fetchInventory(page, searchTerm);
    return;
  }

  const tradeInTotal = inCart.reduce((sum, item) => sum + item.tradeValue, 0);
  const tradeOutTotal = outCart.reduce((sum, item) => sum + (parseFloat(item.negotiatedPrice) || item.price), 0);
  const cashDue = Math.max(tradeOutTotal - tradeInTotal, 0);
  const cashBack = tradeInTotal > tradeOutTotal ? tradeInTotal - tradeOutTotal : 0;
  const totalPages = Math.ceil(total / 50);

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
          <div id="tcg-modal-trade-in" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000;">
            <div style="background: white; margin: 50px auto; padding: 20px; width: 80%; max-height: 80%; overflow-y: auto;">
              <h4>Select a Card</h4>
              <div id="tcg-card-list-trade-in" style="display: flex; flex-wrap: wrap; gap: 20px;"></div>
              <button id="close-tcg-modal-trade-in">Close</button>
            </div>
          </div>
          <div class="input-group">
            <label>Name</label>
            <input id="trade-in-name" placeholder="Enter item name" type="text">
          </div>
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
            <select id="trade-in-condition-category">
              <option value="">Select Category</option>
              <option value="Raw">Raw</option>
              <option value="PSA">PSA</option>
              <option value="CGC">CGC</option>
              <option value="BGS">BGS</option>
              <option value="TAG">TAG</option>
              <option value="Other">Other</option>
            </select>
            <input id="trade-in-condition-value" placeholder="e.g., NM, 7" type="text">
          </div>
          <div class="input-group">
            <label>Image</label>
            <input id="trade-in-image" type="file" accept="image/*">
          </div>
          <input id="trade-in-image-url" type="hidden">
          <div id="trade-in-attributes"></div>
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
          <input id="trade-out-search" type="text" placeholder="Search inventory (e.g., Charizard, Base Set)" value="${searchTerm}">
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

  // Add event listeners after DOM is rendered
  const typeSelector = document.getElementById('trade-in-type-selector');
  typeSelector.addEventListener('change', () => {
    console.log('Type changed to:', typeSelector.value); // Debug log
    updateAttributeFields('trade-in');
  });
  updateAttributeFields('trade-in'); // Initial call

  document.getElementById('trade-out-search').addEventListener('input', debounce((e) => {
    fetchInventory(1, e.target.value);
  }, 600));
  document.getElementById('fetch-trade-in-card')?.addEventListener('click', () => fetchTcgCard('trade-in'));
  document.getElementById('close-tcg-modal-trade-in')?.addEventListener('click', () => closeTcgModal('trade-in'));
  document.getElementById('add-to-trade-in').addEventListener('click', addToTradeInCart);
  document.getElementById('complete-trade').addEventListener('click', completeTradeTransaction);
  document.getElementById('clear-trade-in-cart').addEventListener('click', clearTradeInCart);
  document.getElementById('clear-trade-out-cart').addEventListener('click', clearTradeOutCart);
  document.getElementById('trade-out-prev-page').addEventListener('click', () => fetchInventory(page - 1, searchTerm));
  document.getElementById('trade-out-next-page').addEventListener('click', () => fetchInventory(page + 1, searchTerm));
  document.querySelectorAll('.add-to-trade-out').forEach(button => {
    button.addEventListener('click', () => {
      const { id, name, price, image, set, condition } = button.dataset;
      addToTradeOutCart(id, name, parseFloat(price), decodeURIComponent(image), set, condition);
    });
  });
  document.querySelectorAll('.trade-out-price-input').forEach(input => {
    input.addEventListener('change', (e) => updateTradeOutPrice(input.dataset.id, e.target.value));
  });
}

// Fetch TCG card data from API or DB for Trade-In selection (Pokémon TCG only for now)
function fetchTcgCard(context) {
  const input = document.getElementById(`${context}-tcg-card-name`);
  if (!input) {
    console.error(`No input found for context: ${context}`);
    return;
  }
  const cardName = input.value;
  if (!cardName) {
    console.error('No card name provided for', context);
    return;
  }
  console.log(`Fetching TCG card for ${context}:`, cardName);
  ipcRenderer.send('get-tcg-card', cardName);
  ipcRenderer.once('tcg-card-data', (event, cards) => {
    console.log(`Received TCG card data for ${context}:`, cards);
    const cardList = document.getElementById(`tcg-card-list-${context}`);
    if (!cardList) {
      console.error(`No card list found for context: ${context}`);
      return;
    }
    cardList.innerHTML = '';
    cards.forEach((card, index) => {
      const cardDiv = document.createElement('div');
      cardDiv.style = 'border: 1px solid #ccc; padding: 10px; width: 200px; text-align: center;';
      cardDiv.innerHTML = `
        <img src="${card.image_url}" alt="${card.name}" style="width: auto; height: auto; max-width: 180px; max-height: 250px;">
        <p><strong>${card.name}</strong></p>
        <p>Set: ${card.card_set}</p>
        <p>Rarity: ${card.rarity}</p>
        <p>Price: ${cleanPrice(card.price.toFixed(2))}</p>
        <button class="select-tcg-card" data-index="${index}">Select</button>
      `;
      cardList.appendChild(cardDiv);
    });
    const modal = document.getElementById(`tcg-modal-${context}`);
    if (modal) modal.style.display = 'flex';

    document.querySelectorAll(`#tcg-card-list-${context} .select-tcg-card`).forEach(button => {
      button.addEventListener('click', () => {
        const index = parseInt(button.dataset.index);
        selectTcgCard(cards[index], context);
      });
    });
  });
  ipcRenderer.once('tcg-card-error', (event, error) => console.error(`TCG card fetch failed for ${context}:`, error));
}

// Populate Trade-In form with selected TCG card data
function selectTcgCard(card, context) {
  console.log(`Selected TCG card for ${context}:`, card);
  const prefix = context;
  document.getElementById(`${prefix}-type-selector`).value = 'pokemon_tcg'; // Set type
  updateAttributeFields(context); // Update fields
  const nameField = document.getElementById(`${prefix}-name`);
  const priceField = document.getElementById(`${prefix}-price`);
  const tradeValueField = document.getElementById(`${prefix}-value`);
  const conditionCategoryField = document.getElementById(`${prefix}-condition-category`);
  const conditionValueField = document.getElementById(`${prefix}-condition-value`);
  const imageUrlField = document.getElementById(`${prefix}-image-url`);
  const tcgIdField = document.getElementById(`${prefix}-tcg_id`);
  const cardSetField = document.getElementById(`${prefix}-card_set`);
  const rarityField = document.getElementById(`${prefix}-rarity`);

  if (nameField) nameField.value = card.name;
  if (priceField) priceField.value = card.price;
  if (tradeValueField) tradeValueField.value = Math.floor(card.price * 0.5);
  if (conditionCategoryField) conditionCategoryField.value = '';
  if (conditionValueField) conditionValueField.value = card.condition || '';
  if (imageUrlField) imageUrlField.value = card.image_url || '';
  if (tcgIdField) tcgIdField.value = card.tcg_id || '';
  if (cardSetField) cardSetField.value = card.card_set || '';
  if (rarityField) rarityField.value = card.rarity || '';
  
  closeTcgModal(context);
}

// Hide the TCG card selection modal
function closeTcgModal(context) {
  document.getElementById(`tcg-modal-${context}`).style.display = 'none';
}

// Add a manual item to the Trade-In cart (no inventory add yet)
function addToTradeInCart() {
  const conditionCategory = document.getElementById('trade-in-condition-category').value;
  const conditionValue = document.getElementById('trade-in-condition-value').value;
  const condition = conditionCategory ? `${conditionCategory}${conditionValue ? ' ' + conditionValue : ''}` : conditionValue;
  const type = document.getElementById('trade-in-type-selector').value;
  const attributes = {};
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
    id: Date.now().toString(),
    type,
    name: document.getElementById('trade-in-name').value,
    price: parseFloat(document.getElementById('trade-in-price').value) || 0,
    tradeValue: parseFloat(document.getElementById('trade-in-value').value) || 0,
    condition: condition || null,
    image_url: document.getElementById('trade-in-image-url').value || null,
    attributes,
    role: 'trade_in'
  };
  tradeInCart.push(tradeInItem);
  console.log('Adding to trade-in cart:', tradeInItem);
  render(tradeOutPage, tradeOutSearchTerm, tradeInCart, tradeOutCart); // Refresh Trade tab with updated cart
}

// Add an item from inventory to the Trade-Out cart
function addToTradeOutCart(id, name, price, image_url, card_set, condition) {
  console.log('Adding to trade-out cart:', { id, name, price, image_url, card_set, condition });
  tradeOutCart.push({ id, name, price, image_url: decodeURIComponent(image_url), card_set, condition, role: 'trade_out' });
  fetchInventory(tradeOutPage, tradeOutSearchTerm); // Refresh Trade tab with updated cart
}

// Update the negotiated price for an item in the Trade-Out cart
function updateTradeOutPrice(id, value) {
  const index = tradeOutCart.findIndex(item => item.id === id);
  if (index !== -1) {
    tradeOutCart[index].negotiatedPrice = parseFloat(value) || tradeOutCart[index].price;
    console.log('Updated trade-out price:', tradeOutCart[index]);
  }
  fetchInventory(tradeOutPage, tradeOutSearchTerm); // Refresh Trade tab with updated total
}

// Complete a Trade transaction, add Trade-In items to inventory, and clear both carts
function completeTradeTransaction() {
  console.log('Completing trade transaction:', { tradeInCart, tradeOutCart });
  const items = [...tradeInCart, ...tradeOutCart];
  const cashIn = tradeOutCart.reduce((sum, item) => sum + parseFloat(item.negotiatedPrice || item.price), 0);
  const cashOut = tradeInCart.reduce((sum, item) => sum + parseFloat(item.tradeValue), 0);
  
  // Add Trade-In items to inventory only on completion
  tradeInCart.forEach(item => {
    const itemData = { ...item, ...item.attributes }; // Flatten attributes for backward compatibility
    ipcRenderer.send('add-item', itemData);
  });
  
  ipcRenderer.send('complete-transaction', { items, type: 'trade', cashIn, cashOut });
  ipcRenderer.once('transaction-complete', (event, data) => {
    console.log('Trade transaction completed');
    tradeInCart.length = 0;
    tradeOutCart.length = 0;
    require('../renderer').showScreen('trade');
  });
  ipcRenderer.once('transaction-error', (event, error) => console.error('Trade transaction failed:', error));
}

// Clear the Trade-In cart and refresh the tab
function clearTradeInCart() {
  tradeInCart.length = 0;
  fetchInventory(tradeOutPage, tradeOutSearchTerm);
}

// Clear the Trade-Out cart and refresh the tab
function clearTradeOutCart() {
  tradeOutCart.length = 0;
  fetchInventory(tradeOutPage, tradeOutSearchTerm);
}

// Update attribute fields based on selected type
function updateAttributeFields(context) {
  const type = document.getElementById(`${context}-type-selector`).value;
  const attributesDiv = document.getElementById(`${context}-attributes`);
  const tcgFetchDiv = document.getElementById(`${context}-tcg-fetch`);
  attributesDiv.innerHTML = '';
  if (tcgFetchDiv) {
    console.log('Updating TCG fetch visibility for', type); // Debug log
    tcgFetchDiv.style.display = (type === 'pokemon_tcg' || type === 'other_tcg') ? 'block' : 'none';
  }

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

module.exports = { render, fetchTcgCard, selectTcgCard, closeTcgModal, addToTradeInCart, addToTradeOutCart, updateTradeOutPrice, completeTradeTransaction, clearTradeInCart, clearTradeOutCart, updateAttributeFields };