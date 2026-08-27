// Tiny JSON-file "database". No external DB needed -> easiest to edit by hand if you ever want to.
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const ITEMS_FILE = path.join(DATA_DIR, "items.json");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const CONFIG_FILE = path.join(__dirname, "..", "config", "site.config.json");

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    return fallback;
  }
}

function writeJson(file, data) {
  // write to a temp file then rename -> avoids a half-written file if the process dies mid-write
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

const CATEGORIES = ["ranks", "coins", "other"];

function getConfig() {
  return readJson(CONFIG_FILE, {});
}

function saveConfig(cfg) {
  writeJson(CONFIG_FILE, cfg);
}

function getItems() {
  const data = readJson(ITEMS_FILE, { ranks: [], coins: [], other: [] });
  for (const cat of CATEGORIES) if (!Array.isArray(data[cat])) data[cat] = [];
  return data;
}

function saveItems(data) {
  writeJson(ITEMS_FILE, data);
}

function findItem(id) {
  const items = getItems();
  for (const cat of CATEGORIES) {
    const found = items[cat].find((i) => i.id === id);
    if (found) return found;
  }
  return null;
}

function upsertItem(category, item) {
  if (!CATEGORIES.includes(category)) throw new Error(`Unknown category: ${category}`);
  const items = getItems();
  const list = items[category];
  const idx = list.findIndex((i) => i.id === item.id);
  if (idx === -1) list.push(item);
  else list[idx] = { ...list[idx], ...item };
  saveItems(items);
  return item;
}

function deleteItem(id) {
  const items = getItems();
  let removed = false;
  for (const cat of CATEGORIES) {
    const before = items[cat].length;
    items[cat] = items[cat].filter((i) => i.id !== id);
    if (items[cat].length !== before) removed = true;
  }
  if (removed) saveItems(items);
  return removed;
}

function getOrders() {
  return readJson(ORDERS_FILE, []);
}

function saveOrder(order) {
  const orders = getOrders();
  orders.push(order);
  writeJson(ORDERS_FILE, orders);
  return order;
}

function updateOrder(id, patch) {
  const orders = getOrders();
  const idx = orders.findIndex((o) => o.id === id);
  if (idx === -1) return null;
  orders[idx] = { ...orders[idx], ...patch };
  writeJson(ORDERS_FILE, orders);
  return orders[idx];
}

function findOrder(id) {
  return getOrders().find((o) => o.id === id) || null;
}

module.exports = {
  CATEGORIES,
  getConfig,
  saveConfig,
  getItems,
  saveItems,
  findItem,
  upsertItem,
  deleteItem,
  getOrders,
  saveOrder,
  updateOrder,
  findOrder,
};
