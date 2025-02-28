const { ipcRenderer } = require('electron');
const cart = require('./cart'); // Import cart state
const sell = require('./screens/sell');
const buy = require('./screens/buy');
const trade = require('./screens/trade');
const transactions = require('./screens/transactions');
const inventory = require('./screens/inventory');
const reports = require('./screens/reports');

// Pagination state
let sellPage = 1;
let tradeOutPage = 1;
const itemsPerPage = 50;

// Search terms
let sellSearchTerm = '';
let tradeOutSearchTerm = '';

// Render the main UI screen based on the selected tab
function showScreen(screen) {
  console.log('Showing screen:', screen, {
    sellCart: cart.sellCart,
    buyItems: cart.buyItems,
    tradeInCart: cart.tradeInCart,
    tradeOutCart: cart.tradeOutCart
  });
  
  if (screen === 'sell') {
    sell.render(sellPage, sellSearchTerm, cart.sellCart);
  } else if (screen === 'buy') {
    buy.render(cart.buyItems);
  } else if (screen === 'trade') {
    trade.render(tradeOutPage, tradeOutSearchTerm, cart.tradeInCart, cart.tradeOutCart);
  } else if (screen === 'transactions') {
    transactions.render();
  } else if (screen === 'inventory') {
    inventory.render();
  } else if (screen === 'reports') {
    reports.render();
  }
}

// Export showScreen for use in tab modules
module.exports = { showScreen };

// Initial render of the Sell tab after module load
showScreen('sell');