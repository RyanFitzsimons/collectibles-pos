# Collectibles POS

A desktop point-of-sale (POS) application built with Electron.js for managing a collectibles inventory, processing transactions (buy, sell, trade), and tracking cash reconciliation. Designed for trading card enthusiasts or small businesses, it supports inventory management with TCG card lookup via the Pokémon TCG API.

## Features
- **Sell**: Sell items from inventory to customers with negotiable prices.
- **Buy**: Purchase items from customers, adding them to inventory with TCG card search.
- **Trade**: Handle trade-ins and trade-outs with cash adjustments.
- **Transactions**: View transaction history with filtering, sorting, and CSV export.
- **Inventory**: Manage all items in stock, edit details (e.g., name, price, condition).
- **Reports**: Reconcile cash with starting balance, transaction totals, and notes.

## Prerequisites
- **Node.js**: v14 or later (includes npm).
- **SQLite**: No separate install needed—uses `sqlite3` module.
- **Pokémon TCG API Key**: Optional, for card lookup (get one at [pokemontcg.io](https://pokemontcg.io/)).

## Setup
1. **Clone the Repository**:
   ```bash
   git clone https://github.com/RyanFitzsimons/collectibles-pos.git
   cd collectibles-pos

Install Dependencies:
npm install

Set Up Environment (optional):
Create a .env file in the root directory.
Add your Pokémon TCG API key:
TCG_API_KEY=your-api-key-here
Without a key, TCG lookup falls back to local inventory search.

Initialize Database:
The app auto-creates inventory.db on first run with required tables.

## Running the Application
Start the App:
npm start

The app opens with the Sell tab by default.

## Usage
Sell: Browse inventory, add items to cart, adjust prices, and complete sales.
Buy: Search TCG cards or enter manually, add to cart, and complete purchases.
Trade: Add trade-ins (new items) and trade-outs (inventory items), complete with cash due/back.
Transactions: Filter by date or search, view items, export to CSV.
Inventory: Edit item details (e.g., fix condition errors post-purchase).
Reports: Reconcile cash—enter starting cash, actual cash, and notes to calculate discrepancy.
Project Structure
main.js: Handles app setup, database, and IPC communication with the renderer.
renderer.js: Manages UI rendering and logic for all tabs.
index.html: Main window template with sidebar navigation.
styles.css: Styling for the app’s dark theme and tables.
inventory.db: SQLite database (auto-generated) storing collectibles, transactions, and reconciliations.
Contributing
Feel free to fork, submit issues, or pull requests. Focus areas:

Adding more report types (e.g., profit tracking).
Enhancing inventory search/filtering.
Improving error handling.
License
This project is unlicensed—use it freely, but no warranty is provided.

## Acknowledgments
Built with Electron.js.
TCG data via Pokémon TCG API.
SQLite via sqlite3.