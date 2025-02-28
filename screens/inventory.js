const { ipcRenderer } = require('electron');
const { cleanPrice, debounce } = require('../utils'); // Add debounce import

// Render the Inventory tab UI with editable items
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
            <input id="inventory-search" type="text" placeholder="Search by Name or Attributes" value="${searchTerm}">
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
                  <td>${formatAttributes(item.attributes)}</td>
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

      // Bind edit/save events after DOM render
      document.querySelectorAll('.edit-item').forEach(button => {
        button.addEventListener('click', () => {
          const id = button.dataset.id;
          console.log('Edit clicked for ID:', id); // Debug log
          button.style.display = 'none';
          const saveButton = document.querySelector(`.save-item[data-id="${id}"]`);
          if (saveButton) saveButton.style.display = 'inline';
          ['type', 'name', 'price', 'condition'].forEach(field => {
            const input = document.getElementById(`${field}-${id}`);
            if (input) input.disabled = false;
          });
        });
      });

      document.querySelectorAll('.save-item').forEach(button => {
        button.addEventListener('click', () => {
          const id = button.dataset.id;
          console.log('Save clicked for ID:', id); // Debug log
          const updatedItem = {
            id,
            type: document.getElementById(`type-${id}`).value,
            name: document.getElementById(`name-${id}`).value,
            price: parseFloat(document.getElementById(`price-${id}`).value) || 0,
            condition: document.getElementById(`condition-${id}`).value
          };
          ipcRenderer.send('update-inventory-item', updatedItem);
          ipcRenderer.once('update-inventory-success', () => {
            button.style.display = 'none';
            const editButton = document.querySelector(`.edit-item[data-id="${id}"]`);
            if (editButton) editButton.style.display = 'inline';
            ['type', 'name', 'price', 'condition'].forEach(field => {
              const input = document.getElementById(`${field}-${id}`);
              if (input) input.disabled = true;
            });
            allItems = allItems.map(i => i.id === id ? { ...i, ...updatedItem } : i);
            renderInventory(allItems);
          });
          ipcRenderer.once('update-inventory-error', (event, error) => console.error('Update failed:', error));
        });
      });
    }

    function applyFilters() {
      let filtered = allItems;
      if (searchTerm) {
        filtered = filtered.filter(item => 
          item.name.toLowerCase().includes(searchTerm) || 
          item.type.toLowerCase().includes(searchTerm) ||
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

    renderInventory(allItems);
  });
}

module.exports = { render };