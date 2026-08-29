require("dotenv").config();
const express = require("express");
const path = require("path");
const cookieSession = require("cookie-session");

const apiRoutes = require("./routes/api");
const adminRoutes = require("./routes/admin");
const gamesRoutes = require("./routes/games");
const { router: accountRoutes } = require("./routes/account");
const telegram = require("./telegram/bot");

const app = express();
const PORT = process.env.PORT || 3000;
// Bind to 0.0.0.0 by default so it works anywhere. Behind a Cloudflare Tunnel
// set HOST=127.0.0.1 so the app is only reachable through the tunnel and never
// directly on the box's public IP.
const HOST = process.env.HOST || "0.0.0.0";
const SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";

// Served over HTTPS? Then we are behind a proxy (Cloudflare, nginx), so trust
// its forwarded headers and mark the session cookies Secure. Derived from
// SITE_URL so a local http:// run keeps working untouched.
const BEHIND_HTTPS = String(process.env.SITE_URL || "").startsWith("https://");
if (BEHIND_HTTPS) app.set("trust proxy", 1);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.json());

// Two separate cookies, each mounted only where it belongs: a short-lived one
// for the admin panel, and a long-lived one holding the player's name that the
// games page and the store both read.
const adminSession = cookieSession({
  name: "angkorsmp_admin",
  secret: SECRET,
  maxAge: 12 * 60 * 60 * 1000, // 12h
  httpOnly: true,
  sameSite: "lax",
  secure: BEHIND_HTTPS,
});
const playerSession = cookieSession({
  name: "angkorsmp_player",
  secret: SECRET,
  maxAge: 400 * 24 * 60 * 60 * 1000,
  httpOnly: true,
  sameSite: "lax",
  secure: BEHIND_HTTPS,
});

// Liveness probe for the tunnel / process manager. Deliberately does not touch
// the Minecraft server, so it stays instant even when the game server is down.
app.get("/healthz", (req, res) => res.json({ ok: true, uptime: Math.round(process.uptime()) }));

app.use("/api", playerSession);
app.use("/api/account", accountRoutes);
app.use("/api/games", gamesRoutes);
app.use("/api", apiRoutes);
app.use("/admin", adminSession, adminRoutes);

// Clean URLs: /store instead of /store.html. Old .html links (bookmarks,
// anything already indexed) redirect permanently to the clean one instead of
// just quietly still working, so there is one canonical URL per page.
const CLEAN_PAGES = ["games", "store", "map", "checkout", "success"];
app.get(CLEAN_PAGES.map((p) => `/${p}.html`), (req, res) => {
  const page = req.path.replace(/\.html$/, "");
  const qs = req.url.slice(req.path.length); // preserve ?order=... etc.
  res.redirect(301, page + qs);
});

app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

// Fallback error handler for admin form errors (bad category, bad upload, etc.)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).send(`Something went wrong: ${err.message}`);
});

app.listen(PORT, HOST, () => {
  console.log(`AngkorSMP website running on ${HOST}:${PORT}`);
  if (BEHIND_HTTPS) console.log(`[https] trusting proxy headers, session cookies marked Secure (SITE_URL=${process.env.SITE_URL})`);
  if (require("./lib/angkorstore").enabled()) {
    console.log("[angkorstore] plugin bridge configured — verifying names against the Minecraft server");
  } else {
    console.log("[angkorstore] no plugin configured — names are accepted without server verification");
  }
  telegram.initBot();
});
