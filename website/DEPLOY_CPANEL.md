# Deploying to cPanel (GravelHosting)

This site is a normal Node.js/Express app, so it runs on cPanel as long as
your plan has **"Setup Node.js App"** (cPanel calls this the Node.js
Selector — it's a CloudLinux feature most shared hosts include).

## 1. Check you have it

Log into cPanel and look under the **Software** section for an icon called
**"Setup Node.js App"**. If it's there, you're good — skip to step 2.

If it's *not* there:
- Open a support ticket with GravelHosting and ask them to enable the
  Node.js Selector (CloudLinux) for your account — it's a flip of a switch
  on their end, not a plan upgrade, on most hosts.
- If they say your plan genuinely doesn't support Node at all (some
  bargain shared plans are PHP-only), you'd need a VPS plan instead — tell
  me and I'll help you pick one.

## 2. Create the app

1. Software → **Setup Node.js App** → **Create Application**.
2. **Node.js version**: pick the newest available (18 or 20+; this app has
   no special version requirement).
3. **Application mode**: Production.
4. **Application root**: e.g. `angkorsmp-website` (a folder under your
   home directory — NOT inside `public_html`).
5. **Application URL**: the domain/subdomain you want the site on.
6. **Application startup file**: `server.js`.
7. Click **Create**.

cPanel now creates the app, gives it its own isolated `node`/`npm`, and
shows a command like:
```
source /home/USERNAME/nodevenv/angkorsmp-website/20/bin/activate && cd /home/USERNAME/angkorsmp-website
```
Keep that around — you'll run commands with it below.

## 3. Upload the code

Easiest via SSH/Terminal (cPanel → **Terminal**, if enabled) or File
Manager + a zip upload:

```bash
cd ~/angkorsmp-website
git clone https://github.com/Fastechgaming/ImGoodGuy.git .
# or upload website/ contents directly if you don't have git on the host
```

Only the contents of this repo's `website/` folder need to end up in the
application root (so `server.js`, `package.json`, `routes/`, `public/`,
etc. are directly inside `~/angkorsmp-website`).

## 4. Install dependencies

In cPanel → Setup Node.js App → your app → click **Run NPM Install**
(this uses the app's own isolated npm, which is important — a system-wide
`npm install` won't see the right Node version).

## 5. Environment variables

Still in the Node.js App screen, there's an **Environment Variables**
section. Add whatever this app's `.env` normally holds — Telegram bot
token, RCON host/port/password, admin password, etc. (Check `.env.example`
in the repo for the full list.) Do NOT set `PORT` — cPanel/Passenger
assigns that automatically and the app already respects
`process.env.PORT`.

## 6. Start it

Click **Restart** in the Node.js App screen. cPanel runs your app behind
Passenger (which keeps it alive, restarts it if it crashes, and reverse-
proxies your domain to it) — no PM2, no systemd, no tunnel needed.

## 7. The one real risk: outbound ports

This app needs to make **outbound** connections to your Minecraft
server's:
- query/ping port (usually 25565) — for the live player-count status, and
- RCON port (whatever you set it to) — for delivering store purchases.

Most shared hosts allow general outbound TCP, but some lock it down to
just HTTP(S)/SMTP for abuse-prevention reasons. If the site loads but the
server status stays "offline" and purchases never deliver, that's almost
certainly this — ask GravelHosting support to confirm outbound TCP to
arbitrary ports is allowed, or specifically whitelist your Minecraft
server's IP/ports.

## Updating later

```bash
cd ~/angkorsmp-website
git pull
# then in cPanel: Setup Node.js App -> Run NPM Install (only if package.json changed) -> Restart
```
