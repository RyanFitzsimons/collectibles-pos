// Formats a number as a currency string with £ symbol
function cleanPrice(price) {
  console.log('Cleaning price:', price, '->', Number(price).toFixed(2));  // Logs the input price and its formatted output for debugging
  return `\u00A3${Number(price).toFixed(2)}`;  // Converts price to a number, fixes to 2 decimal places, and prepends Unicode £ symbol
}

// Debounces a function to limit how often it runs (e.g., for search inputs)
function debounce(func, wait) {
  let timeout;  // Variable to store the timeout ID
  return function executedFunction(...args) {  // Returns a debounced version of the input function
    const later = () => {  // Defines the delayed execution function
      clearTimeout(timeout);  // Clears any existing timeout
      func(...args);  // Executes the original function with provided arguments
    };
    clearTimeout(timeout);  // Clears any previous timeout to reset the wait period
    timeout = setTimeout(later, wait);  // Sets a new timeout to run the function after the wait period
  };
}

// Exports utility functions for use in other modules
module.exports = { cleanPrice, debounce };  // Makes cleanPrice and debounce available to other files