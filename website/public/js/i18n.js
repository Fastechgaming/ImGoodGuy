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
      "nav.menu": "Menu",
      "nav.langLabel": "Switch to Khmer",
      "nav.langShort": "KH",
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
      "map.title": "🌿 Cambodia Map — Live BlueMap 🌿",
      "map.age": "Map Age: {age}",
      "map.explain": "Explore AngkorSMP in real time. Having trouble viewing it below?",
      "map.openNew": "Open the map in a new tab ↗",
      "map.fallback": "The live map couldn't be embedded here.",
      "map.openBluemap": "Open BlueMap in a new tab",
      "map.notConfigured":
        'The live map isn\'t configured yet. Set "bluemapUrl" in website/config/site.config.json to your BlueMap URL.',

      /* ---- games: gate + hub ---- */
      "games.subtitle": "GAMES",
      "games.gateTitle": "Play & earn coins",
      "games.gateHint":
        "Play mini-games right here on the website and earn Angkor Coins you can withdraw straight into the server. Enter your Minecraft name to open your play session.",
      "games.start": "Start Playing",
      "games.disclaimer":
        "Coins are counted per day and saved on the server. Withdrawing them into the game opens soon.",
      "games.playingAs": "Playing as",
      "games.changeName": "Change name",
      "games.points": "Points",
      "games.pointsSub": "Rounds this session",
      "games.coinsToday": "Coins Today",
      "games.dailyLimit": "of {cap} daily limit",
      "games.resetsIn": "Resets in {time}",
      "games.withdrawTitle": "Withdraw to in-game",
      "games.withdrawHint":
        "Withdrawing to your in-game balance opens soon — keep playing to build up your coins.",
      "games.withdrawBtn": "Withdraw — Coming Soon",
      "games.listHeading": "Mini-games",
      "games.listHint":
        "Every game is unlimited to play. Each one can pay up to 500 Coins per day — 2,500 Coins across all five. Resets at midnight (UTC+7).",
      "games.play": "Play",
      "games.todaysReward": "Today's Reward: {earned} / {cap} Coins",
      "games.dailyComplete": "Daily Reward Complete!",
      "games.dailyCompleteFull": "Daily Reward Complete! {cap} / {cap} Coins",
      "games.dailyCompleteNote": "You can keep playing for fun, but won't earn more Coins today.",
      "games.rewardNote": "Earn up to <strong>500 Coins</strong> a day from this game.",
      "games.startBtn": "Start",

      /* ---- games: in-game HUD ---- */
      "hud.points": "Points",
      "hud.combo": "Combo",
      "hud.time": "Time",
      "hud.streak": "Streak",
      "hud.lives": "Lives",
      "hud.dodges": "Dodges",
      "hud.survived": "Survived",
      "hud.board": "Board",
      "game.miss": "Miss!",

      /* ---- games: the five games ---- */
      "game.creeper.name": "Creeper Clicker",
      "game.creeper.desc": "Tap creepers before they blow up. Charged and golden ones pay more.",
      "game.creeper.howto":
        "Tap every creeper you see. 5 hits in a row doubles your points — tapping empty ground breaks the combo.",
      "game.creeper.hint": "Normal +1 · Charged +3 · Golden +5",

      "game.breaker.name": "Block Breaker",
      "game.breaker.desc": "Break only the block named at the top. The faster you tap, the more it pays.",
      "game.breaker.howto":
        "The target block is shown above the grid. Break it fast for bonus points — a wrong block costs you 4.",
      "game.breaker.hint": "Right block = points · Wrong block = -4",
      "game.breaker.target": "BREAK",

      "game.dodge.name": "Wind Charge Dodge",
      "game.dodge.desc": "Dodge the wind charges, grab emeralds, survive as long as you can.",
      "game.dodge.howto":
        "Drag to move (or use the arrow keys). Grazing a wind charge pays +2 and emeralds are +10. One hit ends the run.",
      "game.dodge.hint": "Drag to move · Close dodge +2 · Emerald +10",

      "game.zombie.name": "Zombie Survival",
      "game.zombie.desc": "Tap the mobs before they reach your gate. A Mini Boss is worth 100.",
      "game.zombie.howto":
        "Zombie +5 · Armored +15 (2 hits) · Burning +25 · Mini Boss +100 (5 hits). You have 3 hearts — the run ends when they're gone.",
      "game.zombie.hint": "Zombie +5 · Armored +15 · Burning +25 · Boss +100",
      "game.zombie.hit": "Hit!",

      "game.memory.name": "Minecraft Memory",
      "game.memory.desc": "Flip two cards and match the pair. Every board is bigger than the last.",
      "game.memory.howto":
        "Match a pair quickly for a speed bonus. A wrong pair costs a heart — the run ends when all 5 are gone.",
      "game.memory.hint": "Fast matches score more · Wrong pair = -1 ❤️",

      /* ---- games: result screen ---- */
      "result.headline": "Nice run!",
      "result.coinsEarned": "Coins earned",
      "result.playAgain": "Play Again",
      "result.backToGames": "← Back to games",
      "result.capped": "The daily limit topped you up to {cap} Coins for this game.",
      "result.saveFailed": "Couldn't reach the server, so this round's coins weren't saved.",
      "result.creepersPopped": "Creepers popped",
      "result.bestCombo": "Best combo",
      "result.missed": "Missed",
      "result.blocksBroken": "Blocks broken",
      "result.wrongBlocks": "Wrong blocks",
      "result.bestStreak": "Best streak",
      "result.survived": "Survived",
      "result.dodges": "Close dodges",
      "result.emeralds": "Emeralds",
      "result.mobsKilled": "Mobs killed",
      "result.bossesKilled": "Mini bosses",
      "result.boardsCleared": "Boards cleared",
      "result.pairsFound": "Pairs found",
      "result.mistakes": "Mistakes",

      /* ---- block names (kept in English on purpose) ---- */
      "block.grass": "Grass Block",
      "block.stone": "Stone",
      "block.dirt": "Dirt",
      "block.gold": "Gold Block",
      "block.diamond": "Diamond",
      "block.redstone": "Redstone",
      "block.lapis": "Lapis",
      "block.emerald": "Emerald",
      "block.obsidian": "Obsidian",
      "block.sand": "Sand",
    },

    km: {
      /* ---- nav / chrome ---- */
      "nav.home": "🏠 ទំព័រដើម",
      "nav.games": "🎮 ហ្គេម",
      "nav.store": "💰 ហាង",
      "nav.map": "🗺️ ផែនទី",
      "nav.menu": "ម៉ឺនុយ",
      "nav.langLabel": "ប្តូរទៅភាសាអង់គ្លេស",
      "nav.langShort": "EN",
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
      "map.title": "🌿 ផែនទីកម្ពុជា — Live BlueMap 🌿",
      "map.age": "អាយុផែនទី៖ {age}",
      "map.explain": "រុករក AngkorSMP ជាក់ស្តែង។ មើលមិនឃើញនៅខាងក្រោមមែនទេ?",
      "map.openNew": "បើកផែនទីក្នុង Tab ថ្មី ↗",
      "map.fallback": "ផែនទី Live មិនអាចបង្ហាញនៅទីនេះបានទេ។",
      "map.openBluemap": "បើក BlueMap ក្នុង Tab ថ្មី",
      "map.notConfigured":
        'ផែនទី Live មិនទាន់បានកំណត់ទេ។ សូមដាក់ "bluemapUrl" ក្នុង website/config/site.config.json ជា URL BlueMap របស់អ្នក។',

      /* ---- games: gate + hub ---- */
      "games.subtitle": "ហ្គេម",
      "games.gateTitle": "លេង ហើយរក Coins",
      "games.gateHint":
        "លេងហ្គេមតូចៗនៅលើ Website នេះ ហើយរក Angkor Coins ដែលអ្នកអាចដកចូលក្នុង Server បាន។ បញ្ចូលឈ្មោះ Minecraft របស់អ្នកដើម្បីចាប់ផ្តើម។",
      "games.start": "ចាប់ផ្តើមលេង",
      "games.disclaimer":
        "Coins ត្រូវបានរាប់ជារៀងរាល់ថ្ងៃ ហើយរក្សាទុកនៅលើ Server។ ការដកចូលក្នុងហ្គេមនឹងបើកឆាប់ៗនេះ។",
      "games.playingAs": "កំពុងលេងជា",
      "games.changeName": "ប្តូរឈ្មោះ",
      "games.points": "ពិន្ទុ",
      "games.pointsSub": "ជុំក្នុងវគ្គនេះ",
      "games.coinsToday": "Coins ថ្ងៃនេះ",
      "games.dailyLimit": "ក្នុងចំណោម {cap} ក្នុងមួយថ្ងៃ",
      "games.resetsIn": "កំណត់ឡើងវិញក្នុង {time}",
      "games.withdrawTitle": "ដក Coins ចូលក្នុងហ្គេម",
      "games.withdrawHint": "ការដកចូលក្នុងហ្គេមនឹងបើកឆាប់ៗនេះ — សូមបន្តលេងដើម្បីប្រមូល Coins។",
      "games.withdrawBtn": "ដក — ឆាប់ៗនេះ",
      "games.listHeading": "ហ្គេមតូចៗ",
      "games.listHint":
        "គ្រប់ហ្គេមអាចលេងបានគ្មានកំណត់។ ហ្គេមនីមួយៗអាចរកបានរហូតដល់ ៥០០ Coins ក្នុងមួយថ្ងៃ — សរុប ២,៥០០ Coins។ កំណត់ឡើងវិញនៅពាក់កណ្តាលអធ្រាត្រ (UTC+7)។",
      "games.play": "លេង",
      "games.todaysReward": "រង្វាន់ថ្ងៃនេះ៖ {earned} / {cap} Coins",
      "games.dailyComplete": "រង្វាន់ប្រចាំថ្ងៃពេញហើយ!",
      "games.dailyCompleteFull": "រង្វាន់ប្រចាំថ្ងៃពេញហើយ! {cap} / {cap} Coins",
      "games.dailyCompleteNote": "អ្នកអាចបន្តលេងកម្សាន្តបាន ប៉ុន្តែនឹងមិនរក Coins បន្ថែមទៀតថ្ងៃនេះទេ។",
      "games.rewardNote": "រកបានរហូតដល់ <strong>៥០០ Coins</strong> ក្នុងមួយថ្ងៃពីហ្គេមនេះ។",
      "games.startBtn": "ចាប់ផ្តើម",

      /* ---- games: in-game HUD ---- */
      "hud.points": "ពិន្ទុ",
      "hud.combo": "Combo",
      "hud.time": "ពេលវេលា",
      "hud.streak": "Streak",
      "hud.lives": "ជីវិត",
      "hud.dodges": "គេចបាន",
      "hud.survived": "រស់បាន",
      "hud.board": "ក្តារ",
      "game.miss": "ខុស!",

      /* ---- games: the five games ---- */
      "game.creeper.name": "Creeper Clicker",
      "game.creeper.desc": "ចុច Creeper មុនពេលវាផ្ទុះ។ Charged និង Golden ផ្តល់ពិន្ទុច្រើនជាង។",
      "game.creeper.howto":
        "ចុច Creeper គ្រប់គ្រាប់ដែលអ្នកឃើញ។ ចុចត្រូវ ៥ ដងជាប់គ្នា បង្កើនពិន្ទុទ្វេដង — ចុចលើដីទទេនឹងកាត់ Combo។",
      "game.creeper.hint": "Normal +1 · Charged +3 · Golden +5",

      "game.breaker.name": "Block Breaker",
      "game.breaker.desc": "ទម្លាយតែ Block ដែលមានឈ្មោះនៅខាងលើ។ ចុចកាន់តែលឿន ពិន្ទុកាន់តែច្រើន។",
      "game.breaker.howto":
        "Block គោលដៅបង្ហាញនៅខាងលើតារាង។ ចុចវាឲ្យលឿនដើម្បីបានពិន្ទុបន្ថែម — Block ខុសនឹងកាត់ ៤ ពិន្ទុ។",
      "game.breaker.hint": "Block ត្រូវ = ពិន្ទុ · Block ខុស = -4",
      "game.breaker.target": "ទម្លាយ",

      "game.dodge.name": "Wind Charge Dodge",
      "game.dodge.desc": "គេច Wind Charge ប្រមូល Emerald ហើយរស់ឲ្យបានយូរបំផុត។",
      "game.dodge.howto":
        "អូសដើម្បីផ្លាស់ទី (ឬប្រើគ្រាប់ចុចព្រួញ)។ គេចជិត Wind Charge បាន +2 និង Emerald បាន +10។ ប៉ះម្តងគឺចប់។",
      "game.dodge.hint": "អូសដើម្បីផ្លាស់ទី · គេចជិត +2 · Emerald +10",

      "game.zombie.name": "Zombie Survival",
      "game.zombie.desc": "ចុចសត្វមុនពេលវាដល់ទ្វារ។ Mini Boss មានតម្លៃ ១០០ ពិន្ទុ។",
      "game.zombie.howto":
        "Zombie +5 · Armored +15 (២ ដង) · Burning +25 · Mini Boss +100 (៥ ដង)។ អ្នកមាន ៣ បេះដូង — ចប់ពេលអស់។",
      "game.zombie.hint": "Zombie +5 · Armored +15 · Burning +25 · Boss +100",
      "game.zombie.hit": "ត្រូវ!",

      "game.memory.name": "Minecraft Memory",
      "game.memory.desc": "បើកបៀរពីរសន្លឹក ហើយផ្គូផ្គងគូរ។ ក្តារនីមួយៗធំជាងមុន។",
      "game.memory.howto":
        "ផ្គូផ្គងឲ្យលឿនដើម្បីបានពិន្ទុបន្ថែម។ គូខុសនឹងបាត់បេះដូងមួយ — ចប់ពេលអស់ទាំង ៥។",
      "game.memory.hint": "ផ្គូផ្គងលឿនបានពិន្ទុច្រើន · គូខុស = -1 ❤️",

      /* ---- games: result screen ---- */
      "result.headline": "លេងបានល្អ!",
      "result.coinsEarned": "Coins ដែលរកបាន",
      "result.playAgain": "លេងម្តងទៀត",
      "result.backToGames": "← ត្រឡប់ទៅហ្គេម",
      "result.capped": "ដល់កំណត់ប្រចាំថ្ងៃហើយ — បានត្រឹម {cap} Coins សម្រាប់ហ្គេមនេះ។",
      "result.saveFailed": "មិនអាចភ្ជាប់ទៅ Server បានទេ ដូច្នេះ Coins វគ្គនេះមិនបានរក្សាទុកឡើយ។",
      "result.creepersPopped": "Creeper ដែលបំផ្ទុះ",
      "result.bestCombo": "Combo ល្អបំផុត",
      "result.missed": "ខកខាន",
      "result.blocksBroken": "Block ដែលទម្លាយបាន",
      "result.wrongBlocks": "Block ខុស",
      "result.bestStreak": "Streak ល្អបំផុត",
      "result.survived": "រស់បាន",
      "result.dodges": "គេចជិត",
      "result.emeralds": "Emeralds",
      "result.mobsKilled": "សត្វដែលសម្លាប់បាន",
      "result.bossesKilled": "Mini Boss",
      "result.boardsCleared": "ក្តារដែលឆ្លងបាន",
      "result.pairsFound": "គូដែលរកឃើញ",
      "result.mistakes": "កំហុស",

      /* ---- block names stay in English ---- */
      "block.grass": "Grass Block",
      "block.stone": "Stone",
      "block.dirt": "Dirt",
      "block.gold": "Gold Block",
      "block.diamond": "Diamond",
      "block.redstone": "Redstone",
      "block.lapis": "Lapis",
      "block.emerald": "Emerald",
      "block.obsidian": "Obsidian",
      "block.sand": "Sand",
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
    return lang === "km" ? `${formatUsd(amount)} (${formatRiel(amount)})` : formatUsd(amount);
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
      // Show the language you'd switch TO, matching the theme button.
      btn.textContent = translate("nav.langShort");
      btn.setAttribute("aria-label", translate("nav.langLabel"));
      btn.setAttribute("title", translate("nav.langLabel"));
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
function toggleLang() {
  I18n.toggle();
}
