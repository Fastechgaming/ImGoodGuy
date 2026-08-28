const express = require("express");
const path = require("path");
const multer = require("multer");
const { nanoid } = require("nanoid");
const store = require("../lib/store");
const { getServerStatus } = require("../lib/minecraft");
const { normalizeServerName, isValidRawName } = require("../public/js/playername");
const telegram = require("../telegram/bot");
const { current: currentAccount, STORE_SCOPE } = require("./account");

const router = express.Router();

// Payment screenshots customers upload. Kept out of /public so proofs are not
// publicly browsable - they are only ever sent to the admin's Telegram.
const PROOF_DIR = path.join(__dirname, "..", "data", "proofs");
const proofUpload = multer({
  storage: multer.diskStorage({
    destination: PROOF_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
      cb(null, `${req.params.id}-${nanoid(6)}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) return cb(new Error("Please upload an image of your payment receipt."));
    cb(null, true);
  },
});

// Public, safe subset of the site config for the frontend to render.
router.get("/config", (req, res) => {
  const cfg = store.getConfig();
  res.json({
    serverName: cfg.serverName,
    tagline: cfg.tagline,
    welcomeMessage: cfg.welcomeMessage,
    logo: cfg.logo,
    logoIcon: cfg.logoIcon || cfg.logo,
    telegramLink: cfg.telegramLink,
    khqrImage: cfg.khqrImage,
    javaIp: cfg.javaIp,
    javaPort: cfg.javaPort,
    bedrockIp: cfg.bedrockIp,
    bedrockPort: cfg.bedrockPort,
    releaseDate: cfg.releaseDate,
    season: cfg.season,
    seasonStartDate: cfg.seasonStartDate,
    mapStartDate: cfg.mapStartDate,
    bluemapUrl: cfg.bluemapUrl,
    serverFeatures: cfg.serverFeatures || [],
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

// Public view of an order - used by checkout.html and success.html.
// Deliberately omits the delivery command and the stored proof filename.
router.get("/order/:id", (req, res) => {
  const order = store.findOrder(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json({
    id: order.id,
    itemId: order.itemId,
    itemName: order.itemName,
    itemImage: order.itemImage,
    itemDesc: order.itemDesc,
    amount: order.amount,
    currency: order.currency,
    playerName: order.playerName,
    edition: order.edition,
    status: order.status,
    createdAt: order.createdAt,
  });
});

// Step 1 of checkout: player name + edition. Creates a pending order and hands
// back its id; the customer is then sent to /checkout.html to pay + upload proof.
router.post("/checkout", (req, res) => {
  try {
    // The buyer is whoever is signed in — the store makes you verify a name
    // before it will show you a Buy button, so there is nothing to type here.
    const account = currentAccount(req, STORE_SCOPE);
    if (!account) {
      return res.status(401).json({ error: "Verify your Minecraft name before buying.", code: "NOT_SIGNED_IN" });
    }

    const { itemId } = req.body || {};
    if (!itemId) return res.status(400).json({ error: "itemId is required" });

    const item = store.findItem(itemId);
    if (!item) return res.status(404).json({ error: "Item not found" });
    if (item.comingSoon) return res.status(400).json({ error: "This item isn't available for purchase yet." });

    const edition = account.edition === "bedrock" ? "bedrock" : "java";
    if (!isValidRawName(account.player, edition)) {
      return res.status(400).json({ error: "Your saved name is no longer valid — please verify it again." });
    }
    const finalName = normalizeServerName(account.player, edition);

    const order = {
      id: nanoid(10),
      itemId: item.id,
      itemName: item.name,
      itemImage: item.image,
      itemDesc: item.shortDesc || "",
      amount: item.price,
      currency: item.currency || "USD",
      playerName: finalName,
      playerUuid: account.uuid || null,
      edition,
      status: "awaiting_payment",
      createdAt: Date.now(),
    };
    store.saveOrder(order);

    res.json({ orderId: order.id });
  } catch (err) {
    console.error("[checkout] error:", err);
    res.status(500).json({ error: err.message || "Failed to start checkout" });
  }
});

// Step 2: customer uploads their payment screenshot. We forward it straight to
// the admin's Telegram with Accept / Reject buttons.
router.post("/order/:id/proof", (req, res, next) => {
  proofUpload.single("proof")(req, res, async (uploadErr) => {
    if (uploadErr) return res.status(400).json({ error: uploadErr.message });
    try {
      const order = store.findOrder(req.params.id);
      if (!order) return res.status(404).json({ error: "Order not found" });
      if (!req.file) return res.status(400).json({ error: "Please attach your payment screenshot." });

      const updated = store.updateOrder(order.id, {
        status: "pending_review",
        proofFile: req.file.filename,
        submittedAt: Date.now(),
      });

      const sent = await telegram.sendOrderForReview(updated, path.join(PROOF_DIR, req.file.filename));
      if (!sent.ok) {
        // The order is still recorded, so the owner can find it in the admin
        // panel even when Telegram is misconfigured or down.
        console.error("[order] Telegram notification failed:", sent.reason);
      }

      res.json({ ok: true, orderId: order.id, notified: sent.ok });
    } catch (err) {
      next(err);
    }
  });
});

module.exports = router;
