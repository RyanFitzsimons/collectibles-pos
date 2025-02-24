const { ipcRenderer } = require('electron');

let sellCart = [];
let tradeInCart = [];
let tradeOutCart = [];
let buyItems = [];
let currentInventory = [];

function showScreen(screen) {
  console.log('Showing screen:', screen, { sellCart, tradeInCart, tradeOutCart, buyItems });
  const content = document.getElementById('content');
  
  if (screen === 'sell') {
    ipcRenderer.send('get-inventory');
    ipcRenderer.once('inventory-data', (event, inventory) => {
      currentInventory = inventory || [];
      console.log('Loaded inventory:', currentInventory);
      renderSellTab(currentInventory);
    });
  } else if (screen === 'buy') {
    const totalPayout = buyItems.reduce((sum, item) => sum + item.tradeValue, 0);
    content.innerHTML = `
      <h3>Buy from Customer</h3>
      <input id="tcg-card-name" placeholder="Card Name (e.g., Charizard)">
      <button onclick="fetchTcgCard('buy')">Fetch Card</button>
      <div id="tcg-modal-buy" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000;">
        <div style="background: white; margin: 50px auto; padding: 20px; width: 80%; max-height: 80%; overflow-y: auto;">
          <h4>Select a Card</h4>
          <div id="tcg-card-list-buy" style="display: flex; flex-wrap: wrap; gap: 20px;"></div>
          <button onclick="closeTcgModal('buy')">Close</button>
        </div>
      </div>
      <input id="buy-name" placeholder="Name">
      <input id="buy-type" placeholder="Type (e.g., pokemon_card)">
      <input id="buy-price" type="number" placeholder="Market Price">
      <input id="buy-trade-value" type="number" placeholder="Trade Value">
      <select id="buy-condition-category">
        <option value="">Select Category</option>
        <option value="Raw">Raw</option>
        <option value="PSA">PSA</option>
        <option value="CGC">CGC</option>
        <option value="BGS">BGS</option>
        <option value="TAG">TAG</option>
        <option value="Other">Other</option>
      </select>
      <input id="buy-condition-value" type="text" placeholder="Condition/Grade (e.g., NM, 7)">
      <input id="buy-image" type="file" accept="image/*">
      <input id="buy-tcg-id" type="hidden">
      <input id="buy-card-set" type="hidden">
      <input id="buy-rarity" type="hidden">
      <input id="buy-image-url" type="hidden">
      <button onclick="addToBuy()">Add Item</button>
      <ul id="buy-items">
        ${buyItems.map(item => `
          <li>
            ${item.image_url ? `<img src="${item.image_url}" alt="${item.name}" style="max-width: 50px;">` : ''}
            ${item.name} (${item.card_set || 'Unknown Set'}) - £${item.tradeValue} (${item.condition || 'Not Set'})
          </li>
        `).join('')}
      </ul>
      <p>Total Payout: £${totalPayout.toFixed(2)}</p>
      <button onclick="completeBuyTransaction()">Complete Buy</button>
    `;
  } else if (screen === 'trade') {
    ipcRenderer.send('get-inventory');
    ipcRenderer.once('inventory-data', (event, inventory) => {
      currentInventory = inventory || [];
      console.log('Loaded inventory:', currentInventory);
      renderTradeTab(currentInventory);
    });
  } else if (screen === 'transactions') {
    ipcRenderer.send('get-transactions');
    ipcRenderer.once('transactions-data', (event, rows) => {
      const transactions = {};
      rows.forEach(row => {
        if (!transactions[row.id]) {
          transactions[row.id] = { type: row.type, cash_in: row.cash_in, cash_out: row.cash_out, timestamp: row.timestamp, items: [] };
        }
        if (row.item_id) {
          transactions[row.id].items.push({
            item_id: row.item_id,
            name: row.item_name,
            role: row.role,
            trade_value: row.trade_value,
            negotiated_price: row.negotiated_price,
            original_price: row.original_price,
            image_url: row.image_url,
            condition: row.condition,
            card_set: row.card_set
          });
        }
      });
      content.innerHTML = `
        <h3>Transactions</h3>
        <ul>
          ${Object.entries(transactions).map(([id, tx]) => `
            <li>
              ID: ${id}, Type: ${tx.type}, Cash In: £${tx.cash_in || 0}, Cash Out: £${tx.cash_out || 0}, Time: ${tx.timestamp}
              <ul>
                ${tx.items.map(item => `
                  <li>
                    ${item.image_url ? `<img src="${item.image_url}" alt="${item.name}">` : ''}
                    ${item.name} (${item.card_set || 'Unknown Set'}) (${item.condition || 'Not Set'}) (${item.role === 'trade_in' ? 'Trade-In' : item.role === 'trade_out' ? 'Trade-Out' : 'Sold'}) - 
                    ${item.role === 'trade_in' ? `Trade Value: £${item.trade_value}` : `Sold For: £${item.negotiated_price || item.original_price}`}
                  </li>
                `).join('')}
              </ul>
            </li>
          `).join('')}
        </ul>
      `;
    });
  }
}

function renderSellTab(inventory) {
  console.log('Rendering Sell tab with:', { inventory });
  const totalListed = sellCart.reduce((sum, item) => sum + item.price, 0);
  const totalNegotiated = sellCart.reduce((sum, item) => sum + (item.negotiatedPrice || item.price), 0);
  document.getElementById('content').innerHTML = `
    <h3>Sell to Customer</h3>
    <div>
      <h4>Inventory</h4>
      <input id="sell-search" type="text" placeholder="Search inventory (e.g., Charizard, Base Set)" oninput="filterInventory('sell', this.value)">
      <ul id="sell-inventory-list">
        ${inventory.map(item => `
          <li>
            ${item.image_url ? `<img src="${item.image_url}" alt="${item.name}">` : ''}
            ${item.name} (${item.card_set || 'Unknown Set'}) - £${item.price} (${item.condition || 'Not Set'}) <button onclick="addToSellCart('${item.id}', '${item.name}', ${item.price}, '${item.image_url || ''}', '${item.card_set || ''}', '${item.condition || ''}')">Add</button>
          </li>
        `).join('')}
      </ul>
    </div>
    <div>
      <h4>Sell Cart</h4>
      <ul id="sell-cart-items">
        ${sellCart.map(item => `
          <li>
            ${item.image_url ? `<img src="${item.image_url}" alt="${item.name}" style="max-width: 50px;">` : ''}
            ${item.name} (${item.card_set || 'Unknown Set'}) - 
            <input type="number" value="${item.negotiatedPrice}" onchange="updateSellPrice('${item.id}', this.value)" style="width: 60px;">
            (Original: £${item.price}, ${item.condition || 'Not Set'})
          </li>
        `).join('')}
      </ul>
      <p>Total Listed: £${totalListed.toFixed(2)}</p>
      <p>Total Negotiated: £${totalNegotiated.toFixed(2)}</p>
      <button onclick="completeSellTransaction()">Complete Sell</button>
    </div>
  `;
}

function renderTradeTab(inventory) {
  const tradeInTotal = tradeInCart.reduce((sum, item) => sum + item.tradeValue, 0);
  const tradeOutTotal = tradeOutCart.reduce((sum, item) => sum + (item.negotiatedPrice || item.price), 0);
  const cashDue = Math.max(tradeOutTotal - tradeInTotal, 0);
  const cashBack = tradeInTotal > tradeOutTotal ? tradeInTotal - tradeOutTotal : 0;

  document.getElementById('content').innerHTML = `
    <h3>Trade with Customer</h3>
    <div>
      <h4>Add to Inventory (Trade-In)</h4>
      <input id="trade-in-tcg-card-name" placeholder="Card Name (e.g., Charizard)">
      <button onclick="fetchTcgCard('trade-in')">Fetch Card</button>
      <div id="tcg-modal-trade-in" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000;">
        <div style="background: white; margin: 50px auto; padding: 20px; width: 80%; max-height: 80%; overflow-y: auto;">
          <h4>Select a Card</h4>
          <div id="tcg-card-list-trade-in" style="display: flex; flex-wrap: wrap; gap: 20px;"></div>
          <button onclick="closeTcgModal('trade-in')">Close</button>
        </div>
      </div>
      <input id="trade-in-name" placeholder="Name">
      <input id="trade-in-type" placeholder="Type (e.g., pokemon_card)">
      <input id="trade-in-price" type="number" placeholder="Market Price">
      <input id="trade-in-value" type="number" placeholder="Trade Value">
      <select id="trade-in-condition-category">
        <option value="">Select Category</option>
        <option value="Raw">Raw</option>
        <option value="PSA">PSA</option>
        <option value="CGC">CGC</option>
        <option value="BGS">BGS</option>
        <option value="TAG">TAG</option>
        <option value="Other">Other</option>
      </select>
      <input id="trade-in-condition-value" type="text" placeholder="Condition/Grade (e.g., NM, 7)">
      <input id="trade-in-image" type="file" accept="image/*">
      <input id="trade-in-tcg-id" type="hidden">
      <input id="trade-in-card-set" type="hidden">
      <input id="trade-in-rarity" type="hidden">
      <input id="trade-in-image-url" type="hidden">
      <button onclick="addToTradeInCart()">Add Trade-In</button>
    </div>
    <div>
      <h4>Trade-In Cart</h4>
      <ul id="trade-in-items">
        ${tradeInCart.map(item => `
          <li>
            ${item.image_url ? `<img src="${item.image_url}" alt="${item.name}" style="max-width: 50px;">` : ''}
            ${item.name} (${item.card_set || 'Unknown Set'}) - £${item.tradeValue} (${item.condition || 'Not Set'})
          </li>
        `).join('')}
      </ul>
      <p>Total Trade-In Value: £${tradeInTotal.toFixed(2)}</p>
    </div>
    <div>
      <h4>Trade-Out Inventory</h4>
      <input id="trade-out-search" type="text" placeholder="Search inventory (e.g., Charizard, Base Set)" oninput="filterInventory('trade-out', this.value)">
      <ul id="trade-out-inventory-list">
        ${inventory.map(item => `
          <li>
            ${item.image_url ? `<img src="${item.image_url}" alt="${item.name}">` : ''}
            ${item.name} (${item.card_set || 'Unknown Set'}) - £${item.price} (${item.condition || 'Not Set'}) <button onclick="addToTradeOutCart('${item.id}', '${item.name}', ${item.price}, '${item.image_url || ''}', '${item.card_set || ''}', '${item.condition || ''}')">Add</button>
          </li>
        `).join('')}
      </ul>
      <h4>Trade-Out Cart</h4>
      <ul id="trade-out-items">
        ${tradeOutCart.map(item => `
          <li>
            ${item.image_url ? `<img src="${item.image_url}" alt="${item.name}" style="max-width: 50px;">` : ''}
            ${item.name} (${item.card_set || 'Unknown Set'}) - 
            <input type="number" value="${item.negotiatedPrice}" onchange="updateTradeOutPrice('${item.id}', this.value)" style="width: 60px;">
            (Original: £${item.price}, ${item.condition || 'Not Set'})
          </li>
        `).join('')}
      </ul>
      <p>Total Trade-Out Value: £${tradeOutTotal.toFixed(2)}</p>
      <p>Cash Due: £${cashDue.toFixed(2)}</p>
      ${cashBack > 0 ? `<p>Cash Back: £${cashBack.toFixed(2)}</p>` : ''}
      <button onclick="completeTradeTransaction()">Complete Trade</button>
    </div>
  `;
}

function filterInventory(context, searchTerm) {
  const listId = context === 'sell' ? 'sell-inventory-list' : 'trade-out-inventory-list';
  const list = document.getElementById(listId);
  const search = searchTerm.toLowerCase();
  const filtered = currentInventory.filter(item => 
    item.name.toLowerCase().includes(search) || 
    (item.card_set && item.card_set.toLowerCase().includes(search))
  );
  list.innerHTML = filtered.map(item => `
    <li>
      ${item.image_url ? `<img src="${item.image_url}" alt="${item.name}">` : ''}
      ${item.name} (${item.card_set || 'Unknown Set'}) - £${item.price} (${item.condition || 'Not Set'}) 
      <button onclick="${context === 'sell' ? `addToSellCart` : `addToTradeOutCart`}('${item.id}', '${item.name}', ${item.price}, '${item.image_url || ''}', '${item.card_set || ''}', '${item.condition || ''}')">Add</button>
    </li>
  `).join('');
}

function addToSellCart(id, name, price, imageUrl, card_set, condition) {
  console.log('Adding to sell cart:', { id, name, price, imageUrl, card_set, condition });
  sellCart.push({ id, name, price, negotiatedPrice: price, image_url: imageUrl, card_set, condition, role: 'sold' });
  showScreen('sell');
}

function updateSellPrice(id, newPrice) {
  console.log('Updating sell price:', { id, newPrice });
  sellCart = sellCart.map(item => item.id === id ? { ...item, negotiatedPrice: parseFloat(newPrice) || item.price } : item);
  showScreen('sell');
}

function completeSellTransaction() {
  console.log('Completing sell transaction:', { sellCart });
  const items = sellCart;
  const cashIn = sellCart.reduce((sum, item) => sum + (item.negotiatedPrice || item.price), 0);
  const cashOut = 0;
  ipcRenderer.send('complete-transaction', { items, type: 'sell', cashIn, cashOut });
  ipcRenderer.once('transaction-complete', () => {
    console.log('Sell transaction completed');
    sellCart = [];
    showScreen('sell');
  });
  ipcRenderer.once('transaction-error', (event, error) => console.error('Sell transaction failed:', error));
}

function addToBuy() {
  const name = document.getElementById('buy-name').value;
  const type = document.getElementById('buy-type').value;
  const price = parseFloat(document.getElementById('buy-price').value) || 0;
  const tradeValue = parseFloat(document.getElementById('buy-trade-value').value) || 0;
  const conditionCategory = document.getElementById('buy-condition-category').value || '';
  const conditionValue = document.getElementById('buy-condition-value').value || '';
  const condition = conditionCategory && conditionValue ? `${conditionCategory} - ${conditionValue}` : null;
  const image = document.getElementById('buy-image').files[0];
  const id = Date.now().toString();
  const tcg_id = document.getElementById('buy-tcg-id').value || null;
  const card_set = document.getElementById('buy-card-set').value || null;
  const rarity = document.getElementById('buy-rarity').value || null;
  const image_url = document.getElementById('buy-image-url').value || null;

  console.log('Adding to buy:', { id, name, type, price, tradeValue, condition, image: image ? image.name : null, tcg_id, card_set, rarity, image_url });
  ipcRenderer.send('add-item', {
    id,
    name,
    type,
    price,
    tradeValue,
    condition,
    imagePath: image ? image.path : null,
    imageName: image ? image.name : null,
    image_url,
    role: 'trade_in',
    tcg_id,
    card_set,
    rarity
  });
  ipcRenderer.once('add-item-success', (event, item) => {
    buyItems.push(item);
    showScreen('buy');
  });
  ipcRenderer.once('add-item-error', (event, error) => console.error('Add item failed:', error));
}

function fetchTcgCard(context) {
  const cardName = document.getElementById(`${context}-tcg-card-name`).value;
  if (!cardName) {
    console.error('No card name provided for', context);
    return;
  }
  console.log(`Fetching TCG card for ${context}:`, cardName);
  ipcRenderer.send('get-tcg-card', cardName);
  ipcRenderer.once('tcg-card-data', (event, cards) => {
    console.log(`Received TCG card data for ${context}:`, cards);
    const cardList = document.getElementById(`tcg-card-list-${context}`);
    cardList.innerHTML = '';
    cards.forEach(card => {
      const cardDiv = document.createElement('div');
      cardDiv.style = 'border: 1px solid #ccc; padding: 10px; width: 200px; text-align: center;';
      cardDiv.innerHTML = `
        <img src="${card.image_url}" alt="${card.name}" style="width: auto; height: auto; max-width: 180px; max-height: 250px;">
        <p><strong>${card.name}</strong></p>
        <p>Set: ${card.card_set}</p>
        <p>Rarity: ${card.rarity}</p>
        <p>Price: £${card.price.toFixed(2)}</p>
        <button onclick='selectTcgCard(${JSON.stringify(card)}, "${context}")'>Select</button>
      `;
      cardList.appendChild(cardDiv);
    });
    document.getElementById(`tcg-modal-${context}`).style.display = 'flex';
  });
  ipcRenderer.once('tcg-card-error', (event, error) => console.error(`TCG card fetch failed for ${context}:`, error));
}

function selectTcgCard(card, context) {
  console.log(`Selected TCG card for ${context}:`, card);
  document.getElementById(`${context}-name`).value = card.name;
  document.getElementById(`${context}-type`).value = card.type;
  document.getElementById(`${context}-price`).value = card.price;
  document.getElementById(`${context}-value`).value = Math.floor(card.price * 0.5);
  document.getElementById(`${context}-condition-category`).value = '';
  document.getElementById(`${context}-condition-value`).value = '';
  document.getElementById(`${context}-tcg-id`).value = card.tcg_id;
  document.getElementById(`${context}-card-set`).value = card.card_set;
  document.getElementById(`${context}-rarity`).value = card.rarity;
  document.getElementById(`${context}-image-url`).value = card.image_url;

  closeTcgModal(context);
}

function closeTcgModal(context) {
  document.getElementById(`tcg-modal-${context}`).style.display = 'none';
}

function completeBuyTransaction() {
  console.log('Completing buy transaction:', { buyItems });
  const items = buyItems;
  const cashIn = 0;
  const cashOut = buyItems.reduce((sum, item) => sum + item.tradeValue, 0);
  ipcRenderer.send('complete-transaction', { items, type: 'buy', cashIn, cashOut });
  ipcRenderer.once('transaction-complete', () => {
    console.log('Buy transaction completed');
    buyItems = [];
    showScreen('buy');
  });
  ipcRenderer.once('transaction-error', (event, error) => console.error('Buy transaction failed:', error));
}

function addToTradeOutCart(id, name, price, imageUrl, card_set, condition) {
  console.log('Adding to trade-out cart:', { id, name, price, imageUrl, card_set, condition });
  tradeOutCart.push({ id, name, price, negotiatedPrice: price, image_url: imageUrl, card_set, condition, role: 'trade_out' });
  showScreen('trade');
}

function updateTradeOutPrice(id, newPrice) {
  console.log('Updating trade-out price:', { id, newPrice });
  tradeOutCart = tradeOutCart.map(item => item.id === id ? { ...item, negotiatedPrice: parseFloat(newPrice) || item.price } : item);
  showScreen('trade');
}

function addToTradeInCart() {
  const name = document.getElementById('trade-in-name').value;
  const type = document.getElementById('trade-in-type').value;
  const price = parseFloat(document.getElementById('trade-in-price').value) || 0;
  const tradeValue = parseFloat(document.getElementById('trade-in-value').value) || 0;
  const conditionCategory = document.getElementById('trade-in-condition-category').value || '';
  const conditionValue = document.getElementById('trade-in-condition-value').value || '';
  const condition = conditionCategory && conditionValue ? `${conditionCategory} - ${conditionValue}` : null;
  const image = document.getElementById('trade-in-image').files[0];
  const id = Date.now().toString();
  const tcg_id = document.getElementById('trade-in-tcg-id').value || null;
  const card_set = document.getElementById('trade-in-card-set').value || null;
  const rarity = document.getElementById('trade-in-rarity').value || null;
  const image_url = document.getElementById('trade-in-image-url').value || null;

  console.log('Adding to trade-in cart:', { id, name, type, price, tradeValue, condition, image: image ? image.name : null, tcg_id, card_set, rarity, image_url });
  ipcRenderer.send('add-item', {
    id,
    name,
    type,
    price,
    tradeValue,
    condition,
    imagePath: image ? image.path : null,
    imageName: image ? image.name : null,
    image_url,
    role: 'trade_in',
    tcg_id,
    card_set,
    rarity
  });
  ipcRenderer.once('add-item-success', (event, item) => {
    tradeInCart.push(item);
    showScreen('trade');
  });
  ipcRenderer.once('add-item-error', (event, error) => console.error('Add trade-in failed:', error));
}

function completeTradeTransaction() {
  console.log('Completing trade transaction:', { tradeInCart, tradeOutCart });
  const items = [...tradeInCart, ...tradeOutCart];
  const cashIn = tradeOutCart.reduce((sum, item) => sum + (item.negotiatedPrice || item.price), 0);
  const cashOut = tradeInCart.reduce((sum, item) => sum + item.tradeValue, 0);
  ipcRenderer.send('complete-transaction', { items, type: 'trade', cashIn, cashOut });
  ipcRenderer.once('transaction-complete', () => {
    console.log('Trade transaction completed');
    tradeInCart = [];
    tradeOutCart = [];
    showScreen('trade');
  });
  ipcRenderer.once('transaction-error', (event, error) => console.error('Trade transaction failed:', error));
}

// Initial load
showScreen('sell');