const express = require("express");
const { nanoid } = require("nanoid");
const store = require("../lib/store");
const { getServerStatus } = require("../lib/minecraft");
const { buildKHQR, qrStringToDataUrl, checkPaymentByMd5 } = require("../lib/khqr");
const telegram = require("../telegram/bot");

const router = express.Router();

// Public, safe subset of the site config for the frontend to render.
router.get("/config", (req, res) => {
  const cfg = store.getConfig();
  res.json({
    serverName: cfg.serverName,
    tagline: cfg.tagline,
    welcomeMessage: cfg.welcomeMessage,
    logo: cfg.logo,
    logoIcon: cfg.logoIcon || cfg.logo,
    discordInvite: cfg.discordInvite,
    javaIp: cfg.javaIp,
    javaPort: cfg.javaPort,
    bedrockIp: cfg.bedrockIp,
    bedrockPort: cfg.bedrockPort,
    releaseDate: cfg.releaseDate,
    season: cfg.season,
    seasonStartDate: cfg.seasonStartDate,
    mapStartDate: cfg.mapStartDate,
    bluemapUrl: cfg.bluemapUrl,
    socials: cfg.socials,
    supportTelegram: process.env.TELEGRAM_SUPPORT_USERNAME || "",
  });
});

router.get("/status", async (req, res) => {
  const cfg = store.getConfig();
  const result = await getServerStatus(cfg);
  res.json(result);
});

router.get("/items", (req, res) => {
  res.json(store.getItems());
});

router.get("/order/:id", (req, res) => {
  const order = store.findOrder(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  const { khqrString, ...safe } = order;
  res.json(safe);
});

router.post("/checkout", async (req, res) => {
  try {
    const { itemId, playerName, edition } = req.body || {};
    if (!itemId || !playerName || !["java", "bedrock"].includes(edition)) {
      return res.status(400).json({ error: "itemId, playerName and edition (java|bedrock) are required" });
    }

    const item = store.findItem(itemId);
    if (!item) return res.status(404).json({ error: "Item not found" });

    const cleanName = String(playerName).trim().replace(/^\.+/, "");
    if (!/^[A-Za-z0-9_]{2,16}$/.test(cleanName)) {
      return res.status(400).json({ error: "Please enter a valid Minecraft username (letters, numbers, underscore)." });
    }
    const finalName = edition === "bedrock" ? `.${cleanName}` : cleanName;

    const orderId = nanoid(10);
    const { qrString, md5, expiresAt } = buildKHQR({
      amount: item.price,
      currency: item.currency || "USD",
      reference: orderId,
      playerName: finalName,
    });
    const qrDataUrl = await qrStringToDataUrl(qrString);

    const order = {
      id: orderId,
      itemId: item.id,
      itemName: item.name,
      amount: item.price,
      currency: item.currency || "USD",
      playerName: finalName,
      edition,
      khqrString: qrString,
      md5,
      status: "pending",
      createdAt: Date.now(),
      expiresAt,
    };
    store.saveOrder(order);

    res.json({
      orderId,
      qrDataUrl,
      amount: order.amount,
      currency: order.currency,
      itemName: order.itemName,
      playerName: order.playerName,
      expiresAt: order.expiresAt,
    });
  } catch (err) {
    console.error("[checkout] error:", err);
    res.status(500).json({ error: err.message || "Failed to start checkout" });
  }
});

router.get("/checkout/:id/status", async (req, res) => {
  const order = store.findOrder(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });

  if (order.status === "paid") {
    return res.json({ status: "paid" });
  }

  const check = await checkPaymentByMd5(order.md5);
  if (check.paid) {
    store.updateOrder(order.id, { status: "paid", paidAt: Date.now() });
    telegram.notifyPurchase({ ...order, status: "paid" });
    return res.json({ status: "paid" });
  }

  res.json({ status: "pending", verified: check.checked });
});

module.exports = router;
