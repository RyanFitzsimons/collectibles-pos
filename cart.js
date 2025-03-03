// Centralized cart state for all tabs

// Array to store items in the sell cart for the Sell tab
let sellCart = [];  // Holds items being sold to customers, managed by sell.js

// Array to store items in the buy cart for the Buy tab
let buyItems = [];  // Holds items being bought from customers, managed by buy.js

// Array to store trade-in items for the Trade tab
let tradeInCart = [];  // Holds items customers are trading in, managed by trade.js

// Array to store trade-out items for the Trade tab
let tradeOutCart = [];  // Holds items being traded out to customers, managed by trade.js

// Exports all cart arrays as a module for use across the application
module.exports = { sellCart, buyItems, tradeInCart, tradeOutCart };  // Makes carts accessible to other files