require("dotenv").config();
const express = require("express");
const path = require("path");
const cookieSession = require("cookie-session");

const apiRoutes = require("./routes/api");
const adminRoutes = require("./routes/admin");
const telegram = require("./telegram/bot");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.json());
app.use(
  cookieSession({
    name: "angkorsmp_admin",
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    maxAge: 12 * 60 * 60 * 1000, // 12h
    httpOnly: true,
    sameSite: "lax",
  })
);

app.use("/api", apiRoutes);
app.use("/admin", adminRoutes);

app.use(express.static(path.join(__dirname, "public")));

// Fallback error handler for admin form errors (bad category, bad upload, etc.)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).send(`Something went wrong: ${err.message}`);
});

app.listen(PORT, () => {
  console.log(`AngkorSMP website running at http://localhost:${PORT}`);
  telegram.initBot();
});
