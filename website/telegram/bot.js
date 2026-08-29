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
const { runCommand, buildCommand } = require("../lib/rcon");
const angkorstore = require("../lib/angkorstore");

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
const STEPS = ["category", "name", "price", "shortDesc", "infoText", "videoUrl", "deliveryCommand", "image"];

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
    case "deliveryCommand":
      return 'Delivery command to run when you Accept an order.\nUse {player} for the in-server name, e.g.\n`lp user {player} parent add apsara`\nOr send "skip" to deliver this item manually.';
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
  } else if (field === "deliveryCommand") {
    session.item.deliveryCommand = text.toLowerCase() === "skip" ? "" : text;
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
        "  fields: name, price, shortDesc, infoText, videoUrl, category, deliveryCommand",
        "/edititem <id> image - then send a photo to replace the image",
        "/delitem <id> - delete an item",
        "",
        "Orders arrive here as a photo of the payment receipt with Accept / Reject buttons.",
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
    const allowed = ["name", "price", "shortDesc", "infoText", "videoUrl", "category", "deliveryCommand"];
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

  // Accept / Reject buttons on the order review messages.
  bot.on("callback_query", handleOrderDecision);

  bot.on("polling_error", (err) => console.error("[telegram] polling error:", err.message));

  console.log("[telegram] Bot started and listening for admin commands.");
  return bot;
}

/* ---------------- Order review (payment approval) ---------------- */

function orderSummaryText(order) {
  return [
    "🛒 *New AngkorSMP order*",
    "",
    `*Item:* ${order.itemName}`,
    order.upgrade ? `*Upgrade:* ${order.upgrade.fromRankId} → ${order.upgrade.toRankId}` : "",
    `*Price:* $${Number(order.amount).toFixed(2)} ${order.currency}`,
    `*In-server name:* \`${order.playerName}\``,
    `*Edition:* ${order.edition === "bedrock" ? "Bedrock" : "Java"}`,
    `*Order:* \`${order.id}\``,
    "",
    "Check the receipt above, then Accept to deliver or Reject to dismiss.",
  ]
    .filter(Boolean)
    .join("\n");
}

// Called by the website when a customer submits their payment screenshot.
async function sendOrderForReview(order, proofPath) {
  if (!bot || !ADMIN_CHAT_ID) {
    return { ok: false, reason: "Telegram bot is not configured (token / admin chat id missing)." };
  }
  try {
    await bot.sendPhoto(ADMIN_CHAT_ID, fs.createReadStream(proofPath), {
      caption: orderSummaryText(order),
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Accept", callback_data: `ord:accept:${order.id}` },
            { text: "❌ Reject", callback_data: `ord:reject:${order.id}` },
          ],
        ],
      },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

// A rank upgrade trades one held group for another - handled by the plugin's
// dedicated /rank/upgrade (it re-checks the player's real current rank
// against expectedFromRankId before touching anything, so a stale/replayed
// approval can't downgrade someone who ranked up in the meantime). Falls
// back to two raw RCON commands only when the plugin itself isn't running.
async function deliverUpgrade(order) {
  const { fromGroup, toGroup, fromRankId, toRankId } = order.upgrade;
  const context = { player: order.playerName, itemName: order.itemName, orderId: order.id };

  if (angkorstore.enabled()) {
    const res = await angkorstore.upgradeRank({
      transactionId: `order_${order.id}`,
      uuid: order.playerUuid || null,
      toRankId,
      expectedFromRankId: fromRankId,
    });
    if (res.ok) {
      return { ok: true, command: `upgrade ${fromRankId} -> ${toRankId}`, via: "plugin", response: res.duplicate ? "Already delivered." : "" };
    }
    if (res.status === 409) {
      return {
        ok: false,
        command: `upgrade ${fromRankId} -> ${toRankId}`,
        reason: `Their rank has changed since this was priced (now holds: ${res.currentRank ? res.currentRank.id : "none"}) — check in-game and deliver manually if still correct.`,
      };
    }
    console.warn(`[delivery] plugin refused upgrade for order ${order.id}: ${res.error || res.status}`);
  }

  const remove = await runCommand(`lp user {player} parent remove ${fromGroup}`, context);
  if (!remove.ok) return { ...remove, via: "rcon" };
  const add = await runCommand(`lp user {player} parent add ${toGroup}`, context);
  return { ...add, command: `${remove.command} && ${add.command}`, via: "rcon" };
}

// Deliver a paid order. The AngkorStore plugin is preferred when it is running:
// it is idempotent on the order id and queues the delivery if the player is
// offline. RCON stays as the fallback for servers without the plugin.
async function deliver(order, item) {
  if (order.upgrade) return deliverUpgrade(order);

  const template = item && item.deliveryCommand;
  if (!template) return { ok: false, reason: "This item has no delivery command configured." };

  const context = { player: order.playerName, itemName: order.itemName, orderId: order.id };
  const command = buildCommand(template, context);

  if (angkorstore.enabled()) {
    const res = await angkorstore.deliverPurchase({
      transactionId: `order_${order.id}`,
      uuid: order.playerUuid || null,
      name: order.playerName,
      edition: order.edition,
      itemId: order.itemId,
      itemName: order.itemName,
      commands: [command],
      requiresOnline: Boolean(item.requiresOnline),
    });
    if (res.ok) {
      return {
        ok: true,
        command,
        via: "plugin",
        response: res.queued ? "Player is offline — queued for their next login." : res.duplicate ? "Already delivered." : "",
      };
    }
    // Plugin configured but unhappy: fall through to RCON rather than stranding
    // a paid order, and say which path actually ran.
    console.warn(`[delivery] plugin refused order ${order.id}: ${res.error || res.status}`);
  }

  const viaRcon = await runCommand(template, context);
  return { ...viaRcon, via: "rcon" };
}

async function handleOrderDecision(query) {
  const data = String(query.data || "");
  if (!data.startsWith("ord:")) return;

  // Only the configured admin may approve orders.
  if (!ADMIN_CHAT_ID || String(query.from.id) !== ADMIN_CHAT_ID) {
    return bot.answerCallbackQuery(query.id, { text: "Not authorized.", show_alert: true });
  }

  const [, action, orderId] = data.split(":");
  const order = store.findOrder(orderId);
  if (!order) {
    return bot.answerCallbackQuery(query.id, { text: "Order not found.", show_alert: true });
  }
  if (order.status === "delivered" || order.status === "rejected") {
    return bot.answerCallbackQuery(query.id, { text: `Already ${order.status}.`, show_alert: true });
  }

  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const clearButtons = () =>
    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId }).catch(() => {});

  if (action === "reject") {
    store.updateOrder(orderId, { status: "rejected", decidedAt: Date.now() });
    await clearButtons();
    await bot.answerCallbackQuery(query.id, { text: "Order rejected." });
    return bot.sendMessage(chatId, `❌ Rejected order \`${orderId}\` — nothing was delivered.`, {
      parse_mode: "Markdown",
    });
  }

  if (action !== "accept") return;

  await bot.answerCallbackQuery(query.id, { text: "Delivering…" });
  const item = store.findItem(order.itemId);
  const result = await deliver(order, item);

  if (result.ok) {
    store.updateOrder(orderId, {
      status: "delivered",
      decidedAt: Date.now(),
      deliveredCommand: result.command,
    });
    await clearButtons();
    return bot.sendMessage(
      chatId,
      [
        `✅ *Delivered* order \`${orderId}\``,
        `Ran: \`${result.command}\``,
        result.response ? `Server said: _${result.response}_` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      { parse_mode: "Markdown" }
    );
  }

  // Delivery failed - leave the buttons in place so you can retry after fixing
  // the cause, and keep the order marked as still pending review.
  return bot.sendMessage(
    chatId,
    [
      `⚠️ *Could not deliver* order \`${orderId}\``,
      result.command ? `Command: \`${result.command}\`` : "",
      `Reason: ${result.reason}`,
      "",
      "The order was left pending — fix the issue and press Accept again, or run the command manually in-game.",
    ]
      .filter(Boolean)
      .join("\n"),
    { parse_mode: "Markdown" }
  );
}

module.exports = { initBot, sendOrderForReview };
