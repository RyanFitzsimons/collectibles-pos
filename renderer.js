// Imports required modules for Electron communication, cart state, and screen rendering
const { ipcRenderer } = require('electron');  // Electron IPC for potential main process communication (unused here)
const cart = require('./cart');  // Imports centralized cart state (sellCart, buyItems, tradeInCart, tradeOutCart)
const sell = require('./screens/sell');  // Imports sell tab rendering module
const buy = require('./screens/buy');  // Imports buy tab rendering module
const trade = require('./screens/trade');  // Imports trade tab rendering module
const transactions = require('./screens/transactions');  // Imports transactions tab rendering module
const inventory = require('./screens/inventory');  // Imports inventory tab rendering module
const reports = require('./screens/reports');  // Imports reports tab rendering module

// Pagination state for tabs with paginated views
let sellPage = 1;  // Tracks the current page for the Sell tab inventory
let tradeOutPage = 1;  // Tracks the current page for the Trade tab trade-out inventory
const itemsPerPage = 50;  // Number of items per page for paginated views (Sell and Trade tabs)

// Search terms for tabs with search functionality
let sellSearchTerm = '';  // Holds the current search filter for the Sell tab inventory
let tradeOutSearchTerm = '';  // Holds the current search filter for the Trade tab trade-out inventory

// Renders the main UI screen based on the selected tab
function showScreen(screen) {
  console.log('Showing screen:', screen, {  // Logs the screen being rendered along with cart states for debugging
    sellCart: cart.sellCart,  // Current state of sell cart
    buyItems: cart.buyItems,  // Current state of buy items
    tradeInCart: cart.tradeInCart,  // Current state of trade-in cart
    tradeOutCart: cart.tradeOutCart  // Current state of trade-out cart
  });
  
  // Renders the appropriate tab based on the screen parameter
  if (screen === 'sell') {
    sell.render(sellPage, sellSearchTerm, cart.sellCart);  // Renders Sell tab with current page, search term, and sell cart
  } else if (screen === 'buy') {
    buy.render(cart.buyItems);  // Renders Buy tab with buy items cart
  } else if (screen === 'trade') {
    trade.render(tradeOutPage, tradeOutSearchTerm, cart.tradeInCart, cart.tradeOutCart);  // Renders Trade tab with page, search term, and both carts
  } else if (screen === 'transactions') {
    transactions.render();  // Renders Transactions tab (no additional params needed)
  } else if (screen === 'inventory') {
    inventory.render();  // Renders Inventory tab (no additional params needed)
  } else if (screen === 'reports') {
    reports.render();  // Renders Reports tab (no additional params needed)
  }
}

// Exports the showScreen function for use in tab modules
module.exports = { showScreen };  // Makes showScreen available to other files for tab switching

// Initial render of the Sell tab after module load
showScreen('sell');  // Automatically renders the Sell tab when renderer.js is loaded