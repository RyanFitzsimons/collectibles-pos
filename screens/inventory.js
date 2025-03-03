// Imports required modules for Electron communication and utilities
const { ipcRenderer } = require('electron');  // Electron IPC for communicating with main process
const { cleanPrice, debounce } = require('../utils');  // Utility functions: cleanPrice formats prices, debounce delays event handling

// Renders the Inventory tab UI with editable items and attributes
function render() {
  const content = document.getElementById('content');  // Gets the main content container from the DOM
  // Fetch all inventory data from the main process (no pagination limit here)
  ipcRenderer.send('get-all-inventory');  // Requests all inventory items from main process
  ipcRenderer.once('all-inventory-data', (event, { items, total }) => {
    let allItems = items;  // Stores all inventory items received
    let sortedItems = allItems.sort((a, b) => a.name.localeCompare(b.name));  // Initial sort by name ascending
    let currentSortKey = 'name';  // Tracks current sorting column
    let isAsc = true;  // Tracks sort direction (true for ascending)
    let searchTerm = '';  // Holds current search filter
    let currentPage = 1;  // Tracks current page for pagination
    const itemsPerPage = 10;  // Number of items displayed per page

    // Renders the inventory table with pagination and filters applied
    function renderInventory(filteredItems) {
      const totalPages = Math.ceil(filteredItems.length / itemsPerPage);  // Calculates total pages based on filtered items
      const startIndex = (currentPage - 1) * itemsPerPage;  // Start index for current page
      const paginatedItems = filteredItems.slice(startIndex, startIndex + itemsPerPage);  // Slices items for current page

      content.innerHTML = `
        <div class="section">
          <h3>Inventory</h3>
          <div class="input-group">
            <label>Filter Inventory</label>
            <input id="inventory-search" type="text" placeholder="Search by Name, Type, Condition, or Attributes" value="${searchTerm}">
          </div>
          <table class="inventory-table">
            <thead>
              <tr>
                <th data-sort="id">ID</th>
                <th data-sort="type">Type</th>
                <th data-sort="name">Name</th>
                <th data-sort="price">Price</th>
                <th>Trade Value</th>
                <th data-sort="stock">Stock</th>
                <th data-sort="condition">Condition</th>
                <th>Attributes</th>
                <th>Image</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="inventory-items">
              ${paginatedItems.map(item => `
                <tr id="row-${item.id}">
                  <td>${item.id}</td>
                  <td><input id="type-${item.id}" value="${item.type}" disabled></td>
                  <td><input id="name-${item.id}" value="${item.name}" disabled></td>
                  <td><input id="price-${item.id}" type="number" value="${item.price}" disabled></td>
                  <td>${cleanPrice(item.trade_value || Math.floor(item.price * 0.5))}</td>
                  <td>${item.stock}</td>
                  <td><input id="condition-${item.id}" value="${item.condition || ''}" disabled></td>
                  <td id="attributes-${item.id}">${renderAttributes(item.id, item.type, item.attributes)}</td>
                  <td>${item.image_url ? `<img src="${item.image_url}" alt="${item.name}" style="max-width: 50px;">` : 'No Image'}</td>
                  <td>
                    <button class="edit-item" data-id="${item.id}">Edit</button>
                    <button class="save-item" data-id="${item.id}" style="display: none;">Save</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <div class="pagination">
            <button id="prev-page" ${currentPage === 1 ? 'disabled' : ''}>Previous</button>
            <span>Page ${currentPage} of ${totalPages}</span>
            <button id="next-page" ${currentPage >= totalPages ? 'disabled' : ''}>Next</button>
          </div>
        </div>
      `;  // Sets the HTML content for the Inventory tab

      // Adds sorting functionality to table headers
      const table = document.querySelector('.inventory-table');
      table.querySelectorAll('th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
          const key = th.dataset.sort;  // Gets column key to sort by
          if (key === currentSortKey) isAsc = !isAsc;  // Toggles direction if same key
          else {
            currentSortKey = key;  // Sets new sort key
            isAsc = true;  // Defaults to ascending
          }
          sortedItems.sort((a, b) => {
            const aVal = a[key] || '';  // Gets value for sorting, defaults to empty string
            const bVal = b[key] || '';
            return isAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);  // Sorts alphabetically
          });
          th.classList.toggle('asc', isAsc);  // Updates sort direction indicator
          renderInventory(sortedItems);  // Re-renders with sorted items
        });
      });

      // Adds search filter with debounce to reduce re-renders
      document.getElementById('inventory-search').addEventListener('input', debounce((e) => {
        searchTerm = e.target.value.toLowerCase();  // Updates search term
        applyFilters();  // Applies filters and re-renders
      }, 600));  // 600ms delay for debounce

      // Pagination: Previous page button
      document.getElementById('prev-page').addEventListener('click', () => {
        if (currentPage > 1) {
          currentPage--;  // Decrements page number
          renderInventory(sortedItems);  // Re-renders with previous page
        }
      });

      // Pagination: Next page button
      document.getElementById('next-page').addEventListener('click', () => {
        if (currentPage < totalPages) {
          currentPage++;  // Increments page number
          renderInventory(sortedItems);  // Re-renders with next page
        }
      });

      // Adds edit button functionality to enable field editing
      document.querySelectorAll('.edit-item').forEach(button => {
        button.addEventListener('click', () => {
          const id = button.dataset.id;  // Gets item ID from button data
          console.log('Edit clicked for ID:', id);  // Logs edit action
          button.style.display = 'none';  // Hides Edit button
          const saveButton = document.querySelector(`.save-item[data-id="${id}"]`);
          if (saveButton) saveButton.style.display = 'inline';  // Shows Save button
          ['type', 'name', 'price', 'condition'].forEach(field => {
            const input = document.getElementById(`${field}-${id}`);  // Gets input field
            if (input) input.disabled = false;  // Enables editing
          });
          toggleAttributeFields(id, true);  // Switches attributes to edit mode
        });
      });

      // Adds save button functionality to update item data
      document.querySelectorAll('.save-item').forEach(button => {
        button.addEventListener('click', () => {
          const id = button.dataset.id;  // Gets item ID from button data
          console.log('Save clicked for ID:', id);  // Logs save action
          const updatedItem = {
            id,  // Item ID
            type: document.getElementById(`type-${id}`).value,  // Updated type
            name: document.getElementById(`name-${id}`).value,  // Updated name
            price: parseFloat(document.getElementById(`price-${id}`).value) || 0,  // Updated price, defaults to 0
            condition: document.getElementById(`condition-${id}`).value  // Updated condition
          };
          const attributes = getUpdatedAttributes(id, updatedItem.type);  // Gets updated attributes
          ipcRenderer.send('update-inventory-item', updatedItem);  // Sends updated item to main process
          ipcRenderer.send('update-item-attributes', { item_id: id, attributes });  // Sends updated attributes
          ipcRenderer.once('update-inventory-success', () => {
            ipcRenderer.once('update-attributes-success', () => {
              button.style.display = 'none';  // Hides Save button
              const editButton = document.querySelector(`.edit-item[data-id="${id}"]`);
              if (editButton) editButton.style.display = 'inline';  // Shows Edit button
              ['type', 'name', 'price', 'condition'].forEach(field => {
                const input = document.getElementById(`${field}-${id}`);
                if (input) input.disabled = true;  // Disables editing
              });
              toggleAttributeFields(id, false);  // Switches attributes back to display mode
              allItems = allItems.map(i => i.id === id ? { ...i, ...updatedItem, attributes } : i);  // Updates local items array
              renderInventory(allItems);  // Re-renders with updated data
            });
          });
          ipcRenderer.once('update-inventory-error', (event, error) => console.error('Update failed:', error));  // Logs inventory update errors
          ipcRenderer.once('update-attributes-error', (event, error) => console.error('Attributes update failed:', error));  // Logs attribute update errors
        });
      });
    }

    // Applies search filters to inventory items
    function applyFilters() {
      let filtered = allItems;
      if (searchTerm) {
        filtered = filtered.filter(item => 
          item.name.toLowerCase().includes(searchTerm) ||  // Filters by name
          item.type.toLowerCase().includes(searchTerm) ||  // Filters by type
          (item.condition || '').toLowerCase().includes(searchTerm) ||  // Filters by condition
          Object.values(item.attributes || {}).some(value => value.toLowerCase().includes(searchTerm))  // Filters by attributes
        );  // Filters items based on search term across multiple fields
      }
      sortedItems = filtered.sort((a, b) => {
        const aVal = a[currentSortKey] || '';  // Gets sort value, defaults to empty string
        const bVal = b[currentSortKey] || '';
        return isAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);  // Sorts based on current key and direction
      });
      currentPage = 1;  // Resets to first page after filtering
      renderInventory(sortedItems);  // Re-renders with filtered items
    }

    // Formats attributes for display as a string
    function formatAttributes(attributes) {
      if (!attributes || Object.keys(attributes).length === 0) return '';  // Returns empty string if no attributes
      return Object.entries(attributes).map(([key, value]) => `${key}: ${value}`).join(', ');  // Joins attributes as "key: value"
    }

    // Renders attributes as display spans and editable inputs
    function renderAttributes(id, type, attributes) {
      if (!attributes) attributes = {};  // Ensures attributes is an object
      let html = '';
      // Renders TCG-specific attributes
      if (type === 'pokemon_tcg' || type === 'other_tcg') {
        html = `
          <span id="display-tcg_id-${id}">${attributes.tcg_id || ''}</span>
          <input id="edit-tcg_id-${id}" value="${attributes.tcg_id || ''}" style="display: none;">
          <br><span id="display-card_set-${id}">${attributes.card_set || ''}</span>
          <input id="edit-card_set-${id}" value="${attributes.card_set || ''}" style="display: none;">
          <br><span id="display-rarity-${id}">${attributes.rarity || ''}</span>
          <input id="edit-rarity-${id}" value="${attributes.rarity || ''}" style="display: none;">
        `;
      } 
      // Renders video game-specific attributes
      else if (type === 'video_game') {
        html = `
          <span id="display-platform-${id}">${attributes.platform || ''}</span>
          <input id="edit-platform-${id}" value="${attributes.platform || ''}" style="display: none;">
        `;
      } 
      // Renders console-specific attributes
      else if (type === 'console') {
        html = `
          <span id="display-brand-${id}">${attributes.brand || ''}</span>
          <input id="edit-brand-${id}" value="${attributes.brand || ''}" style="display: none;">
          <br><span id="display-model-${id}">${attributes.model || ''}</span>
          <input id="edit-model-${id}" value="${attributes.model || ''}" style="display: none;">
        `;
      } 
      // Renders football shirt-specific attributes
      else if (type === 'football_shirt') {
        html = `
          <span id="display-team-${id}">${attributes.team || ''}</span>
          <input id="edit-team-${id}" value="${attributes.team || ''}" style="display: none;">
          <br><span id="display-year-${id}">${attributes.year || ''}</span>
          <input id="edit-year-${id}" value="${attributes.year || ''}" style="display: none;">
        `;
      } 
      // Renders coin-specific attributes
      else if (type === 'coin') {
        html = `
          <span id="display-denomination-${id}">${attributes.denomination || ''}</span>
          <input id="edit-denomination-${id}" value="${attributes.denomination || ''}" style="display: none;">
          <br><span id="display-year_minted-${id}">${attributes.year_minted || ''}</span>
          <input id="edit-year_minted-${id}" value="${attributes.year_minted || ''}" style="display: none;">
        `;
      }
      return html;  // Returns HTML for display and edit fields
    }

    // Toggles attribute fields between display and edit modes
    function toggleAttributeFields(id, enable) {
      const type = document.getElementById(`type-${id}`).value;  // Gets item type
      const fields = type === 'pokemon_tcg' || type === 'other_tcg' ? ['tcg_id', 'card_set', 'rarity'] :  // TCG fields
                     type === 'video_game' ? ['platform'] :  // Video game field
                     type === 'console' ? ['brand', 'model'] :  // Console fields
                     type === 'football_shirt' ? ['team', 'year'] :  // Football shirt fields
                     type === 'coin' ? ['denomination', 'year_minted'] : [];  // Coin fields
      fields.forEach(field => {
        const display = document.getElementById(`display-${field}-${id}`);  // Display span
        const input = document.getElementById(`edit-${field}-${id}`);  // Edit input
        if (display && input) {
          display.style.display = enable ? 'none' : 'inline';  // Hides display if editing
          input.style.display = enable ? 'inline' : 'none';  // Shows input if editing
        }
      });
    }

    // Gets updated attributes from edit fields
    function getUpdatedAttributes(id, type) {
      const attributes = {};
      // Updates TCG-specific attributes
      if (type === 'pokemon_tcg' || type === 'other_tcg') {
        ['tcg_id', 'card_set', 'rarity'].forEach(field => {
          const input = document.getElementById(`edit-${field}-${id}`);
          if (input && input.value) attributes[field] = input.value;  // Adds field if value exists
        });
      } 
      // Updates video game-specific attributes
      else if (type === 'video_game') {
        const input = document.getElementById(`edit-platform-${id}`);
        if (input && input.value) attributes.platform = input.value;
      } 
      // Updates console-specific attributes
      else if (type === 'console') {
        ['brand', 'model'].forEach(field => {
          const input = document.getElementById(`edit-${field}-${id}`);
          if (input && input.value) attributes[field] = input.value;
        });
      } 
      // Updates football shirt-specific attributes
      else if (type === 'football_shirt') {
        ['team', 'year'].forEach(field => {
          const input = document.getElementById(`edit-${field}-${id}`);
          if (input && input.value) attributes[field] = input.value;
        });
      } 
      // Updates coin-specific attributes
      else if (type === 'coin') {
        ['denomination', 'year_minted'].forEach(field => {
          const input = document.getElementById(`edit-${field}-${id}`);
          if (input && input.value) attributes[field] = input.value;
        });
      }
      return attributes;  // Returns updated attributes object
    }

    renderInventory(allItems);  // Initial render with all items
  });
}

// Exports the render function for use in main process navigation
module.exports = { render };