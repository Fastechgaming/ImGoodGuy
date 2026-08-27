// Telegram bot: (1) sends you a message for every successful purchase,
// (2) lets you add/edit/delete store items straight from Telegram, as an
// alternative to the web admin panel at /admin.
//
// Everything here is locked to TELEGRAM_ADMIN_CHAT_ID - anyone else texting
// the bot gets an "unauthorized" reply and nothing happens.
const fs = require("fs");
const path = require("path");
const https = require("https");
const TelegramBot = require("node-telegram-bot-api");
const { nanoid } = require("nanoid");
const store = require("../lib/store");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID
  ? String(process.env.TELEGRAM_ADMIN_CHAT_ID)
  : null;

const IMAGES_DIR = path.join(__dirname, "..", "public", "images", "items");

let bot = null;

function isAdmin(msg) {
  return ADMIN_CHAT_ID && String(msg.chat.id) === ADMIN_CHAT_ID;
}

function slugify(text) {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "item"
  );
}

// --- Guided "/additem" wizard state, per chat ---
const sessions = new Map();
const STEPS = ["category", "name", "price", "shortDesc", "infoText", "videoUrl", "image"];

function startAddWizard(chatId) {
  sessions.set(chatId, { step: 0, item: {} });
}

function stepPrompt(step) {
  switch (step) {
    case "category":
      return "Which category? Reply with: ranks, coins, or other";
    case "name":
      return "Item name? (e.g. \"Apsara Rank\")";
    case "price":
      return "Price in USD? (e.g. 4.99)";
    case "shortDesc":
      return "Short description (shown on the store card)?";
    case "infoText":
      return "Full info text (shown in the \"!\" popup). You can use multiple lines.";
    case "videoUrl":
      return "Kit video URL (YouTube/embeddable link), or send \"skip\"";
    case "image":
      return "Send a photo for this item, or send \"skip\" to use a placeholder image.";
    default:
      return "";
  }
}

async function downloadTelegramPhoto(fileId, destPath) {
  const link = await bot.getFileLink(fileId);
  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https
      .get(link, (res) => {
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
  });
}

async function handleWizardMessage(msg) {
  const chatId = msg.chat.id;
  const session = sessions.get(chatId);
  if (!session) return false;

  const field = STEPS[session.step];
  const text = (msg.text || "").trim();

  if (field === "category") {
    if (!["ranks", "coins", "other"].includes(text.toLowerCase())) {
      await bot.sendMessage(chatId, 'Please reply with exactly: ranks, coins, or other');
      return true;
    }
    session.item.category = text.toLowerCase();
  } else if (field === "name") {
    if (!text) {
      await bot.sendMessage(chatId, "Name can't be empty, try again.");
      return true;
    }
    session.item.name = text;
    session.item.id = `${session.item.category}-${slugify(text)}-${nanoid(4)}`;
  } else if (field === "price") {
    const price = Number(text);
    if (Number.isNaN(price) || price < 0) {
      await bot.sendMessage(chatId, "That doesn't look like a valid price, e.g. 4.99. Try again.");
      return true;
    }
    session.item.price = price;
    session.item.currency = "USD";
  } else if (field === "shortDesc") {
    session.item.shortDesc = text;
  } else if (field === "infoText") {
    session.item.infoText = text;
  } else if (field === "videoUrl") {
    session.item.videoUrl = text.toLowerCase() === "skip" ? "" : text;
  } else if (field === "image") {
    if (msg.photo && msg.photo.length) {
      const largest = msg.photo[msg.photo.length - 1];
      const filename = `${session.item.id}.jpg`;
      try {
        await downloadTelegramPhoto(largest.file_id, path.join(IMAGES_DIR, filename));
        session.item.image = `/images/items/${filename}`;
      } catch (err) {
        await bot.sendMessage(chatId, `Couldn't download that photo (${err.message}). Try again or send "skip".`);
        return true;
      }
    } else if (text.toLowerCase() === "skip") {
      session.item.image = `/images/items/placeholder-${session.item.category === "ranks" ? "rank" : session.item.category}.svg`;
    } else {
      await bot.sendMessage(chatId, "Send a photo, or type \"skip\".");
      return true;
    }
  }

  session.step += 1;
  if (session.step >= STEPS.length) {
    store.upsertItem(session.item.category, session.item);
    sessions.delete(chatId);
    await bot.sendMessage(
      chatId,
      `✅ Added *${session.item.name}* to *${session.item.category}* for $${session.item.price}\nID: \`${session.item.id}\``,
      { parse_mode: "Markdown" }
    );
  } else {
    await bot.sendMessage(chatId, stepPrompt(STEPS[session.step]));
  }
  return true;
}

function formatItemList(items, category) {
  const list = items[category];
  if (!list.length) return `No items in *${category}* yet.`;
  return list.map((i) => `\`${i.id}\` — ${i.name} — $${i.price}`).join("\n");
}

function initBot() {
  if (!TOKEN) {
    console.log("[telegram] TELEGRAM_BOT_TOKEN not set - Telegram bot disabled.");
    return null;
  }
  if (!ADMIN_CHAT_ID) {
    console.log("[telegram] TELEGRAM_ADMIN_CHAT_ID not set - Telegram bot disabled (won't run unrestricted).");
    return null;
  }

  bot = new TelegramBot(TOKEN, { polling: true });

  bot.onText(/^\/start|^\/help/, (msg) => {
    if (!isAdmin(msg)) return bot.sendMessage(msg.chat.id, "This bot is private.");
    bot.sendMessage(
      msg.chat.id,
      [
        "*AngkorSMP Store Admin*",
        "/additem - add a new store item (guided, supports photo upload)",
        "/listitems [ranks|coins|other] - list items and their IDs",
        "/edititem <id> <field> <value> - edit one field",
        "  fields: name, price, shortDesc, infoText, videoUrl, category",
        "/edititem <id> image - then send a photo to replace the image",
        "/delitem <id> - delete an item",
      ].join("\n"),
      { parse_mode: "Markdown" }
    );
  });

  bot.onText(/^\/additem/, (msg) => {
    if (!isAdmin(msg)) return bot.sendMessage(msg.chat.id, "This bot is private.");
    startAddWizard(msg.chat.id);
    bot.sendMessage(msg.chat.id, stepPrompt(STEPS[0]));
  });

  bot.onText(/^\/listitems ?(\w+)?/, (msg, match) => {
    if (!isAdmin(msg)) return bot.sendMessage(msg.chat.id, "This bot is private.");
    const items = store.getItems();
    const cat = match[1];
    if (cat && !store.CATEGORIES.includes(cat)) {
      return bot.sendMessage(msg.chat.id, "Category must be ranks, coins, or other.");
    }
    const cats = cat ? [cat] : store.CATEGORIES;
    const text = cats.map((c) => `*${c}*\n${formatItemList(items, c)}`).join("\n\n");
    bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
  });

  bot.onText(/^\/delitem (\S+)/, (msg, match) => {
    if (!isAdmin(msg)) return bot.sendMessage(msg.chat.id, "This bot is private.");
    const ok = store.deleteItem(match[1]);
    bot.sendMessage(msg.chat.id, ok ? `Deleted \`${match[1]}\`` : "No item with that ID.", {
      parse_mode: "Markdown",
    });
  });

  bot.onText(/^\/edititem (\S+) image$/, (msg, match) => {
    if (!isAdmin(msg)) return bot.sendMessage(msg.chat.id, "This bot is private.");
    const item = store.findItem(match[1]);
    if (!item) return bot.sendMessage(msg.chat.id, "No item with that ID.");
    sessions.set(msg.chat.id, { step: -1, editImageFor: item });
    bot.sendMessage(msg.chat.id, `Send the new photo for "${item.name}".`);
  });

  bot.onText(/^\/edititem (\S+) (\S+) ([\s\S]+)/, (msg, match) => {
    if (!isAdmin(msg)) return bot.sendMessage(msg.chat.id, "This bot is private.");
    const [, id, field, value] = match;
    const allowed = ["name", "price", "shortDesc", "infoText", "videoUrl", "category"];
    const item = store.findItem(id);
    if (!item) return bot.sendMessage(msg.chat.id, "No item with that ID.");
    if (!allowed.includes(field)) {
      return bot.sendMessage(msg.chat.id, `Field must be one of: ${allowed.join(", ")}`);
    }
    if (field === "category" && !store.CATEGORIES.includes(value)) {
      return bot.sendMessage(msg.chat.id, "Category must be ranks, coins, or other.");
    }
    const patch = { [field]: field === "price" ? Number(value) : value };
    if (field === "category" && value !== item.category) {
      store.deleteItem(item.id);
      store.upsertItem(value, { ...item, ...patch });
    } else {
      store.upsertItem(item.category, { ...item, ...patch });
    }
    bot.sendMessage(msg.chat.id, `Updated \`${id}\`.`, { parse_mode: "Markdown" });
  });

  // Handles both the /additem wizard and a pending "/edititem <id> image" photo upload.
  bot.on("message", async (msg) => {
    if (!isAdmin(msg)) return;
    if (msg.text && msg.text.startsWith("/")) return; // commands handled above

    const session = sessions.get(msg.chat.id);
    if (!session) return;

    if (session.editImageFor) {
      if (!msg.photo || !msg.photo.length) {
        return bot.sendMessage(msg.chat.id, "Please send a photo.");
      }
      const item = session.editImageFor;
      const largest = msg.photo[msg.photo.length - 1];
      const filename = `${item.id}.jpg`;
      try {
        await downloadTelegramPhoto(largest.file_id, path.join(IMAGES_DIR, filename));
        store.upsertItem(item.category, { ...item, image: `/images/items/${filename}` });
        sessions.delete(msg.chat.id);
        bot.sendMessage(msg.chat.id, `✅ Image updated for "${item.name}".`);
      } catch (err) {
        bot.sendMessage(msg.chat.id, `Couldn't download that photo (${err.message}). Try again.`);
      }
      return;
    }

    await handleWizardMessage(msg);
  });

  bot.on("polling_error", (err) => console.error("[telegram] polling error:", err.message));

  console.log("[telegram] Bot started and listening for admin commands.");
  return bot;
}

async function notifyPurchase(order) {
  if (!bot || !ADMIN_CHAT_ID) return;
  const text = [
    "🛒 *New AngkorSMP purchase!*",
    `Item: ${order.itemName}`,
    `Player: \`${order.playerName}\` (${order.edition})`,
    `Amount: $${order.amount} ${order.currency}`,
    `Order: \`${order.id}\``,
  ].join("\n");
  try {
    await bot.sendMessage(ADMIN_CHAT_ID, text, { parse_mode: "Markdown" });
  } catch (err) {
    console.error("[telegram] failed to send purchase notification:", err.message);
  }
}

module.exports = { initBot, notifyPurchase };
