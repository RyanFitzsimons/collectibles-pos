const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Connect to the database
const dbPath = path.join(__dirname, 'inventory.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Failed to open database:', err);
    process.exit(1);
  }
  console.log('Connected to database:', dbPath);
});

// Ensure the collectibles table exists
db.serialize(() => {
  db.run('CREATE TABLE IF NOT EXISTS collectibles (id TEXT PRIMARY KEY, type TEXT, name TEXT, price REAL, stock INTEGER, image_url TEXT, tcg_id TEXT, card_set TEXT, rarity TEXT, condition TEXT)', (err) => {
    if (err) {
      console.error('Error creating collectibles table:', err);
      process.exit(1);
    }
    console.log('Collectibles table created or already exists');
  });
});

// Sample data to generate realistic items
const cardNames = [
  'Charizard', 'Pikachu', 'Blastoise', 'Venusaur', 'Gengar', 'Dragonite', 
  'Mewtwo', 'Snorlax', 'Lapras', 'Gyarados', 'Arcanine', 'Machamp'
];
const sets = [
  'Base Set', 'Jungle', 'Fossil', 'Team Rocket', 'Gym Heroes', 'Neo Genesis', 
  'EX Dragon', 'Crystal Guardians', 'Diamond & Pearl', 'Black & White'
];
const rarities = ['Common', 'Uncommon', 'Rare', 'Rare Holo', 'Ultra Rare'];
const conditions = [
  'Raw - NM', 'Raw - LP', 'Raw - MP', 'PSA - 10', 'PSA - 9', 'PSA - 8', 
  'CGC - 9', 'BGS - 9.5', 'TAG - 10'
];

// Function to generate a random item
function generateItem(index) {
  const name = cardNames[Math.floor(Math.random() * cardNames.length)];
  const set = sets[Math.floor(Math.random() * sets.length)];
  const rarity = rarities[Math.floor(Math.random() * rarities.length)];
  const condition = conditions[Math.floor(Math.random() * conditions.length)];
  const price = (Math.random() * 100 + 1).toFixed(2); // $1-$100
  const stock = Math.floor(Math.random() * 10) + 1; // 1-10
  const tcg_id = `${set.toLowerCase().replace(' ', '-')}-${index}`;
  const id = `${Date.now()}-${index}`;
  const image_url = `file://${path.join(__dirname, 'images', `${tcg_id}.png`)}`; // Mock local path
  
  return { id, type: 'pokemon_card', name, price, stock, image_url, tcg_id, card_set: set, rarity, condition };
}

// Generate and insert 10,000 items
const totalItems = 10000;
console.log(`Generating ${totalItems} items...`);

db.serialize(() => {
  const stmt = db.prepare('INSERT OR IGNORE INTO collectibles (id, type, name, price, stock, image_url, tcg_id, card_set, rarity, condition) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  
  for (let i = 0; i < totalItems; i++) {
    const item = generateItem(i);
    stmt.run(
      item.id, item.type, item.name, item.price, item.stock, item.image_url, item.tcg_id, item.card_set, item.rarity, item.condition,
      (err) => {
        if (err) console.error('Insert error:', err);
      }
    );
  }
  
  stmt.finalize((err) => {
    if (err) {
      console.error('Finalize error:', err);
    } else {
      console.log(`${totalItems} items inserted successfully!`);
    }
    db.close();
  });
});