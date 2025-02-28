const { ipcRenderer } = require('electron');
const { cleanPrice } = require('../utils');
const { buyItems } = require('../cart'); // Updated import

// Render the Buy tab UI with cart
function render(cart) {
  const totalPayout = cart.reduce((sum, item) => sum + item.tradeValue, 0);
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="section">
      <h3>Add Item</h3>
      <div class="input-group">
        <label>Search TCG Card</label>
        <input id="buy-tcg-card-name" placeholder="e.g., Charizard" type="text">
        <button id="fetch-buy-card">Fetch Card</button>
      </div>
      <div id="tcg-modal-buy" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000;">
        <div style="background: white; margin: 50px auto; padding: 20px; width: 80%; max-height: 80%; overflow-y: auto;">
          <h4>Select a Card</h4>
          <div id="tcg-card-list-buy" style="display: flex; flex-wrap: wrap; gap: 20px;"></div>
          <button id="close-tcg-modal-buy">Close</button>
        </div>
      </div>
      <div class="input-group">
        <label>Card Name</label>
        <input id="buy-name" placeholder="Enter card name" type="text">
      </div>
      <div class="input-group">
        <label>Type</label>
        <input id="buy-type" placeholder="e.g., pokemon_card" type="text">
      </div>
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
        <select id="buy-condition-category">
          <option value="">Select Category</option>
          <option value="Raw">Raw</option>
          <option value="PSA">PSA</option>
          <option value="CGC">CGC</option>
          <option value="BGS">BGS</option>
          <option value="TAG">TAG</option>
          <option value="Other">Other</option>
        </select>
        <input id="buy-condition-value" placeholder="e.g., NM, 7" type="text">
      </div>
      <div class="input-group">
        <label>Image</label>
        <input id="buy-image" type="file" accept="image/*">
      </div>
      <input id="buy-tcg-id" type="hidden">
      <input id="buy-card-set" type="hidden">
      <input id="buy-rarity" type="hidden">
      <input id="buy-image-url" type="hidden">
      <button id="add-to-buy">Add Item</button>
    </div>
    <div class="section">
      <h3>Buy Cart</h3>
      <ul id="buy-items">
        ${cart.map(item => `
          <li>
            ${item.image_url ? `<img src="${item.image_url}" alt="${item.name}" style="max-width: 50px;">` : ''}
            ${item.name} (${item.card_set || 'Unknown Set'}) - ${cleanPrice(item.tradeValue)} (${item.condition || 'Not Set'})
          </li>
        `).join('')}
      </ul>
      <p>Total Payout: ${cleanPrice(totalPayout.toFixed(2))}, Items: ${cart.length}</p>
      <button id="complete-buy">Complete Buy</button>
      <button id="clear-buy-cart">Clear Cart</button>
    </div>
  `;
  document.getElementById('fetch-buy-card').addEventListener('click', () => fetchTcgCard('buy'));
  document.getElementById('close-tcg-modal-buy').addEventListener('click', () => closeTcgModal('buy'));
  document.getElementById('add-to-buy').addEventListener('click', addToBuy);
  document.getElementById('complete-buy').addEventListener('click', completeBuyTransaction);
  document.getElementById('clear-buy-cart').addEventListener('click', clearBuyCart);
}

// Fetch TCG card data from API or DB for Buy selection
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

// Populate Buy form with selected TCG card data
function selectTcgCard(card, context) {
  console.log(`Selected TCG card for ${context}:`, card);
  const prefix = context;
  const nameField = document.getElementById(`${prefix}-name`);
  const typeField = document.getElementById(`${prefix}-type`);
  const priceField = document.getElementById(`${prefix}-price`);
  const tradeValueField = document.getElementById(`${prefix}-trade-value`);
  const conditionCategoryField = document.getElementById(`${prefix}-condition-category`);
  const conditionValueField = document.getElementById(`${prefix}-condition-value`);
  const tcgIdField = document.getElementById(`${prefix}-tcg-id`);
  const cardSetField = document.getElementById(`${prefix}-card-set`);
  const rarityField = document.getElementById(`${prefix}-rarity`);
  const imageUrlField = document.getElementById(`${prefix}-image-url`);

  if (!nameField) console.error(`No ${prefix}-name field found`);
  if (!typeField) console.error(`No ${prefix}-type field found`);
  if (!priceField) console.error(`No ${prefix}-price field found`);
  if (!tradeValueField) console.error(`No ${prefix}-trade-value field found`);

  if (nameField) nameField.value = card.name;
  if (typeField) typeField.value = card.type;
  if (priceField) priceField.value = card.price;
  if (tradeValueField) tradeValueField.value = Math.floor(card.price * 0.5);
  if (conditionCategoryField) conditionCategoryField.value = '';
  if (conditionValueField) conditionValueField.value = card.condition || '';
  if (tcgIdField) tcgIdField.value = card.tcg_id || '';
  if (cardSetField) cardSetField.value = card.card_set || '';
  if (rarityField) rarityField.value = card.rarity || '';
  if (imageUrlField) imageUrlField.value = card.image_url || '';
  
  closeTcgModal(context);
}

// Hide the TCG card selection modal
function closeTcgModal(context) {
  document.getElementById(`tcg-modal-${context}`).style.display = 'none';
}

// Add a manual item to the Buy cart and inventory
function addToBuy() {
  const conditionCategory = document.getElementById('buy-condition-category').value;
  const conditionValue = document.getElementById('buy-condition-value').value;
  const condition = conditionCategory ? `${conditionCategory}${conditionValue ? ' ' + conditionValue : ''}` : conditionValue;
  const buyItem = {
    id: Date.now().toString(),
    name: document.getElementById('buy-name').value,
    type: document.getElementById('buy-type').value,
    price: parseFloat(document.getElementById('buy-price').value) || 0,
    tradeValue: parseFloat(document.getElementById('buy-trade-value').value) || 0,
    condition: condition || null,
    image_url: document.getElementById('buy-image-url').value || null,
    tcg_id: document.getElementById('buy-tcg-id').value || null,
    card_set: document.getElementById('buy-card-set').value || null,
    rarity: document.getElementById('buy-rarity').value || null,
    role: 'trade_in'
  };
  buyItems.push(buyItem);
  console.log('Adding to buy:', buyItem);
  ipcRenderer.send('add-item', buyItem);
  ipcRenderer.once('add-item-success', () => require('../renderer').showScreen('buy'));
  ipcRenderer.once('add-item-error', (event, error) => console.error('Add item failed:', error));
}

// Complete a Buy transaction and clear the cart
function completeBuyTransaction() {
  console.log('Completing buy transaction:', { buyItems });
  const items = buyItems.slice();
  const cashIn = 0;
  const cashOut = buyItems.reduce((sum, item) => sum + parseFloat(item.tradeValue), 0);
  ipcRenderer.send('complete-transaction', { items, type: 'buy', cashIn, cashOut });
  ipcRenderer.once('transaction-complete', (event, data) => {
    console.log('Buy transaction completed');
    buyItems.length = 0;
    require('../renderer').showScreen('buy');
  });
  ipcRenderer.once('transaction-error', (event, error) => console.error('Buy transaction failed:', error));
}

// Clear the Buy cart and refresh the tab
function clearBuyCart() {
  buyItems.length = 0;
  require('../renderer').showScreen('buy');
}

module.exports = { render, fetchTcgCard, selectTcgCard, closeTcgModal, addToBuy, completeBuyTransaction, clearBuyCart };