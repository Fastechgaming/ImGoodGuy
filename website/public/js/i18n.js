/* =============================================================
   English / Khmer for the whole site.

   How it works:
     * mark text in the HTML with data-i18n="key" (or data-i18n-html for
       strings containing a link, data-i18n-placeholder / -title / -aria)
     * call t("key", { vars }) from JavaScript for anything rendered
     * anything that renders itself should listen for "i18n:change" and
       re-render, which is what the language button triggers

   House rule for the Khmer strings, straight from the brief: words that
   only make sense in English stay in English. Minecraft vocabulary
   (Server, Rank, Coins, Java, Bedrock, Creeper, Zombie, Combo, KHQR,
   Telegram, BlueMap, block names...) is never translated - it would read
   strangely to a Khmer player who knows the game in English.
   ============================================================= */
const I18n = (() => {
  const LANG_KEY = "angkorsmp-lang";
  const RIEL_PER_USD = 4000;

  const DICT = {
    en: {
      /* ---- nav / chrome ---- */
      "nav.home": "🏠 Home",
      "nav.games": "🎮 Games",
      "nav.store": "💰 Store",
      "nav.map": "🗺️ Map",
      "nav.banned": "🚫 Banned",
      "nav.menu": "Menu",
      "nav.language": "Language",
      "footer.copy": "© {year} AngkorSMP · Cambodia Minecraft Server 🇰🇭",

      /* ---- home ---- */
      "home.telegram": "Telegram",
      "home.telegramSub": "Join our community",
      "home.copyIp": "Click to copy IP",
      "home.tapJoin": "Tap to join (Bedrock)",
      "home.store": "Store",
      "home.storeSub": "Ranks, coins & more",
      "home.checking": "Checking server status…",
      "home.online": "Online — {online}/{max} players",
      "home.offline": "Server offline",
      "home.statusUnavailable": "Status unavailable",
      "home.welcome": "🌿 Welcome 🌿",
      "home.released": "Released",
      "home.serverAge": "Server Age",
      "home.currentSeason": "Current Season",
      "home.seasonAge": "Season Age",
      "home.copied": 'Copied "{ip}" — paste it into Minecraft > Multiplayer > Add Server',
      "home.opening": "Opening Minecraft (Bedrock)… Java IP also copied just in case!",

      /* ---- store ---- */
      "store.subtitle": "STORE",
      "store.gateTitle": "Who is this for?",
      "store.gateHint":
        "Enter your Minecraft name once so we know where to deliver your purchase — and so we can show your current rank and coins.",
      "store.unavailableTitle": "Unavailable",
      "store.unavailableBody":
        "The store is probably under maintenance or offline for now. Please check back later, or contact support if this keeps happening.",
      "store.loggedInAs": "Logged in as",
      "store.noRank": "No rank yet",
      "store.upgradeNow": "Upgrade Now",
      "store.currentRank": "Your current Rank",
      "store.lowerRank": "This is a lower rank",
      "store.alreadyOwned": "You already have this",
      "store.upRank": "Up Rank",
      "store.upRankChoose": "Choose a rank to upgrade from",
      "store.upgradeSummary": "Upgrade {from} → {to}",
      "store.upgradeCaption": "You are upgrading {from} to {to}",
      "store.confirmName": "Name",
      "store.confirmPlatform": "Platform",
      "store.confirm": "Confirm",
      "store.cancel": "Cancel",
      "store.changeHint":
        "This is the name your purchases are delivered to, and the account your website coins and points are saved under.",
      "store.tab.ranks": "Ranks",
      "store.tab.coins": "Coins",
      "store.tab.other": "Other",
      "store.empty": "No items here yet — check back soon!",
      "store.comingSoon": "Coming Soon",
      "store.buyNow": "Buy Now",
      "store.infoTitle": "Item info & kit video",
      "buy.title": "Buy: {item}",
      "buy.username": "Minecraft username",
      "buy.edition": "Edition",
      "buy.java": "Java",
      "buy.bedrock": "Bedrock",
      "buy.inServerName": "In server name: {name}",
      "buy.continue": "Continue",
      "buy.wait": "Please wait…",
      "buy.invalidJava": "Enter a valid Java username (letters, numbers, underscore).",
      "buy.invalidBedrock": "Enter a valid Bedrock gamertag (letters, numbers, spaces or underscores).",

      /* ---- checkout ---- */
      "checkout.title": "🌿 Complete your Purchase 🌿",
      "checkout.loading": "Loading your order…",
      "checkout.inServerName": "In server name",
      "checkout.edition": "Edition",
      "checkout.total": "Total",
      "checkout.step1": "1. Scan to pay",
      "checkout.scanHint": "Scan this KHQR with any Cambodian banking app and pay exactly {amount}.",
      "checkout.saveKhqr": "💾 Save KHQR",
      "checkout.saveHint": "Save it, then scan from your banking app's photo library.",
      "checkout.step2": "2. Upload your payment screenshot",
      "checkout.uploadHint": "After paying, attach a screenshot of the transaction receipt so we can verify it.",
      "checkout.dropText": "Tap to choose a screenshot, or drag one here",
      "checkout.submit": "SUBMIT",
      "checkout.submitNote": "Attach your receipt to enable Submit.",
      "checkout.ready": "Ready to submit.",
      "checkout.submitting": "Submitting…",
      "checkout.sending": "Sending your receipt…",
      "checkout.retry": "Something went wrong — please try again.",
      "checkout.trouble": "Having trouble?",
      "checkout.contactSupport": "Contact support on Telegram",
      "checkout.notImage": "Please choose an image file (a screenshot of your receipt).",
      "checkout.tooBig": "That image is larger than 8 MB — please use a smaller screenshot.",
      "checkout.noOrder": "No order specified.",
      "checkout.backToStore": "Back to the store",
      "checkout.loadFailed": "Couldn't load that order ({error}).",
      "checkout.khqrMissing": "KHQR image not uploaded yet — add it at public/images/site/khqr.png",

      /* ---- success ---- */
      "success.title": "Submit successful!",
      "success.body":
        "Thanks! Your payment receipt has been sent to the owner for review. Please wait for them to confirm your payment — your item is usually delivered in-game within a few minutes.",
      "success.item": "Item",
      "success.amount": "Amount",
      "success.orderId": "Order ID",
      "success.supportLine": "Haven't received your items after an hour? Please contact support.",
      "success.supportLineLink": "Haven't received your items after an hour?",
      "success.back": "Back to home",

      /* ---- map ---- */
      "map.title": "🌿 Cambodia Map 🌿",
      "map.subtitle": "LIVE MAP",
      "map.age": "Map Age: {age}",
      "map.explain": "Explore AngkorSMP in real time. Having trouble viewing it below?",
      "map.openNew": "Open the map in a new tab ↗",
      "map.fallback": "The live map couldn't be embedded here.",
      "map.openBluemap": "Open BlueMap in a new tab",
      "map.notConfigured":
        'The live map isn\'t configured yet. Set "bluemapUrl" in website/config/site.config.json to your BlueMap URL.',

      /* ---- banned players ---- */
      "banned.title": "🌿 Banned Players 🌿",
      "banned.subtitle": "BANNED",
      "banned.hint": "Currently banned players, most recent first.",
      "banned.unavailable": "⚠️ The banned players list is unavailable right now. Contact support for more info.",
      "banned.empty": "No one is currently banned. 🎉",
      "banned.colPlayer": "Player",
      "banned.colReason": "Reason",
      "banned.colBannedBy": "Banned By",
      "banned.colDate": "Date",
      "banned.colExpires": "Expires",
      "banned.permanent": "Permanent",
      "banned.noReason": "No reason given",

      /* ---- games: gate + hub ---- */
      "games.subtitle": "GAMES",
      "games.verify": "Verify",
      "games.coins": "Coins",
      "games.topPoints": "Top Points",
      "games.viewFull": "View full",
      "games.earnedToday": "earned {earned}/{cap} today",
      "games.playsLeft": "{left} of {cap} plays left today",
      "games.noPlaysLeft": "No plays left today",
      "games.noPlaysLeftToast": "You've used all 3 plays of this game today. Come back after the reset.",
      "games.cannotStart": "Can't start this round",
      "games.go": "GO!",

      "games.gateTitle": "Play & earn coins",
      "games.gateHint":
        "Play mini-games right here on the website and earn Angkor Coins for your in-game balance. Enter your Minecraft name once — we'll remember it next time.",
      "games.unavailableTitle": "Unavailable",
      "games.unavailableBody":
        "Games are probably under maintenance or offline for now. Please check back later, or contact support if this keeps happening.",
      "games.coinsUnavailable": "Unavailable",
      "games.coinBannerText": "⚠️ Coins won't be received right now — the coin system is unavailable. Contact support for more info.",
      "games.start": "Start Playing",
      "games.disclaimer":
        "Your name is saved on this device, so you only enter it once. Coins and points are stored on the server.",
      "games.playingAs": "Playing as",
      "games.changeName": "Change name",
      "games.changeLocked": "Name locked · {time} left",
      "games.changeTitle": "Change your name",
      "games.changeHint":
        "Your name is what your coins and points are saved under, so it can only be changed once a day.",
      "games.changeConfirm": "Save new name",
      "games.changeCancel": "Cancel",
      "games.nameSaved": "Your name is now {name}.",
      "games.nameLockedToast": "You can change your name again in {time}.",
      "games.welcomeBack": "Welcome back, {name}!",
      "games.points": "Points",
      "games.pointsSub": "Rounds this session",
      "games.coinsToday": "Coins Today",
      "games.dailyLimit": "of {cap} daily limit",
      "games.resetsIn": "Resets in {time}",
      "games.leaderboard": "Points Leaderboard",
      "games.leaderboardOpen": "Open Leaderboard",
      "games.leaderboardTitle": "🏆 Points Leaderboard",
      "games.leaderboardSub": "Top 50 players by lifetime points.",
      "games.leaderboardEmpty": "No scores yet — play a round and claim the top spot!",
      "games.leaderboardYou": "You",
      "games.leaderboardRank": "#",
      "games.leaderboardPlayer": "Player",
      "games.leaderboardPoints": "Points",
      "games.leaderboardYourRank": "Your rank: #{rank} · {points} points",
      "games.leaderboardUnranked": "Play a round to join the leaderboard.",
      "games.listHeading": "Mini-games",
      "games.listHint":
        "3 plays of each game a day, 1–75 Coins a play, up to 1,000 Coins a day total. Resets at midnight (UTC+7).",
      "games.play": "Play",
      "games.todaysReward": "Today's Reward: {earned} / {cap} Coins",
      "games.dailyComplete": "Daily Reward Complete!",
      "games.dailyCompleteFull": "Daily Reward Complete! {cap} / {cap} Coins",
      "games.dailyCompleteNote": "You can keep playing for fun, but won't earn more Coins today.",
      "games.rewardNote": "Earn up to <strong>1,000 Coins</strong> a day from this game.",
      "games.startBtn": "Start",

      /* ---- games: in-game HUD ---- */
      "hud.points": "Points",
      "hud.time": "Time",
      "hud.streak": "Streak",
      "hud.lives": "Lives",
      "hud.dodges": "Dodges",
      "hud.survived": "Survived",
      "hud.diamonds": "Diamonds",
      "hud.height": "Height",
      "hud.ores": "Ores",
      "hud.toGo": "To go",
      "hud.deaths": "Falls",
      "hud.hearts": "Hearts",
      "hud.level": "Level",

      /* ---- games: the five games ---- */
      "game.lava.name": "Lava Run",
      "game.lava.desc": "Climb 100m before the rising lava catches you. Grab diamonds on the way up.",
      "game.lava.howto":
        "Drag left and right to steer — you bounce automatically. Diamond +5 · Checkpoint +15 · Finish +100, plus a point per metre climbed and a bonus for a fast time. The rail on the left shows the finish, you, and the lava.",
      "game.lava.hint": "Drag to steer · 💎 +15 · 🏃 +15 · 🏆 +100",

      "game.breaker.name": "Block Breaker",
      "game.breaker.desc": "Break only the block shown at the top. Four levels, ten blocks each, and the grid keeps growing.",
      "game.breaker.howto":
        "Break ten of the target block to clear a level. Later levels are worth more, and clearing all four pays the maximum. A wrong block costs you a second off the clock.",
      "game.breaker.hint": "10 blocks a level · Wrong block = -1 second",
      "game.breaker.target": "BREAK",
      "game.breaker.penalty": "-1s",

      "game.dodge.name": "Wind Charge Dodge",
      "game.dodge.desc": "Dodge the wind charges, grab emeralds, survive as long as you can.",
      "game.dodge.howto":
        "Drag to move (or use the arrow keys). Grazing a wind charge pays +2 and emeralds are +5. One hit ends the run.",
      "game.dodge.hint": "Drag to move · Close dodge +2 · Emerald +5",

      "game.rush.name": "Diamond Rush",
      "game.rush.desc": "Thirty seconds to mine as much value as you can. One tap on TNT and it's over.",
      "game.rush.howto":
        "Coal +1 · Iron +2 · Gold +4 · Diamond +8 · Emerald +12. TNT ends the run on the spot, and the seam reshuffles faster and faster — so look before you swing.",
      "game.rush.hint": "Coal +1 · Iron +2 · Gold +4 · Diamond +8 · Emerald +12 · TNT = over",
      "game.rush.rubble": "Rubble",

      "game.tnt.name": "TNT Escape",
      "game.tnt.desc": "Survive 45 seconds in an arena raining TNT. Keep moving.",
      "game.tnt.howto":
        "Drag to move (or use the arrow keys). Each TNT shows its blast circle before it goes off — stay out of it. Standing just outside pays +5, and you get +3 for every second alive.",
      "game.tnt.hint": "Drag to move · Stay out of the red · Close call +5",

      /* ---- games: result screen ---- */
      "result.headline": "Nice run!",
      "result.coinsEarned": "Coins earned",
      "result.playAgain": "Play Again",
      "result.backToGames": "← Back to games",
      "result.saveFailed": "Couldn't reach the server, so this round's coins weren't saved.",
      "result.height": "Height climbed",
      "result.diamonds": "Diamonds",
      "result.checkpoints": "Checkpoints",
      "result.runTime": "Time",
      "result.outcome": "Result",
      "result.deaths": "Falls",
      "result.finished": "🏆 Reached the finish!",
      "result.perfectRun": "✨ Perfect run — no falls!",
      "result.burned": "🌋 Caught by the lava",
      "result.gaveUp": "⏱️ Ran out of time",
      "result.outOfHearts": "💔 Out of hearts",
      "result.blownUp": "💥 Blown up",
      "result.survivedAll": "🏆 Survived to the end!",
      "result.timeUp": "⏱️ Time's up",
      "result.allCleared": "🏆 All four levels cleared!",
      "result.levelsCleared": "Levels cleared",
      "result.blocksBroken": "Blocks broken",
      "result.wrongBlocks": "Wrong blocks",
      "result.timeLost": "Time lost",
      "result.survived": "Survived",
      "result.dodges": "Close dodges",
      "result.emeralds": "Emeralds",
      "result.oresMined": "Ores mined",
      "result.gems": "Diamonds & Emeralds",
      "result.bestFind": "Best find",

      /* ---- block names (kept in English on purpose) ---- */
      "block.grass": "Grass Block",
      "block.stone": "Stone",
      "block.dirt": "Dirt",
      "block.planks": "Planks",
      "block.gold": "Gold Block",
      "block.diamond": "Diamond",
      "block.redstone": "Redstone",
      "block.lapis": "Lapis",
      "block.emerald": "Emerald",
      "block.obsidian": "Obsidian",
      "block.sand": "Sand",

      /* ---- ore names for Diamond Rush (English on purpose too) ---- */
      "ore.stone": "Stone",
      "ore.coal": "Coal",
      "ore.iron": "Iron",
      "ore.gold": "Gold",
      "ore.diamond": "Diamond",
      "ore.emerald": "Emerald",
      "ore.tnt": "TNT",
    },

    km: {
      /* ---- nav / chrome ---- */
      "nav.home": "🏠 ទំព័រដើម",
      "nav.games": "🎮 ហ្គេម",
      "nav.store": "💰 ហាង",
      "nav.map": "🗺️ ផែនទី",
      "nav.banned": "🚫 Banned",
      "nav.menu": "ម៉ឺនុយ",
      "nav.language": "ភាសា",
      "footer.copy": "© {year} AngkorSMP · Minecraft Server កម្ពុជា 🇰🇭",

      /* ---- home ---- */
      "home.telegram": "Telegram",
      "home.telegramSub": "ចូលរួមសហគមន៍យើង",
      "home.copyIp": "ចុចដើម្បីចម្លង IP",
      "home.tapJoin": "ចុចដើម្បីចូល (Bedrock)",
      "home.store": "ហាង",
      "home.storeSub": "Ranks, Coins និងច្រើនទៀត",
      "home.checking": "កំពុងពិនិត្យស្ថានភាព Server…",
      "home.online": "Online — អ្នកលេង {online}/{max} នាក់",
      "home.offline": "Server Offline",
      "home.statusUnavailable": "មិនអាចពិនិត្យស្ថានភាពបានទេ",
      "home.welcome": "🌿 សូមស្វាគមន៍ 🌿",
      "home.released": "ចេញផ្សាយ",
      "home.serverAge": "អាយុ Server",
      "home.currentSeason": "Season បច្ចុប្បន្ន",
      "home.seasonAge": "អាយុ Season",
      "home.copied": 'បានចម្លង "{ip}" — សូមដាក់ក្នុង Minecraft > Multiplayer > Add Server',
      "home.opening": "កំពុងបើក Minecraft (Bedrock)… IP Java ក៏បានចម្លងទុកដែរ!",

      /* ---- store ---- */
      "store.subtitle": "ហាង",
      "store.gateTitle": "ទិញសម្រាប់អ្នកណា?",
      "store.gateHint":
        "បញ្ចូលឈ្មោះ Minecraft តែម្តងគត់ ដើម្បីយើងដឹងថាត្រូវផ្ញើទំនិញទៅណា — ហើយអាចបង្ហាញ Rank និង Coins បច្ចុប្បន្នរបស់អ្នក។",
      "store.unavailableTitle": "មិនអាចប្រើបានទេ",
      "store.unavailableBody":
        "ហាងប្រហែលជានៅក្នុងការជួសជុល ឬបិទជាបណ្តោះអាសន្ន។ សូមមកមើលម្តងទៀតពេលក្រោយ ឬទាក់ទង Support បើនៅតែមានបញ្ហា។",
      "store.loggedInAs": "ចូលជា",
      "store.noRank": "មិនទាន់មាន Rank",
      "store.upgradeNow": "ដំឡើងឥឡូវ",
      "store.currentRank": "Rank បច្ចុប្បន្នរបស់អ្នក",
      "store.lowerRank": "នេះជា Rank ទាបជាង",
      "store.alreadyOwned": "អ្នកមានរួចហើយ",
      "store.upRank": "ដំឡើង Rank",
      "store.upRankChoose": "ជ្រើសរើស Rank ដើម្បីដំឡើងពី",
      "store.upgradeSummary": "ដំឡើងពី {from} → {to}",
      "store.upgradeCaption": "អ្នកកំពុងដំឡើងពី {from} ទៅ {to}",
      "store.confirmName": "ឈ្មោះ",
      "store.confirmPlatform": "Platform",
      "store.confirm": "បញ្ជាក់",
      "store.cancel": "បោះបង់",
      "store.changeHint":
        "នេះជាឈ្មោះដែលទំនិញនឹងផ្ញើទៅ និងជាគណនីដែលរក្សាទុក Coins និងពិន្ទុរបស់អ្នក។",
      "store.tab.ranks": "Ranks",
      "store.tab.coins": "Coins",
      "store.tab.other": "ផ្សេងៗ",
      "store.empty": "មិនទាន់មានទំនិញនៅទីនេះទេ — សូមមកមើលម្តងទៀតឆាប់ៗ!",
      "store.comingSoon": "ឆាប់ៗនេះ",
      "store.buyNow": "ទិញឥឡូវ",
      "store.infoTitle": "ព័ត៌មានទំនិញ និងវីដេអូ Kit",
      "buy.title": "ទិញ៖ {item}",
      "buy.username": "ឈ្មោះ Minecraft",
      "buy.edition": "Edition",
      "buy.java": "Java",
      "buy.bedrock": "Bedrock",
      "buy.inServerName": "ឈ្មោះក្នុង Server៖ {name}",
      "buy.continue": "បន្ត",
      "buy.wait": "សូមរង់ចាំ…",
      "buy.invalidJava": "សូមបញ្ចូលឈ្មោះ Java ត្រឹមត្រូវ (អក្សរ លេខ ឬ underscore)។",
      "buy.invalidBedrock": "សូមបញ្ចូល Bedrock gamertag ត្រឹមត្រូវ (អក្សរ លេខ ចន្លោះ ឬ underscore)។",

      /* ---- checkout ---- */
      "checkout.title": "🌿 បញ្ចប់ការទិញរបស់អ្នក 🌿",
      "checkout.loading": "កំពុងផ្ទុកការបញ្ជាទិញ…",
      "checkout.inServerName": "ឈ្មោះក្នុង Server",
      "checkout.edition": "Edition",
      "checkout.total": "សរុប",
      "checkout.step1": "១. ស្កេនដើម្បីបង់ប្រាក់",
      "checkout.scanHint": "ស្កេន KHQR នេះជាមួយ App ធនាគារកម្ពុជាណាមួយ ហើយបង់ឲ្យត្រូវ {amount}។",
      "checkout.saveKhqr": "💾 រក្សាទុក KHQR",
      "checkout.saveHint": "រក្សាទុករូបភាព រួចស្កេនពី Gallery ក្នុង App ធនាគាររបស់អ្នក។",
      "checkout.step2": "២. បញ្ចូលរូបថតអេក្រង់នៃការបង់ប្រាក់",
      "checkout.uploadHint": "បន្ទាប់ពីបង់ប្រាក់រួច សូមភ្ជាប់រូបថតអេក្រង់នៃបង្កាន់ដៃ ដើម្បីឲ្យយើងផ្ទៀងផ្ទាត់។",
      "checkout.dropText": "ចុចដើម្បីជ្រើសរូបថតអេក្រង់ ឬអូសរូបមកទីនេះ",
      "checkout.submit": "ដាក់ស្នើ",
      "checkout.submitNote": "សូមភ្ជាប់បង្កាន់ដៃជាមុនសិន ទើបអាចដាក់ស្នើបាន។",
      "checkout.ready": "រួចរាល់ដើម្បីដាក់ស្នើ។",
      "checkout.submitting": "កំពុងដាក់ស្នើ…",
      "checkout.sending": "កំពុងផ្ញើបង្កាន់ដៃរបស់អ្នក…",
      "checkout.retry": "មានបញ្ហាបន្តិច — សូមព្យាយាមម្តងទៀត។",
      "checkout.trouble": "មានបញ្ហាមែនទេ?",
      "checkout.contactSupport": "ទាក់ទង Support តាម Telegram",
      "checkout.notImage": "សូមជ្រើសរើសឯកសាររូបភាព (រូបថតអេក្រង់នៃបង្កាន់ដៃ)។",
      "checkout.tooBig": "រូបភាពនេះធំជាង ៨ MB — សូមប្រើរូបតូចជាងនេះ។",
      "checkout.noOrder": "គ្មានការបញ្ជាទិញត្រូវបានបញ្ជាក់ទេ។",
      "checkout.backToStore": "ត្រឡប់ទៅហាង",
      "checkout.loadFailed": "មិនអាចផ្ទុកការបញ្ជាទិញនោះបានទេ ({error})។",
      "checkout.khqrMissing": "រូប KHQR មិនទាន់បានដាក់ទេ — សូមដាក់នៅ public/images/site/khqr.png",

      /* ---- success ---- */
      "success.title": "ដាក់ស្នើបានជោគជ័យ!",
      "success.body":
        "អរគុណ! បង្កាន់ដៃរបស់អ្នកត្រូវបានផ្ញើទៅម្ចាស់ Server ដើម្បីពិនិត្យ។ សូមរង់ចាំការបញ្ជាក់ — ជាធម្មតាទំនិញនឹងដល់ក្នុងហ្គេមក្នុងរយៈពេលប៉ុន្មាននាទី។",
      "success.item": "ទំនិញ",
      "success.amount": "ចំនួនទឹកប្រាក់",
      "success.orderId": "លេខបញ្ជាទិញ",
      "success.supportLine": "មិនទាន់ទទួលបានទំនិញក្រោយមួយម៉ោង? សូមទាក់ទង Support។",
      "success.supportLineLink": "មិនទាន់ទទួលបានទំនិញក្រោយមួយម៉ោង?",
      "success.back": "ត្រឡប់ទៅទំព័រដើម",

      /* ---- map ---- */
      "map.title": "🌿 ផែនទីកម្ពុជា 🌿",
      "map.subtitle": "ផែនទីបន្តផ្ទាល់",
      "map.age": "អាយុផែនទី៖ {age}",
      "map.explain": "រុករក AngkorSMP ជាក់ស្តែង។ មើលមិនឃើញនៅខាងក្រោមមែនទេ?",
      "map.openNew": "បើកផែនទីក្នុង Tab ថ្មី ↗",
      "map.fallback": "ផែនទី Live មិនអាចបង្ហាញនៅទីនេះបានទេ។",
      "map.openBluemap": "បើក BlueMap ក្នុង Tab ថ្មី",
      "map.notConfigured":
        'ផែនទី Live មិនទាន់បានកំណត់ទេ។ សូមដាក់ "bluemapUrl" ក្នុង website/config/site.config.json ជា URL BlueMap របស់អ្នក។',

      /* ---- banned players ---- */
      "banned.title": "🌿 អ្នកលេងដែលត្រូវ Ban 🌿",
      "banned.subtitle": "BANNED",
      "banned.hint": "អ្នកលេងដែលកំពុងត្រូវ Ban បច្ចុប្បន្ន បង្ហាញថ្មីៗបំផុតមុន។",
      "banned.unavailable": "⚠️ បញ្ជី Ban មិនអាចប្រើបានពេលនេះទេ។ សូមទាក់ទង Support សម្រាប់ព័ត៌មានបន្ថែម។",
      "banned.empty": "គ្មានអ្នកលេងណាកំពុងត្រូវ Ban ទេពេលនេះ។ 🎉",
      "banned.colPlayer": "អ្នកលេង",
      "banned.colReason": "មូលហេតុ",
      "banned.colBannedBy": "Ban ដោយ",
      "banned.colDate": "កាលបរិច្ឆេទ",
      "banned.colExpires": "ផុតកំណត់",
      "banned.permanent": "ជាអចិន្ត្រៃយ៍",
      "banned.noReason": "មិនមានមូលហេតុ",

      /* ---- games: gate + hub ---- */
      "games.subtitle": "ហ្គេម",
      "games.verify": "ផ្ទៀងផ្ទាត់",
      "games.coins": "Coins",
      "games.topPoints": "ពិន្ទុខ្ពស់បំផុត",
      "games.viewFull": "មើលទាំងអស់",
      "games.earnedToday": "រកបាន {earned}/{cap} ថ្ងៃនេះ",
      "games.playsLeft": "នៅសល់ {left} ក្នុងចំណោម {cap} ដងថ្ងៃនេះ",
      "games.noPlaysLeft": "អស់ចំនួនលេងថ្ងៃនេះ",
      "games.noPlaysLeftToast": "អ្នកបានលេងហ្គេមនេះគ្រប់ ៣ ដងហើយថ្ងៃនេះ។ សូមត្រឡប់មកវិញក្រោយពេលកំណត់ឡើងវិញ។",
      "games.cannotStart": "មិនអាចចាប់ផ្តើមជុំនេះបានទេ",
      "games.go": "ចាប់ផ្តើម!",

      "games.gateTitle": "លេង ហើយរក Coins",
      "games.gateHint":
        "លេងហ្គេមតូចៗនៅលើ Website នេះ ហើយរក Angkor Coins សម្រាប់ Balance ក្នុងហ្គេម។ បញ្ចូលឈ្មោះ Minecraft តែម្តងគត់ — យើងនឹងចាំវាទុក។",
      "games.unavailableTitle": "មិនអាចប្រើបានទេ",
      "games.unavailableBody":
        "ហ្គេមប្រហែលជានៅក្នុងការជួសជុល ឬបិទជាបណ្តោះអាសន្ន។ សូមមកមើលម្តងទៀតពេលក្រោយ ឬទាក់ទង Support បើនៅតែមានបញ្ហា។",
      "games.coinsUnavailable": "មិនអាចប្រើបានទេ",
      "games.coinBannerText": "⚠️ Coins នឹងមិនចូលទេពេលនេះ — ប្រព័ន្ធ Coins កំពុងមិនដំណើរការ។ សូមទាក់ទង Support សម្រាប់ព័ត៌មានបន្ថែម។",
      "games.start": "ចាប់ផ្តើមលេង",
      "games.disclaimer":
        "ឈ្មោះរបស់អ្នកត្រូវបានរក្សាទុកលើឧបករណ៍នេះ ដូច្នេះបញ្ចូលតែម្តងគត់។ Coins និងពិន្ទុរក្សាទុកនៅលើ Server។",
      "games.playingAs": "កំពុងលេងជា",
      "games.changeName": "ប្តូរឈ្មោះ",
      "games.changeLocked": "ឈ្មោះជាប់សោ · នៅសល់ {time}",
      "games.changeTitle": "ប្តូរឈ្មោះរបស់អ្នក",
      "games.changeHint":
        "ឈ្មោះរបស់អ្នកជាកន្លែងរក្សាទុក Coins និងពិន្ទុ ដូច្នេះអាចប្តូរបានតែម្តងក្នុងមួយថ្ងៃ។",
      "games.changeConfirm": "រក្សាទុកឈ្មោះថ្មី",
      "games.changeCancel": "បោះបង់",
      "games.nameSaved": "ឈ្មោះរបស់អ្នកឥឡូវគឺ {name}។",
      "games.nameLockedToast": "អ្នកអាចប្តូរឈ្មោះម្តងទៀតក្នុងរយៈពេល {time}។",
      "games.welcomeBack": "សូមស្វាគមន៍ការត្រឡប់មកវិញ {name}!",
      "games.points": "ពិន្ទុ",
      "games.pointsSub": "ជុំក្នុងវគ្គនេះ",
      "games.coinsToday": "Coins ថ្ងៃនេះ",
      "games.dailyLimit": "ក្នុងចំណោម {cap} ក្នុងមួយថ្ងៃ",
      "games.resetsIn": "កំណត់ឡើងវិញក្នុង {time}",
      "games.leaderboard": "តារាងពិន្ទុ",
      "games.leaderboardOpen": "បើកតារាងពិន្ទុ",
      "games.leaderboardTitle": "🏆 តារាងពិន្ទុ",
      "games.leaderboardSub": "អ្នកលេង ៥០ នាក់ខ្ពស់បំផុតតាមពិន្ទុសរុប។",
      "games.leaderboardEmpty": "មិនទាន់មានពិន្ទុទេ — លេងមួយជុំ ហើយឈរលេខ ១!",
      "games.leaderboardYou": "អ្នក",
      "games.leaderboardRank": "#",
      "games.leaderboardPlayer": "អ្នកលេង",
      "games.leaderboardPoints": "ពិន្ទុ",
      "games.leaderboardYourRank": "ចំណាត់ថ្នាក់៖ #{rank} · {points} ពិន្ទុ",
      "games.leaderboardUnranked": "លេងមួយជុំដើម្បីចូលក្នុងតារាងពិន្ទុ។",
      "games.listHeading": "ហ្គេមតូចៗ",
      "games.listHint":
        "លេងបាន ៣ ដងក្នុងមួយហ្គេមក្នុងមួយថ្ងៃ, ១–៧៥ Coins ក្នុងមួយដង, រហូតដល់ ១.០០០ Coins ក្នុងមួយថ្ងៃ។ កំណត់ឡើងវិញនៅពាក់កណ្តាលអធ្រាត្រ (UTC+7)។",
      "games.play": "លេង",
      "games.todaysReward": "រង្វាន់ថ្ងៃនេះ៖ {earned} / {cap} Coins",
      "games.dailyComplete": "រង្វាន់ប្រចាំថ្ងៃពេញហើយ!",
      "games.dailyCompleteFull": "រង្វាន់ប្រចាំថ្ងៃពេញហើយ! {cap} / {cap} Coins",
      "games.dailyCompleteNote": "អ្នកអាចបន្តលេងកម្សាន្តបាន ប៉ុន្តែនឹងមិនរក Coins បន្ថែមទៀតថ្ងៃនេះទេ។",
      "games.rewardNote": "រកបានរហូតដល់ <strong>១.០០០ Coins</strong> ក្នុងមួយថ្ងៃពីហ្គេមនេះ។",
      "games.startBtn": "ចាប់ផ្តើម",

      /* ---- games: in-game HUD ---- */
      "hud.points": "ពិន្ទុ",
      "hud.time": "ពេលវេលា",
      "hud.streak": "Streak",
      "hud.lives": "ជីវិត",
      "hud.dodges": "គេចបាន",
      "hud.survived": "រស់បាន",
      "hud.diamonds": "Diamonds",
      "hud.height": "កម្ពស់",
      "hud.ores": "រ៉ែ",
      "hud.toGo": "នៅសល់",
      "hud.deaths": "ធ្លាក់",
      "hud.hearts": "ជីវិត",
      "hud.level": "កម្រិត",

      /* ---- games: the five games ---- */
      "game.lava.name": "Lava Run",
      "game.lava.desc": "ឡើងឲ្យបាន ១០០ម មុនពេល Lava ឡើងមកដល់។ ប្រមូល Diamond តាមផ្លូវ។",
      "game.lava.howto":
        "អូសទៅឆ្វេង-ស្តាំដើម្បីបញ្ជា — តួអង្គលោតដោយស្វ័យប្រវត្តិ។ Diamond +5 · Checkpoint +15 · ដល់គោល +100 បូកមួយពិន្ទុរាល់មួយម៉ែត្រ និងរង្វាន់បន្ថែមបើលឿន។ របារខាងឆ្វេងបង្ហាញគោល ទីតាំងអ្នក និង Lava។",
      "game.lava.hint": "អូសដើម្បីបញ្ជា · 💎 +15 · 🏃 +15 · 🏆 +100",

      "game.breaker.name": "Block Breaker",
      "game.breaker.desc": "ទម្លាយតែ Block ដែលបង្ហាញនៅខាងលើ។ ៤ កម្រិត កម្រិតនីមួយៗ ១០ Block។",
      "game.breaker.howto":
        "ទម្លាយ Block គោលដៅ ១០ ដងដើម្បីឆ្លងកម្រិត។ កម្រិតខ្ពស់ផ្តល់ពិន្ទុច្រើនជាង ហើយឆ្លងគ្រប់ ៤ កម្រិតបានរង្វាន់ពេញ។ Block ខុសកាត់ពេល ១ វិនាទី។",
      "game.breaker.hint": "១០ Block ក្នុងមួយកម្រិត · Block ខុស = -1 វិនាទី",
      "game.breaker.target": "ទម្លាយ",
      "game.breaker.penalty": "-1វិ",

      "game.dodge.name": "Wind Charge Dodge",
      "game.dodge.desc": "គេច Wind Charge ប្រមូល Emerald ហើយរស់ឲ្យបានយូរបំផុត។",
      "game.dodge.howto":
        "អូសដើម្បីផ្លាស់ទី (ឬប្រើគ្រាប់ចុចព្រួញ)។ គេចជិត Wind Charge បាន +2 និង Emerald បាន +5។ ប៉ះម្តងគឺចប់។",
      "game.dodge.hint": "អូសដើម្បីផ្លាស់ទី · គេចជិត +2 · Emerald +5",

      "game.rush.name": "Diamond Rush",
      "game.rush.desc": "៣០ វិនាទីដើម្បីជីករករ៉ែឲ្យបានតម្លៃច្រើនបំផុត។ ចុច TNT ម្តងគឺចប់។",
      "game.rush.howto":
        "Coal +1 · Iron +2 · Gold +4 · Diamond +8 · Emerald +12។ TNT បញ្ចប់ជុំភ្លាម ហើយរ៉ែផ្លាស់ទីកាន់តែញឹកញាប់ — មើលឲ្យច្បាស់មុនចុច។",
      "game.rush.hint": "Coal +1 · Iron +2 · Gold +4 · Diamond +8 · Emerald +12 · TNT = ចប់",
      "game.rush.rubble": "ថ្ម",

      "game.tnt.name": "TNT Escape",
      "game.tnt.desc": "រស់ឲ្យបាន ៤៥ វិនាទីក្នុងទីលានដែលមាន TNT ធ្លាក់។ កុំឈប់ផ្លាស់ទី។",
      "game.tnt.howto":
        "អូសដើម្បីផ្លាស់ទី (ឬប្រើគ្រាប់ចុចព្រួញ)។ TNT នីមួយៗបង្ហាញរង្វង់ផ្ទុះមុនពេលផ្ទុះ — កុំនៅក្នុងវា។ ឈរជិតៗខាងក្រៅបាន +5 ហើយបាន +3 រាល់មួយវិនាទីដែលរស់។",
      "game.tnt.hint": "អូសដើម្បីផ្លាស់ទី · ចេញពីរង្វង់ក្រហម · គេចជិត +5",

      /* ---- games: result screen ---- */
      "result.headline": "លេងបានល្អ!",
      "result.coinsEarned": "Coins ដែលរកបាន",
      "result.playAgain": "លេងម្តងទៀត",
      "result.backToGames": "← ត្រឡប់ទៅហ្គេម",
      "result.saveFailed": "មិនអាចភ្ជាប់ទៅ Server បានទេ ដូច្នេះ Coins វគ្គនេះមិនបានរក្សាទុកឡើយ។",
      "result.height": "កម្ពស់ដែលឡើងបាន",
      "result.diamonds": "Diamonds",
      "result.checkpoints": "Checkpoints",
      "result.runTime": "រយៈពេល",
      "result.outcome": "លទ្ធផល",
      "result.deaths": "ចំនួនធ្លាក់",
      "result.finished": "🏆 ដល់គោលហើយ!",
      "result.perfectRun": "✨ ល្អឥតខ្ចោះ — មិនធ្លាក់សោះ!",
      "result.burned": "🌋 ត្រូវ Lava ចាប់បាន",
      "result.gaveUp": "⏱️ អស់ពេល",
      "result.outOfHearts": "💔 អស់ជីវិត",
      "result.blownUp": "💥 ត្រូវផ្ទុះ",
      "result.survivedAll": "🏆 រស់រហូតដល់ចប់!",
      "result.timeUp": "⏱️ អស់ពេលហើយ",
      "result.allCleared": "🏆 ឆ្លងគ្រប់ ៤ កម្រិត!",
      "result.levelsCleared": "កម្រិតដែលឆ្លងបាន",
      "result.blocksBroken": "Block ដែលទម្លាយបាន",
      "result.wrongBlocks": "Block ខុស",
      "result.timeLost": "ពេលដែលបាត់",
      "result.survived": "រស់បាន",
      "result.dodges": "គេចជិត",
      "result.emeralds": "Emeralds",
      "result.oresMined": "រ៉ែដែលជីកបាន",
      "result.gems": "Diamond និង Emerald",
      "result.bestFind": "រកឃើញល្អបំផុត",

      /* ---- block and ore names stay in English ---- */
      "block.grass": "Grass Block",
      "block.stone": "Stone",
      "block.dirt": "Dirt",
      "block.planks": "Planks",
      "block.gold": "Gold Block",
      "block.diamond": "Diamond",
      "block.redstone": "Redstone",
      "block.lapis": "Lapis",
      "block.emerald": "Emerald",
      "block.obsidian": "Obsidian",
      "block.sand": "Sand",
      "ore.stone": "Stone",
      "ore.coal": "Coal",
      "ore.iron": "Iron",
      "ore.gold": "Gold",
      "ore.diamond": "Diamond",
      "ore.emerald": "Emerald",
      "ore.tnt": "TNT",
    },
  };

  function stored() {
    try {
      const value = localStorage.getItem(LANG_KEY);
      return value === "km" || value === "en" ? value : null;
    } catch {
      return null;
    }
  }

  let lang = stored() || "en"; // English is the default, as asked

  function translate(key, vars) {
    const table = DICT[lang] || DICT.en;
    let text = table[key];
    if (text == null) text = DICT.en[key];
    if (text == null) return key;
    // {year} is always available so the footer needs no wiring.
    const merged = Object.assign({ year: new Date().getFullYear() }, vars || {});
    for (const [name, value] of Object.entries(merged)) {
      text = text.split(`{${name}}`).join(String(value));
    }
    return text;
  }

  /* Money. Khmer readers get the riel equivalent alongside the dollar
     amount (1 USD = 4,000 riel) — the amount actually charged is still USD. */
  function formatUsd(amount) {
    return `$${Number(amount || 0).toFixed(2)}`;
  }
  function formatRiel(amount) {
    return `${Math.round(Number(amount || 0) * RIEL_PER_USD).toLocaleString("en-US")}៛`;
  }
  function formatPrice(amount) {
    return lang === "km" ? formatRiel(amount) : formatUsd(amount);
  }

  // Swap every marked string in `root` (defaults to the whole document).
  function apply(root) {
    const scope = root || document;
    scope.querySelectorAll("[data-i18n]").forEach((node) => {
      node.textContent = translate(node.dataset.i18n, readVars(node));
    });
    scope.querySelectorAll("[data-i18n-html]").forEach((node) => {
      node.innerHTML = translate(node.dataset.i18nHtml, readVars(node));
    });
    ["placeholder", "title", "aria-label"].forEach((attr) => {
      const dataAttr = `data-i18n-${attr === "aria-label" ? "aria" : attr}`;
      scope.querySelectorAll(`[${dataAttr}]`).forEach((node) => {
        node.setAttribute(attr, translate(node.getAttribute(dataAttr), readVars(node)));
      });
    });
    if (scope === document) document.documentElement.lang = lang === "km" ? "km" : "en";
  }

  // data-i18n-vars='{"year":"2026"}' for strings with placeholders in markup.
  function readVars(node) {
    const raw = node.getAttribute("data-i18n-vars");
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function syncButtons() {
    document.querySelectorAll(".lang-toggle").forEach((btn) => {
      btn.setAttribute("aria-label", translate("nav.language"));
    });
    document.querySelectorAll(".lang-current").forEach((span) => {
      span.textContent = lang === "km" ? "KH" : "EN";
    });
    document.querySelectorAll(".lang-option").forEach((opt) => {
      opt.classList.toggle("active", opt.dataset.lang === lang);
    });
  }

  function set(next) {
    lang = next === "km" ? "km" : "en";
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      /* private browsing - the choice just won't persist */
    }
    apply();
    syncButtons();
    // Picking a language from the dropdown should close it, same as a nav link.
    document.querySelector(".lang-menu")?.classList.remove("open");
    document.querySelector(".lang-toggle")?.setAttribute("aria-expanded", "false");
    document.dispatchEvent(new CustomEvent("i18n:change", { detail: { lang } }));
  }

  function toggle() {
    set(lang === "km" ? "en" : "km");
  }

  document.addEventListener("DOMContentLoaded", () => {
    apply();
    syncButtons();
  });

  return {
    t: translate,
    apply,
    set,
    toggle,
    formatPrice,
    formatUsd,
    formatRiel,
    RIEL_PER_USD,
    get lang() {
      return lang;
    },
  };
})();

// Short global aliases so page scripts stay readable.
const t = I18n.t;
const formatPrice = I18n.formatPrice;
function setLang(next) {
  I18n.set(next);
}
