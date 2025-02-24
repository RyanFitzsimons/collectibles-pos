const { ipcRenderer } = require('electron');

let sellCart = [];
let tradeInCart = [];
let tradeOutCart = [];
let buyItems = [];

function showScreen(screen) {
  console.log('Showing screen:', screen, { sellCart, tradeInCart, tradeOutCart, buyItems });
  const content = document.getElementById('content');
  
  if (screen === 'sell') {
    ipcRenderer.send('get-inventory');
    ipcRenderer.once('inventory-data', (event, inventory) => {
      ipcRenderer.send('get-bundles');
      ipcRenderer.once('bundles-data', (event, bundleData) => {
        const bundles = bundleData || [];
        renderSellTab(inventory, bundles);
      });
      renderSellTab(inventory, []);
    });
  } else if (screen === 'buy') {
    const totalPayout = buyItems.reduce((sum, item) => sum + item.tradeValue, 0);
    content.innerHTML = `
      <h3>Buy from Customer</h3>
      <input id="buy-name" placeholder="Name">
      <input id="buy-type" placeholder="Type (e.g., pokemon_card)">
      <input id="buy-price" type="number" placeholder="Market Price">
      <input id="buy-trade-value" type="number" placeholder="Trade Value">
      <input id="buy-image" type="file" accept="image/*">
      <button onclick="addToBuy()">Add Item</button>
      <ul id="buy-items">
        ${buyItems.map(item => `
          <li>
            ${item.image_url ? `<img src="${item.image_url}" alt="${item.name}">` : ''}
            ${item.name} - £${item.tradeValue}
          </li>
        `).join('')}
      </ul>
      <p>Total Payout: £${totalPayout.toFixed(2)}</p>
      <button onclick="completeBuyTransaction()">Complete Buy</button>
    `;
  } else if (screen === 'trade') {
    ipcRenderer.send('get-inventory');
    ipcRenderer.once('inventory-data', (event, inventory) => {
      const tradeInTotal = tradeInCart.reduce((sum, item) => sum + item.tradeValue, 0);
      const tradeOutTotal = tradeOutCart.reduce((sum, item) => sum + (item.negotiatedPrice || item.price), 0);
      const cashDue = Math.max(tradeOutTotal - tradeInTotal, 0);
      const cashBack = tradeInTotal > tradeOutTotal ? tradeInTotal - tradeOutTotal : 0;

      content.innerHTML = `
        <h3>Trade with Customer</h3>
        <div>
          <h4>Add to Inventory (Trade-In)</h4>
          <input id="trade-in-name" placeholder="Name">
          <input id="trade-in-type" placeholder="Type (e.g., pokemon_card)">
          <input id="trade-in-price" type="number" placeholder="Market Price">
          <input id="trade-in-value" type="number" placeholder="Trade Value">
          <input id="trade-in-image" type="file" accept="image/*">
          <button onclick="addToTradeInCart()">Add Trade-In</button>
        </div>
        <div>
          <h4>Trade-In Cart</h4>
          <ul id="trade-in-items">
            ${tradeInCart.map(item => `
              <li>
                ${item.image_url ? `<img src="${item.image_url}" alt="${item.name}">` : ''}
                ${item.name} - £${item.tradeValue}
              </li>
            `).join('')}
          </ul>
          <p>Total Trade-In Value: £${tradeInTotal.toFixed(2)}</p>
        </div>
        <div>
          <h4>Trade-Out Inventory</h4>
          <ul>
            ${inventory.map(item => `
              <li>
                ${item.image_url ? `<img src="${item.image_url}" alt="${item.name}">` : ''}
                ${item.name} (£${item.price}) <button onclick="addToTradeOutCart('${item.id}', '${item.name}', ${item.price}, '${item.image_url || ''}')">Add</button>
              </li>
            `).join('')}
          </ul>
          <h4>Trade-Out Cart</h4>
          <ul id="trade-out-items">
            ${tradeOutCart.map(item => `
              <li>
                ${item.image_url ? `<img src="${item.image_url}" alt="${item.name}">` : ''}
                ${item.name} - 
                <input type="number" value="${item.negotiatedPrice}" onchange="updateTradeOutPrice('${item.id}', this.value)" style="width: 60px;">
                (Original: £${item.price})
              </li>
            `).join('')}
          </ul>
          <p>Total Trade-Out Value: £${tradeOutTotal.toFixed(2)}</p>
          <p>Cash Due: £${cashDue.toFixed(2)}</p>
          ${cashBack > 0 ? `<p>Cash Back: £${cashBack.toFixed(2)}</p>` : ''}
          <button onclick="completeTradeTransaction()">Complete Trade</button>
        </div>
      `;
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
            image_url: row.image_url
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
                    ${item.name} (${item.role === 'trade_in' ? 'Trade-In' : item.role === 'trade_out' ? 'Trade-Out' : 'Sold'}) - 
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

function renderSellTab(inventory, bundles) {
  const totalListed = sellCart.reduce((sum, item) => sum + item.price, 0);
  const totalNegotiated = sellCart.reduce((sum, item) => sum + (item.negotiatedPrice || item.price), 0);
  document.getElementById('content').innerHTML = `
    <h3>Sell to Customer</h3>
    <div>
      <h4>Create Bundle</h4>
      <input id="bundle-name" placeholder="Bundle Name">
      <select id="bundle-items" multiple style="width: 200px; height: 100px;">
        ${inventory.map(item => `
          <option value="${item.id}">${item.name} (£${item.price})</option>
        `).join('')}
      </select>
      <input id="bundle-price" type="number" placeholder="Bundle Price">
      <button id="create-bundle-btn">Create Bundle</button>
    </div>
    <div>
      <h4>Inventory</h4>
      <ul>
        ${inventory.map(item => `
          <li>
            ${item.image_url ? `<img src="${item.image_url}" alt="${item.name}">` : ''}
            ${item.name} (£${item.price}) <button onclick="addToSellCart('${item.id}', '${item.name}', ${item.price}, '${item.image_url || ''}')">Add</button>
          </li>
        `).join('')}
      </ul>
      <h4>Bundles</h4>
      <ul id="bundles-list">
        ${bundles.map((bundle, index) => `
          <li>
            ${bundle.name} (£${bundle.bundle_price}) 
            <button class="add-bundle-btn" data-id="${bundle.id}" data-name="${bundle.name}" data-price="${bundle.bundle_price}" data-itemids='${bundle.item_ids}'>Add Bundle</button>
          </li>
        `).join('')}
      </ul>
    </div>
    <div>
      <h4>Sell Cart</h4>
      <ul id="sell-cart-items">
        ${sellCart.map(item => `
          <li>
            ${item.image_url ? `<img src="${item.image_url}" alt="${item.name}">` : ''}
            ${item.name} - 
            <input type="number" value="${item.negotiatedPrice}" onchange="updateSellPrice('${item.id}', this.value)" style="width: 60px;">
            (Original: £${item.price})
          </li>
        `).join('')}
      </ul>
      <p>Total Listed: £${totalListed.toFixed(2)}</p>
      <p>Total Negotiated: £${totalNegotiated.toFixed(2)}</p>
      <button onclick="completeSellTransaction()">Complete Sell</button>
    </div>
  `;

  // Add event listeners for bundle buttons
  document.querySelectorAll('.add-bundle-btn').forEach(button => {
    button.addEventListener('click', () => {
      const id = button.getAttribute('data-id');
      const name = button.getAttribute('data-name');
      const bundlePrice = parseFloat(button.getAttribute('data-price'));
      const itemIds = button.getAttribute('data-itemids');
      addBundleToSellCart(id, name, bundlePrice, itemIds);
    });
  });
}

function addToSellCart(id, name, price, imageUrl) {
  console.log('Adding to sell cart:', { id, name, price, imageUrl });
  sellCart.push({ id, name, price, negotiatedPrice: price, image_url: imageUrl, role: 'sold' });
  showScreen('sell');
}

function updateSellPrice(id, newPrice) {
  console.log('Updating sell price:', { id, newPrice });
  sellCart = sellCart.map(item => item.id === id ? { ...item, negotiatedPrice: parseFloat(newPrice) || item.price } : item);
  showScreen('sell');
}

function addBundleToSellCart(id, name, bundlePrice, itemIds) {
  console.log('Adding bundle to sell cart:', { id, name, bundlePrice, itemIds });
  let parsedIds;
  try {
    parsedIds = JSON.parse(itemIds);
  } catch (e) {
    console.error('Failed to parse item_ids:', e, itemIds);
    return;
  }
  ipcRenderer.send('get-inventory');
  ipcRenderer.once('inventory-data', (event, inventory) => {
    console.log('Inventory for bundle:', inventory);
    const bundleItems = parsedIds.map(itemId => {
      const item = inventory.find(i => i.id === itemId);
      if (!item) console.warn(`Item ${itemId} not found in inventory`);
      return item;
    }).filter(item => item);
    if (bundleItems.length === 0) {
      console.error('No valid items found for bundle:', id);
      return;
    }
    const totalOriginal = bundleItems.reduce((sum, item) => sum + item.price, 0);
    bundleItems.forEach(item => {
      const ratio = totalOriginal ? item.price / totalOriginal : 0;
      sellCart.push({
        id: item.id,
        name: `${name} - ${item.name}`,
        price: item.price,
        negotiatedPrice: bundlePrice * ratio,
        image_url: item.image_url,
        role: 'sold'
      });
    });
    console.log('Updated sellCart:', sellCart);
    showScreen('sell');
  });
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
  const image = document.getElementById('buy-image').files[0];
  const id = Date.now().toString();

  console.log('Adding to buy:', { id, name, type, price, tradeValue, image: image ? image.name : null });
  ipcRenderer.send('add-item', { id, name, type, price, tradeValue, imagePath: image ? image.path : null, imageName: image ? image.name : null, role: 'trade_in' });
  ipcRenderer.once('add-item-success', (event, item) => {
    buyItems.push(item);
    showScreen('buy');
  });
  ipcRenderer.once('add-item-error', (event, error) => console.error('Add item failed:', error));
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

function addToTradeOutCart(id, name, price, imageUrl) {
  console.log('Adding to trade-out cart:', { id, name, price, imageUrl });
  tradeOutCart.push({ id, name, price, negotiatedPrice: price, image_url: imageUrl, role: 'trade_out' });
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
  const image = document.getElementById('trade-in-image').files[0];
  const id = Date.now().toString();

  console.log('Adding to trade-in cart:', { id, name, type, price, tradeValue, image: image ? image.name : null });
  ipcRenderer.send('add-item', { id, name, type, price, tradeValue, imagePath: image ? image.path : null, imageName: image ? image.name : null, role: 'trade_in' });
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

function addBundle() {
  const name = document.getElementById('bundle-name').value;
  const bundlePrice = parseFloat(document.getElementById('bundle-price').value) || 0;
  const itemSelect = document.getElementById('bundle-items');
  const itemIds = Array.from(itemSelect.selectedOptions).map(option => option.value);
  
  if (!name || itemIds.length === 0 || bundlePrice <= 0) {
    console.error('Invalid bundle input:', { name, itemIds, bundlePrice });
    return;
  }
  
  console.log('Adding bundle:', { name, itemIds, bundlePrice });
  ipcRenderer.send('add-bundle', { name, itemIds, bundlePrice });
  ipcRenderer.once('add-bundle-success', (event, bundle) => {
    console.log('Bundle added successfully:', bundle);
    // Refresh bundles explicitly
    ipcRenderer.send('get-inventory');
    ipcRenderer.once('inventory-data', (event, inventory) => {
      ipcRenderer.send('get-bundles');
      ipcRenderer.once('bundles-data', (event, bundleData) => {
        const bundles = bundleData || [];
        renderSellTab(inventory, bundles);
      });
    });
  });
  ipcRenderer.once('add-bundle-error', (event, error) => console.error('Add bundle failed:', error));
}

// Initial load
showScreen('sell');