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
const SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";

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
});
const playerSession = cookieSession({
  name: "angkorsmp_player",
  secret: SECRET,
  maxAge: 400 * 24 * 60 * 60 * 1000,
  httpOnly: true,
  sameSite: "lax",
});

app.use("/api", playerSession);
app.use("/api/account", accountRoutes);
app.use("/api/games", gamesRoutes);
app.use("/api", apiRoutes);
app.use("/admin", adminSession, adminRoutes);

app.use(express.static(path.join(__dirname, "public")));

// Fallback error handler for admin form errors (bad category, bad upload, etc.)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).send(`Something went wrong: ${err.message}`);
});

app.listen(PORT, () => {
  console.log(`AngkorSMP website running at http://localhost:${PORT}`);
  if (require("./lib/angkorlink").enabled()) {
    console.log("[angkorlink] plugin bridge configured — verifying names against the Minecraft server");
  } else {
    console.log("[angkorlink] no plugin configured — names are accepted without server verification");
  }
  telegram.initBot();
});
