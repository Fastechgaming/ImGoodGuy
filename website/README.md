# AngkorSMP Website

A self-contained Node.js + Express website for the **AngkorSMP** Minecraft server: home page with live server status, a webstore with KHQR (Bakong) checkout, a live BlueMap page, and two ways to manage store items (a web admin panel and a Telegram bot).

This lives in its own folder (`website/`) with its own `package.json`, separate from the Discord bot in the rest of this repo.

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
| `discordInvite` | Your Discord invite link (used by the Home page Discord button). |
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
| `BAKONG_ACCOUNT_ID` | Your Bakong account ID that receives payments (e.g. `yourname@bank`), from your bank/wallet's Bakong-linked app. |
| `BAKONG_MERCHANT_NAME` / `BAKONG_MERCHANT_CITY` | Shown on the generated KHQR. |
| `BAKONG_MERCHANT_ID` | Only needed if you have a registered **merchant** Bakong account (leave blank for a personal/individual account). |
| `BAKONG_OPENAPI_TOKEN` | From the [Bakong Open API Developer Portal](https://api-bakong.nbc.gov.kh) — required to auto-detect when a KHQR has been paid. **Without this, KHQR codes still generate and can be paid, but the site can't automatically confirm payment** — see the note below. |

**Important — test before going live:** KHQR generation is fully implemented and tested (it builds a spec-compliant EMVCo/Bakong QR string locally, no external calls needed). Payment **verification** calls Bakong's Open API (`check_transaction_by_md5`) — that endpoint's exact response format can change on NBC's side and couldn't be tested live from this dev environment, so before launch: make one real small payment and confirm the order flips to "paid" and you get the Telegram alert. If the response shape has drifted, the only file to touch is `website/lib/khqr.js` (`checkPaymentByMd5`).

## 3. Managing store items (3 ways — pick whichever is easiest for you)

1. **Web admin panel** (recommended, easiest): go to `http://your-domain/admin`, log in, and add/edit/delete items with a normal form — upload an image straight from your computer, write the description, set the price. No file editing needed.
2. **Telegram bot**: message your bot `/additem` and it'll walk you through it step by step (category → name → price → description → info text → video link → send a photo for the image). Also supports `/listitems`, `/edititem <id> <field> <value>`, `/edititem <id> image` (then send a photo), and `/delitem <id>`. Only works for the Telegram account set as `TELEGRAM_ADMIN_CHAT_ID`.
3. **Directly edit `website/data/items.json`** — it's a plain JSON file with `ranks`, `coins`, and `other` arrays. Useful for bulk edits.

All three write to the same file, so mix and match freely.

## 4. Purchase flow

1. Customer clicks **Buy Now** on an item → enters their Minecraft username → toggles **Java/Bedrock** (Bedrock automatically prepends a `.` to the name, since that's the standard way Bedrock players are told apart on Java-based servers via Geyser/Floodgate).
2. Continue → the server generates a Bakong **KHQR** code for the exact item price and shows it in a QR modal.
3. The page polls every 4 seconds to check if it's been paid (via Bakong's Open API). The QR is valid for 15 minutes.
4. Once paid, the modal switches to a success screen with the amount, item, order ID, and a link to your Telegram support — with a **Back to store** button, no page reload needed.
5. You get a Telegram message the moment a payment is confirmed.

Delivering the actual in-game item/rank (e.g. running a console command) is **not** wired up yet since that depends on your server's plugins (LuckPerms, an economy plugin, etc.) — `telegram/bot.js`'s `notifyPurchase()` and `routes/api.js`'s `/checkout/:id/status` are the two places to hook in an automatic delivery command (e.g. via RCON) if you want that later.

## 5. The Map page (BlueMap)

The Map page embeds your BlueMap instance in an iframe, plus an "Open in a new tab" link as a fallback (some browsers/ad-blockers restrict iframes). To make this work:

1. Host BlueMap somewhere with a public URL (e.g. `https://map.angkorsmp.com`).
2. Put that URL into `bluemapUrl` in `config/site.config.json`.

BlueMap's web app doesn't send restrictive framing headers by default, so embedding normally works out of the box. If your reverse proxy (nginx/Caddy) adds an `X-Frame-Options` or `Content-Security-Policy: frame-ancestors` header in front of BlueMap, remove/relax it for the domain this website runs on, or the iframe will show the fallback link instead.

## 6. Server status & the Home page IP button

- Server status (online/offline + player count) is fetched server-side via `minecraft-server-util`, tried as **Java** first, then **Bedrock** — cached for 10 seconds so a burst of visitors doesn't hammer your server.
- The **Server IP** button behaves differently by device, per your request:
  - **Desktop/laptop:** click → copies the Java IP:port to the clipboard.
  - **Mobile:** tap → copies the IP too, *and* tries to open the Minecraft Bedrock app directly to your server via a `minecraft://` deep link (only works if the visitor has Minecraft Bedrock installed; there's no equivalent official deep link for Java Edition, which is why desktop uses copy).

## 7. Theme & assets

The look is a cartoony, saturated gold/amber/brown "Angkor Wat sunset" palette (`public/css/style.css`) built to match the server's own pixel-art banner: chunky 3D-pressed buttons, thick dark outlines, and a warm sunset gradient hero, with the real logo dropped in at `public/images/site/logo-full.png` (full wordmark, used big on the Home hero) and `public/images/site/logo-icon.png` (temple-only crop, used in the nav badge and favicon). Both are cropped from your banner with a transparent background. To swap in a new logo later, replace those two files (same filenames) or point `logo` / `logoIcon` in `config/site.config.json` at new paths. Item placeholder art (`public/images/items/placeholder-*.svg`) and the decorative temple skyline (`public/images/site/temple-silhouette.svg`) are still simple vector placeholders — swap those any time too.

The layout is responsive: a hamburger nav under ~760px, a stacked hero on mobile, and a grid that reflows from multi-column (desktop) down to single-column (phones) throughout the store.

## 8. Running in production

- Use a process manager: `pm2 start server.js --name angkorsmp-web` (or systemd).
- Put it behind a reverse proxy (nginx/Caddy) with HTTPS.
- Make sure `.env` is never committed (it's already in `.gitignore`).
- Back up `website/data/items.json` and `website/data/orders.json` periodically — they're the entire "database".

## 9. Project structure

```
website/
  server.js              Express app entrypoint
  config/site.config.json  Public site settings (server IP, dates, links…)
  data/items.json         Store items (ranks/coins/other)
  data/orders.json        Purchase/checkout records
  lib/                    KHQR generation+verification, Minecraft status ping, JSON data store
  routes/api.js           Public JSON API (config, status, items, checkout)
  routes/admin.js         Password-protected admin panel (item CRUD + image upload)
  telegram/bot.js         Telegram bot: purchase alerts + /additem etc.
  views/                  EJS templates for the admin panel
  public/                 Everything served to visitors: index.html, store.html, map.html, css/js/images
```
