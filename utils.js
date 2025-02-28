// Format a number as a currency string with £ symbol
function cleanPrice(price) {
    console.log('Cleaning price:', price, '->', Number(price).toFixed(2));
    return `\u00A3${Number(price).toFixed(2)}`; // Use Unicode £
  }
  
  // Debounce a function to limit how often it runs (e.g., for search inputs)
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }
  
  module.exports = { cleanPrice, debounce };