// Imports
const { ipcRenderer } = require('electron');
const { cleanPrice, debounce } = require('../utils');

// Render the Inventory tab UI with editable items and attributes
function render() {
  const content = document.getElementById('content');
  ipcRenderer.send('get-all-inventory');
  ipcRenderer.once('all-inventory-data', (event, { items, total }) => {
    let allItems = items;
    let sortedItems = allItems.sort((a, b) => a.name.localeCompare(b.name));
    let currentSortKey = 'name';
    let isAsc = true;
    let searchTerm = '';
    let currentPage = 1;
    const itemsPerPage = 10;

    function renderInventory(filteredItems) {
      const totalPages = Math.ceil(filteredItems.length / itemsPerPage);
      const startIndex = (currentPage - 1) * itemsPerPage;
      const paginatedItems = filteredItems.slice(startIndex, startIndex + itemsPerPage);

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
      `;

      const table = document.querySelector('.inventory-table');
      table.querySelectorAll('th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
          const key = th.dataset.sort;
          if (key === currentSortKey) isAsc = !isAsc;
          else {
            currentSortKey = key;
            isAsc = true;
          }
          sortedItems.sort((a, b) => {
            const aVal = a[key] || '';
            const bVal = b[key] || '';
            return isAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
          });
          th.classList.toggle('asc', isAsc);
          renderInventory(sortedItems);
        });
      });

      document.getElementById('inventory-search').addEventListener('input', debounce((e) => {
        searchTerm = e.target.value.toLowerCase();
        applyFilters();
      }, 600));

      document.getElementById('prev-page').addEventListener('click', () => {
        if (currentPage > 1) {
          currentPage--;
          renderInventory(sortedItems);
        }
      });
      document.getElementById('next-page').addEventListener('click', () => {
        if (currentPage < totalPages) {
          currentPage++;
          renderInventory(sortedItems);
        }
      });

      document.querySelectorAll('.edit-item').forEach(button => {
        button.addEventListener('click', () => {
          const id = button.dataset.id;
          console.log('Edit clicked for ID:', id);
          button.style.display = 'none';
          const saveButton = document.querySelector(`.save-item[data-id="${id}"]`);
          if (saveButton) saveButton.style.display = 'inline';
          ['type', 'name', 'price', 'condition'].forEach(field => {
            const input = document.getElementById(`${field}-${id}`);
            if (input) input.disabled = false;
          });
          toggleAttributeFields(id, true);
        });
      });

      document.querySelectorAll('.save-item').forEach(button => {
        button.addEventListener('click', () => {
          const id = button.dataset.id;
          console.log('Save clicked for ID:', id);
          const updatedItem = {
            id,
            type: document.getElementById(`type-${id}`).value,
            name: document.getElementById(`name-${id}`).value,
            price: parseFloat(document.getElementById(`price-${id}`).value) || 0,
            condition: document.getElementById(`condition-${id}`).value
          };
          const attributes = getUpdatedAttributes(id, updatedItem.type);
          ipcRenderer.send('update-inventory-item', updatedItem);
          ipcRenderer.send('update-item-attributes', { item_id: id, attributes });
          ipcRenderer.once('update-inventory-success', () => {
            ipcRenderer.once('update-attributes-success', () => {
              button.style.display = 'none';
              const editButton = document.querySelector(`.edit-item[data-id="${id}"]`);
              if (editButton) editButton.style.display = 'inline';
              ['type', 'name', 'price', 'condition'].forEach(field => {
                const input = document.getElementById(`${field}-${id}`);
                if (input) input.disabled = true;
              });
              toggleAttributeFields(id, false);
              allItems = allItems.map(i => i.id === id ? { ...i, ...updatedItem, attributes } : i);
              renderInventory(allItems);
            });
          });
          ipcRenderer.once('update-inventory-error', (event, error) => console.error('Update failed:', error));
          ipcRenderer.once('update-attributes-error', (event, error) => console.error('Attributes update failed:', error));
        });
      });
    }

    function applyFilters() {
      let filtered = allItems;
      if (searchTerm) {
        filtered = filtered.filter(item => 
          item.name.toLowerCase().includes(searchTerm) || 
          item.type.toLowerCase().includes(searchTerm) ||
          (item.condition || '').toLowerCase().includes(searchTerm) ||
          Object.values(item.attributes || {}).some(value => value.toLowerCase().includes(searchTerm))
        );
      }
      sortedItems = filtered.sort((a, b) => {
        const aVal = a[currentSortKey] || '';
        const bVal = b[currentSortKey] || '';
        return isAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      });
      currentPage = 1;
      renderInventory(sortedItems);
    }

    function formatAttributes(attributes) {
      if (!attributes || Object.keys(attributes).length === 0) return '';
      return Object.entries(attributes).map(([key, value]) => `${key}: ${value}`).join(', ');
    }

    function renderAttributes(id, type, attributes) {
      if (!attributes) attributes = {};
      let html = '';
      if (type === 'pokemon_tcg' || type === 'other_tcg') {
        html = `
          <span id="display-tcg_id-${id}">${attributes.tcg_id || ''}</span>
          <input id="edit-tcg_id-${id}" value="${attributes.tcg_id || ''}" style="display: none;">
          <br><span id="display-card_set-${id}">${attributes.card_set || ''}</span>
          <input id="edit-card_set-${id}" value="${attributes.card_set || ''}" style="display: none;">
          <br><span id="display-rarity-${id}">${attributes.rarity || ''}</span>
          <input id="edit-rarity-${id}" value="${attributes.rarity || ''}" style="display: none;">
        `;
      } else if (type === 'video_game') {
        html = `
          <span id="display-platform-${id}">${attributes.platform || ''}</span>
          <input id="edit-platform-${id}" value="${attributes.platform || ''}" style="display: none;">
        `;
      } else if (type === 'console') {
        html = `
          <span id="display-brand-${id}">${attributes.brand || ''}</span>
          <input id="edit-brand-${id}" value="${attributes.brand || ''}" style="display: none;">
          <br><span id="display-model-${id}">${attributes.model || ''}</span>
          <input id="edit-model-${id}" value="${attributes.model || ''}" style="display: none;">
        `;
      } else if (type === 'football_shirt') {
        html = `
          <span id="display-team-${id}">${attributes.team || ''}</span>
          <input id="edit-team-${id}" value="${attributes.team || ''}" style="display: none;">
          <br><span id="display-year-${id}">${attributes.year || ''}</span>
          <input id="edit-year-${id}" value="${attributes.year || ''}" style="display: none;">
        `;
      } else if (type === 'coin') {
        html = `
          <span id="display-denomination-${id}">${attributes.denomination || ''}</span>
          <input id="edit-denomination-${id}" value="${attributes.denomination || ''}" style="display: none;">
          <br><span id="display-year_minted-${id}">${attributes.year_minted || ''}</span>
          <input id="edit-year_minted-${id}" value="${attributes.year_minted || ''}" style="display: none;">
        `;
      }
      return html;
    }

    function toggleAttributeFields(id, enable) {
      const type = document.getElementById(`type-${id}`).value;
      const fields = type === 'pokemon_tcg' || type === 'other_tcg' ? ['tcg_id', 'card_set', 'rarity'] :
                     type === 'video_game' ? ['platform'] :
                     type === 'console' ? ['brand', 'model'] :
                     type === 'football_shirt' ? ['team', 'year'] :
                     type === 'coin' ? ['denomination', 'year_minted'] : [];
      fields.forEach(field => {
        const display = document.getElementById(`display-${field}-${id}`);
        const input = document.getElementById(`edit-${field}-${id}`);
        if (display && input) {
          display.style.display = enable ? 'none' : 'inline';
          input.style.display = enable ? 'inline' : 'none';
        }
      });
    }

    function getUpdatedAttributes(id, type) {
      const attributes = {};
      if (type === 'pokemon_tcg' || type === 'other_tcg') {
        ['tcg_id', 'card_set', 'rarity'].forEach(field => {
          const input = document.getElementById(`edit-${field}-${id}`);
          if (input && input.value) attributes[field] = input.value;
        });
      } else if (type === 'video_game') {
        const input = document.getElementById(`edit-platform-${id}`);
        if (input && input.value) attributes.platform = input.value;
      } else if (type === 'console') {
        ['brand', 'model'].forEach(field => {
          const input = document.getElementById(`edit-${field}-${id}`);
          if (input && input.value) attributes[field] = input.value;
        });
      } else if (type === 'football_shirt') {
        ['team', 'year'].forEach(field => {
          const input = document.getElementById(`edit-${field}-${id}`);
          if (input && input.value) attributes[field] = input.value;
        });
      } else if (type === 'coin') {
        ['denomination', 'year_minted'].forEach(field => {
          const input = document.getElementById(`edit-${field}-${id}`);
          if (input && input.value) attributes[field] = input.value;
        });
      }
      return attributes;
    }

    renderInventory(allItems);
  });
}

module.exports = { render };