# Putting the AngkorSMP website online

## First, the thing to know about GitHub and Cloudflare

**GitHub Pages cannot host this site.** Pages only serves static files. This
site is a Node.js server — the store checkout, the games coin ledger, the login
cookie, the Telegram bot and RCON all need a process running. On Pages you would
get the Home page and nothing that works.

**Cloudflare Workers and Cloudflare Pages cannot host it either**, for the same
kind of reason plus two more:

| What the site does | Why Workers can't |
|---|---|
| Runs Express with `node-telegram-bot-api` polling | Workers are short-lived request handlers, not a long-running process |
| Pings the Minecraft server (`minecraft-server-util`) | Needs raw TCP and UDP sockets; Workers only speak HTTP |
| Sends RCON commands (`rcon-client`) | Same — raw TCP |
| Writes `data/orders.json`, `data/gamestats.json`, uploaded receipts | Workers have no filesystem |

**The Cloudflare product you want is Cloudflare Tunnel.** The site runs on your
own machine; the tunnel gives it your domain, HTTPS and Cloudflare's protection,
without opening a single port.

```
   players ──HTTPS──▶ Cloudflare ──tunnel──▶ your box ──▶ node server.js :3000
                                                     └──▶ Minecraft + AngkorStore (localhost)
```

Running it on the same box as Minecraft is worth doing on purpose: the
AngkorStore plugin API and RCON both stay on `127.0.0.1`, so you never expose
them to the internet at all.

---

## Setup, once

Everything below runs on the machine that hosts Minecraft.

### 1. Node 22

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v      # expect v22.x
```

### 2. Get the code

```bash
sudo mkdir -p /opt/angkorsmp && sudo chown "$USER" /opt/angkorsmp
cd /opt/angkorsmp
git clone https://github.com/Fastechgaming/ImGoodGuy.git
cd ImGoodGuy/website
git checkout claude/angkorsmp-minecraft-website-35gstg
npm ci --omit=dev
```

### 3. Fill in `.env`

```bash
cp .env.example .env
nano .env
```

The ones that matter in production:

```ini
PORT=3000
# Only reachable through the tunnel, never on the box's public IP.
HOST=127.0.0.1
# Must be your real https URL — the app turns on Secure cookies from this.
SITE_URL=https://angkorsmp.com

ADMIN_USERNAME=...
ADMIN_PASSWORD=...                 # change it; /admin will be on the internet
SESSION_SECRET=...                 # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

TELEGRAM_BOT_TOKEN=...
TELEGRAM_ADMIN_CHAT_ID=...

# RCON is on the same machine, so localhost
RCON_HOST=127.0.0.1
RCON_PORT=25575
RCON_PASSWORD=...

# Once the AngkorStore plugin is running (see ../AngkorStore/README.md)
ANGKORSTORE_URL=http://127.0.0.1:8123
ANGKORSTORE_SECRET=...
```

Check it starts:

```bash
node server.js
# in another terminal:
curl localhost:3000/healthz     # -> {"ok":true,...}
```

### 4. Keep it running with systemd

```bash
sudo cp deploy/angkorsmp-web.service /etc/systemd/system/
sudo nano /etc/systemd/system/angkorsmp-web.service   # fix User= and the paths
sudo systemctl daemon-reload
sudo systemctl enable --now angkorsmp-web
systemctl status angkorsmp-web
journalctl -u angkorsmp-web -f      # live logs
```

### 5. Cloudflare Tunnel

Your domain has to be on Cloudflare first — add the site in the dashboard and
point your registrar at Cloudflare's nameservers.

```bash
# install
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb

# log in — opens a URL, pick your domain
cloudflared tunnel login

# create the tunnel and note the id it prints
cloudflared tunnel create angkorsmp-web

# point DNS at it (creates the CNAME for you)
cloudflared tunnel route dns angkorsmp-web angkorsmp.com
cloudflared tunnel route dns angkorsmp-web www.angkorsmp.com

# config
sudo mkdir -p /etc/cloudflared
sudo cp deploy/cloudflared-config.yml /etc/cloudflared/config.yml
sudo nano /etc/cloudflared/config.yml     # paste your tunnel id in both places
sudo cp ~/.cloudflared/<TUNNEL-ID>.json /etc/cloudflared/

# run it as a service
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

Open `https://angkorsmp.com`. That's it.

### 6. Two things to fix afterwards

* **The map iframe.** `bluemapUrl` is `http://15.235.229.65:25613/` — plain
  http. Browsers refuse to embed that inside an https page, so the Map page
  would show its fallback link instead of the map.
  `deploy/cloudflared-config.yml` has a commented-out block that puts BlueMap on
  `map.angkorsmp.com` through the same tunnel; enable it, then set
  `"bluemapUrl": "https://map.angkorsmp.com"` in `config/site.config.json`.
* **`/admin`.** It is password-protected but now public. Use a long password,
  or better, put a Cloudflare Access policy on `angkorsmp.com/admin` so only
  your email can reach it — Zero Trust → Access → Applications.

---

## Updating

```bash
cd /opt/angkorsmp/ImGoodGuy/website
./deploy/update.sh claude/angkorsmp-minecraft-website-35gstg
```

That pulls, reinstalls dependencies from the lockfile and restarts the service.

---

## What GitHub *is* good for here

`.github/workflows/website-ci.yml` runs on every push: installs dependencies,
parses every browser script, loads every server module, checks the English and
Khmer dictionaries still define the same keys, then boots the server and hits
the pages and the API. It catches a broken push before you deploy it. It does
not host anything.

---

## Backups

The whole "database" is a handful of files, so a nightly copy is enough:

```bash
# crontab -e
0 4 * * * tar czf /home/backup/angkorsmp-$(date +\%F).tgz \
  -C /opt/angkorsmp/ImGoodGuy/website data config public/images/items
```

* `data/orders.json` — every order and its status
* `data/proofs/` — uploaded payment screenshots
* `data/gamestats.json`, `data/leaderboard.json` — plays, coins, points
* `config/site.config.json` — your settings
* `public/images/items/` — item artwork uploaded through `/admin`

---

## If you'd rather not use your own box

Render or Railway will deploy this straight from GitHub. Both work, with one
catch worth knowing up front: on their free tiers the filesystem is wiped on
every deploy and the app sleeps when idle — so uploaded payment screenshots and
the coin ledger disappear, and the Telegram bot stops polling while asleep. You
need a paid persistent disk for it to behave properly. Settings if you go that
way: root directory `website`, build `npm ci`, start `npm start`, and the same
`.env` values as above except `HOST` (leave it unset so it binds `0.0.0.0`).
