# AngkorSMP Website

A self-contained Node.js + Express website for the **AngkorSMP** Minecraft server: home page with live server status, a webstore with KHQR checkout and Telegram order approval, a live BlueMap page, and two ways to manage store items (a web admin panel and a Telegram bot).

This lives in its own folder (`website/`) with its own `package.json`, separate from the Discord bot source in the rest of this repo.

## 1. Install & run

```bash
cd website
npm install
cp .env.example .env   # then fill in the values (see below)
npm start               # or: npm run dev (auto-restart with nodemon)
```

The site runs at `http://localhost:3000` by default (`PORT` in `.env`).

## 2. What you need to fill in

Everything below lives in **`website/.env`** (secrets) and **`website/config/site.config.json`** (public, non-secret settings).

### `config/site.config.json`
| Field | What it is |
|---|---|
| `logo` | Path to your logo. Replace `public/images/site/logo.svg` with your own image, or point this at a new file. |
| `telegramLink` | Your Telegram community link (used by the Home page Telegram button). |
| `khqrImage` | Path to the KHQR image customers scan to pay. Drop your own PNG in at `public/images/site/khqr.png` and point this at it. |
| `javaIp` / `javaPort` | Your Java server address. |
| `bedrockIp` / `bedrockPort` | Your Bedrock server address (used for the mobile "tap to join" button and for status checks if the Java ping fails). |
| `releaseDate` | ISO date your server launched — used to compute the "server age" (days/hours) on the Home page. |
| `season` | Free text, e.g. `"Season 2: Jungle Reclaims"`. |
| `bluemapUrl` | The public URL of your hosted BlueMap. Leave the placeholder in place and the Map page will show a friendly "not configured yet" message instead of a broken embed. |
| `welcomeMessage`, `tagline` | Shown on the Home page. |

### `.env` (copy from `.env.example`)
| Variable | Where to get it |
|---|---|
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Pick your own — used to log into `/admin`. |
| `SESSION_SECRET` | Any long random string: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `TELEGRAM_BOT_TOKEN` | Create a bot via [@BotFather](https://t.me/BotFather) on Telegram. |
| `TELEGRAM_ADMIN_CHAT_ID` | Your personal numeric Telegram ID — message [@userinfobot](https://t.me/userinfobot) to get it. Purchase alerts and the `/additem` etc. admin commands are locked to this ID only. |
| `TELEGRAM_SUPPORT_USERNAME` | Your public support `@username` shown on the purchase-success screen. |
| `RCON_HOST` / `RCON_PORT` / `RCON_PASSWORD` | Your Minecraft server's RCON details, used to run an item's delivery command when you press **Accept** in Telegram. Enable `enable-rcon=true`, `rcon.port`, `rcon.password` in `server.properties` first. Leave blank to approve orders manually. |

## 3. Managing store items (3 ways — pick whichever is easiest for you)

1. **Web admin panel** (recommended, easiest): go to `http://your-domain/admin`, log in, and add/edit/delete items with a normal form — upload an image straight from your computer, write the description, set the price. No file editing needed.
2. **Telegram bot**: message your bot `/additem` and it'll walk you through it step by step (category → name → price → description → info text → video link → send a photo for the image). Also supports `/listitems`, `/edititem <id> <field> <value>`, `/edititem <id> image` (then send a photo), and `/delitem <id>`. Only works for the Telegram account set as `TELEGRAM_ADMIN_CHAT_ID`.
An item can also be marked `"comingSoon": true` in `data/items.json` — it then
shows in the store as a greyed-out **Coming Soon** card that can't be bought
(the server rejects it too, not just the button).

3. **Directly edit `website/data/items.json`** — it's a plain JSON file with `ranks`, `coins`, and `other` arrays. Useful for bulk edits.

All three write to the same file, so mix and match freely.

## 4. Purchase flow

Payment is **manual review** — no bank API is involved, so nothing is slow or
can time out. The customer pays your KHQR and uploads a receipt; you approve it
from Telegram with one tap.

1. Customer clicks **Buy Now** (on the card, or inside the "!" info popup) → enters their Minecraft username → picks **Java** or **Bedrock**.
   - Bedrock names are normalised the way Geyser/Floodgate does it: a single leading `.` is added and spaces become `_`. So `Play er`, `.Play er` and `Play_er` all become `.Play_er` — never `..Play er`. The form shows the exact result live as **"In server name: …"**.
2. **Continue** → they land on **Complete your Purchase** (`/checkout.html`): a summary of what they're buying, your KHQR to scan, and a drop zone for their payment screenshot.
3. **SUBMIT** → they get a **Submit successful** page telling them to wait for the owner to confirm, with a support link and a **Back to home** button.
4. You receive a Telegram message with the receipt photo, the item, the price, and the in-server name, plus **✅ Accept** and **❌ Reject** buttons.
   - **Reject** → the order is marked rejected. Nothing else happens.
   - **Accept** → the website runs that item's **delivery command** on your Minecraft server over RCON (e.g. `lp user .Play_er parent add apsara`) and replies telling you what it ran and what the server said. If delivery fails (RCON not set up, plugin missing, etc.) it tells you why and leaves the order pending so you can fix it and press Accept again.

Each item's delivery command is configured per item — set it in the web admin
form ("Delivery command") or via `/edititem <id> deliveryCommand <command>` in
Telegram. Use `{player}` where the in-server name should go. Leave it blank to
handle that item by hand. The command needs a plugin that provides it — e.g.
LuckPerms for `lp user … parent add …`, an economy plugin for `eco give …`.

Payment screenshots are stored in `website/data/proofs/` and are **not** served
publicly — they only go to your Telegram.

## 5. The Games page (preview)

`/games.html` is a placeholder for the upcoming play-on-the-website feature:
players enter their Minecraft name, then see a hub with **Playtime** and
**Coins Earned**, a disabled **Withdraw** button, and a grid of coming-soon
mini-games.

**Nothing is persisted yet, deliberately.** The name lives in `sessionStorage`
only (so a page refresh doesn't bounce the player back to the form) and playtime
is counted from when that browser session started. When the real games are
built, replace the `Session` object at the top of `public/js/games.js` with
calls to a real backend + database, and wire the Withdraw button to an RCON
`eco give` command the same way store orders are delivered.

## 6. The Map page (BlueMap)

The Map page embeds your BlueMap instance in an iframe, plus an "Open in a new tab" link as a fallback (some browsers/ad-blockers restrict iframes). To make this work:

1. Host BlueMap somewhere with a public URL (e.g. `https://map.angkorsmp.com`).
2. Put that URL into `bluemapUrl` in `config/site.config.json`.

BlueMap's web app doesn't send restrictive framing headers by default, so embedding normally works out of the box. If your reverse proxy (nginx/Caddy) adds an `X-Frame-Options` or `Content-Security-Policy: frame-ancestors` header in front of BlueMap, remove/relax it for the domain this website runs on, or the iframe will show the fallback link instead.

## 7. Server status & the Home page IP button

- Server status (online/offline + player count) is fetched server-side via `minecraft-server-util`, checking **Java and Bedrock at the same time** (whichever answers first "wins") — cached for 10 seconds so a burst of visitors doesn't hammer your server.
- **If it shows offline while the server is actually online:** this is almost always the *website's* host blocking the outbound connection, not the Minecraft server. Check the server console/logs for a line like `[minecraft-status] java(...): ... | bedrock(...): ...` — it prints the real error for both checks every time. `"offline or unreachable"` after a full timeout usually means the machine running this website can't reach that port at all (many cheap web hosts only allow outbound 80/443, and outbound UDP for Bedrock in particular is often blocked). To fix it: host the website somewhere that allows outbound TCP to your `javaPort` and outbound UDP to your `bedrockPort`, or double-check those two values in `config/site.config.json` actually match your real server ports.
- The **Server IP** button behaves differently by device, per your request:
  - **Desktop/laptop:** click → copies the Java IP:port to the clipboard.
  - **Mobile:** tap → copies the IP too, *and* tries to open the Minecraft Bedrock app directly to your server via a `minecraft://` deep link (only works if the visitor has Minecraft Bedrock installed; there's no equivalent official deep link for Java Edition, which is why desktop uses copy).

## 8. Theme & assets

The site ships with a **dark theme by default** and a light theme; visitors switch with the ☀️/🌙 button in the nav and the choice is remembered in their browser. Both themes are defined as CSS custom properties at the top of `public/css/style.css` (`:root` = dark, `:root[data-theme="light"]` = light), so re-colouring either one is a matter of editing those two blocks.

The look is a bright, cute, hand-drawn-cartoon "Angkor Wat temple" UI (`public/css/style.css`). The nav is a stone-brick wall with vines hanging off the bottom edge (`public/images/site/vine-drape.svg`); nav links and the main hero buttons (Telegram/Server IP/Store) are wood-plank pills with a circular colored icon badge, a wood-grain texture, and a moss sprig growing off one corner. Store/feature cards are golden parchment/stone tablets with the same moss-sprig corner and a beveled edge (light highlight + soft dark shadow); item cards get a couple of little twinkling sparkles over their icon. Every button and card has a playful scale/wiggle animation on hover. A carved temple-frieze border strip (`public/images/site/khmer-pattern.svg`) runs between the nav/hero and above the footer on every page, section headings are flanked by small leaf glyphs, and a few little sway-animated flowers (`public/images/site/flower.svg`) dot the hero. The hero itself keeps a warm sunset gradient with a jungle canopy/palm silhouette (`public/images/site/forest-silhouette.svg`) along the bottom, hanging vine/frond decorations in the top corners (`public/images/site/leaf-corner.svg`), a soft glow behind the logo, and a few animated "firefly" particles for atmosphere. The real logo is dropped in at `public/images/site/logo-full.png` (full wordmark, used big on the Home hero) and `public/images/site/logo-icon.png` (temple-only crop, used in the nav badge and favicon) — both cropped from your banner with a transparent background. To swap in a new logo later, replace those two files (same filenames) or point `logo` / `logoIcon` in `config/site.config.json` at new paths. Item placeholder art (`public/images/items/placeholder-*.svg`) is still simple vector placeholder art — swap those any time too.

The "Chill Community / No Raiding / PvP Your Way / Live Cambodia Map" badges on the Home page come from the `serverFeatures` array in `config/site.config.json` — edit, add, or remove entries there (each has `icon`, `title`, `desc`, and an optional `link`) to change what's shown, no code changes needed.

The layout is responsive: a hamburger nav under ~760px, a stacked hero on mobile, and a grid that reflows from multi-column (desktop) down to single-column (phones) throughout the store.

## 9. Running in production

- Use a process manager: `pm2 start server.js --name angkorsmp-web` (or systemd).
- Put it behind a reverse proxy (nginx/Caddy) with HTTPS.
- Make sure `.env` is never committed (it's already in `.gitignore`).
- Back up `website/data/items.json` and `website/data/orders.json` periodically — they're the entire "database".

## 10. Project structure

```
website/
  server.js               Express app entrypoint
  config/site.config.json Public site settings (server IP, dates, links, KHQR image…)
  data/items.json         Store items (ranks/coins/other) + their delivery commands
  data/orders.json        Orders and their status
  data/proofs/            Uploaded payment screenshots (git-ignored, never served publicly)
  lib/store.js            Tiny JSON-file data layer
  lib/minecraft.js        Java+Bedrock status ping
  lib/rcon.js             Runs an item's delivery command on Accept
  routes/api.js           Public JSON API (config, status, items, checkout, proof upload)
  routes/admin.js         Password-protected admin panel (item CRUD + image upload)
  telegram/bot.js         Telegram bot: order review (Accept/Reject) + /additem etc.
  views/                  EJS templates for the admin panel
  public/                 index / games / store / checkout / success / map pages, css, js, images
    js/playername.js      Shared Java/Bedrock name rules (used by BOTH browser and server)
```
