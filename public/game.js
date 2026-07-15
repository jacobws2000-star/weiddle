"use strict";

// Weight-class ordering (light -> heavy). Used for "close" (adjacent) matching
// and up/down arrows. Women's divisions mapped alongside men's by poundage.
const WEIGHT_ORDER = [
  "Strawweight",            // 115
  "Flyweight",              // 125
  "Bantamweight",           // 135
  "Featherweight",          // 145
  "Lightweight",            // 155
  "Welterweight",           // 170
  "Middleweight",           // 185
  "Light Heavyweight",      // 205
  "Heavyweight",            // 265
];
function wcIndex(wc) {
  if (!wc) return -1;
  const clean = wc.replace(/Women's\s+/i, "").trim();
  return WEIGHT_ORDER.indexOf(clean);
}
// Gender is carried by the division name itself — "Women's Bantamweight" vs plain
// "Bantamweight". Every non-prefixed division in the roster is men's, including
// the old Open Weight and Catch Weight entries.
function wcGender(wc) {
  return /Women's/i.test(wc || "") ? "F" : "M";
}

// Nationality -> continent, so "close" nationality = same continent.
// Covers every nationality present in fighters.json (kept in sync with the data).
const CONTINENT = {
  // North America
  "USA":"NA","Canada":"NA","Mexico":"NA","Cuba":"NA","Jamaica":"NA","Haiti":"NA",
  "Dominican Republic":"NA","Puerto Rico":"NA","Panama":"NA","Aruba":"NA","Guam":"NA",
  "El Salvador":"NA",
  // South America
  "Brazil":"SA","Argentina":"SA","Ecuador":"SA","Peru":"SA","Chile":"SA","Suriname":"SA",
  "Venezuela":"SA","Colombia":"SA","Bolivia":"SA","Paraguay":"SA","Guyana":"SA",
  // Europe
  "Russia":"EU","Georgia":"EU","England":"EU","United Kingdom":"EU","Ireland":"EU",
  "Scotland":"EU","Wales":"EU","France":"EU","Germany":"EU","Poland":"EU","Sweden":"EU",
  "Netherlands":"EU","Spain":"EU","Italy":"EU","Czechia":"EU","Croatia":"EU","Serbia":"EU",
  "Norway":"EU","Switzerland":"EU","Moldova":"EU","Ukraine":"EU","Armenia":"EU",
  "Azerbaijan":"EU","Albania":"EU","Austria":"EU","Belarus":"EU","Belgium":"EU",
  "Bosnia & Herzegovina":"EU","Cyprus":"EU","Denmark":"EU","Iceland":"EU","Lithuania":"EU",
  "Luxembourg":"EU","Macedonia":"EU","Portugal":"EU","Romania":"EU","Slovakia":"EU",
  "Türkiye":"EU","Bulgaria":"EU","Hungary":"EU","Finland":"EU",
  // Asia
  "China":"AS","Japan":"AS","South Korea":"AS","Korea":"AS","Kazakhstan":"AS",
  "Philippines":"AS","Thailand":"AS","India":"AS","Mongolia":"AS","Kyrgyzstan":"AS",
  "Uzbekistan":"AS","Tajikistan":"AS","Afghanistan":"AS","Bahrain":"AS","Hong Kong":"AS",
  "Indonesia":"AS","Iraq":"AS","Israel":"AS","Lebanon":"AS","Myanmar":"AS","Palestine":"AS",
  "United Arab Emirates":"AS","Vietnam":"AS","Iran":"AS","Jordan":"AS","Singapore":"AS",
  // Oceania
  "Australia":"OC","New Zealand":"OC","Tonga":"OC","Samoa":"OC",
  // Africa
  "Nigeria":"AF","Cameroon":"AF","South Africa":"AF","Morocco":"AF","Angola":"AF",
  "Congo":"AF","Democratic Republic of Congo":"AF","Egypt":"AF","Ghana":"AF","Niger":"AF",
  "Senegal":"AF","Tunisia":"AF","Uganda":"AF","Zimbabwe":"AF",
};
function continent(nat){ return CONTINENT[nat] || null; }

// Numeric "close" thresholds (|diff| <= threshold and not equal => yellow).
const NUM_CLOSE = { wins:2, losses:2, age:2, height:2, debut:2 };

let DATA = [];
let BORDERS = {};   // nationality -> [bordering nationalities] (from fighters.json)
let target = null;
let guessed = new Set();
let guessCount = 0;
let solved = false;
let startTime = null;
let timerInterval = null;

// Game mode: "classic-normal" | "classic-hard" | "classic-extreme"
//          | "title-normal" | "title-hard" | "title-extreme"
let mode = localStorage.getItem("octagonle_mode") || "classic-normal";
if (mode === "classic") mode = "classic-normal";   // migrate old saved value

// Play style: "infinity" (endless, all modes) | "daily" (one shared seeded puzzle
// per UTC day, one-and-done). Daily offers only Classic-Normal and Moments.
let playStyle = localStorage.getItem("octagonle_playstyle") || "infinity";
let countdownInterval = null;
let DAILY_DATE_OVERRIDE = null;   // test hook; null => real UTC date

// --- Deterministic daily seeding ---
function dailyKey(){ return DAILY_DATE_OVERRIDE || new Date().toISOString().slice(0, 10); }
function hashStr(s){
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a){
  return function(){
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function seededRng(s){ return mulberry32(hashStr(s)); }

// --- Daily state (localStorage) ---
function dailyRecordKey(kind){ return `octagonle_daily_${kind}_${dailyKey()}`; }
function getDailyRecord(kind){ try { return JSON.parse(localStorage.getItem(dailyRecordKey(kind)) || "null"); } catch { return null; } }
function setDailyRecord(kind, rec){ localStorage.setItem(dailyRecordKey(kind), JSON.stringify(rec)); }
function prevDay(key){ const d = new Date(key + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }
// One day-streak shared by both dailies; updated once per day on first completion.
function updateDailyStreak(counts){
  const today = dailyKey();
  if (localStorage.getItem("octagonle_daily_counted") === today) return;
  let streak = parseInt(localStorage.getItem("octagonle_daily_streak") || "0", 10);
  if (counts){
    streak = (localStorage.getItem("octagonle_daily_lastwin") === prevDay(today)) ? streak + 1 : 1;
    localStorage.setItem("octagonle_daily_lastwin", today);
  } else {
    streak = 0;
  }
  localStorage.setItem("octagonle_daily_streak", String(streak));
  localStorage.setItem("octagonle_daily_counted", today);
}

// --- Countdown to next UTC midnight ---
function startCountdown(){
  clearInterval(countdownInterval);
  const tick = () => {
    const now = new Date();
    const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0);
    let ms = Math.max(0, next - now.getTime());
    const h = Math.floor(ms / 3.6e6), m = Math.floor(ms % 3.6e6 / 6e4), s = Math.floor(ms % 6e4 / 1e3);
    const pad = n => String(n).padStart(2, "0");
    el("daily-countdown").textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;
  };
  tick();
  countdownInterval = setInterval(tick, 1000);
}

// Shows the locked "come back tomorrow" panel for whichever daily is active.
function showDailyLocked(){
  const kind = (mode === "moments") ? "moments" : "classic";
  const rec = getDailyRecord(kind) || {};
  const streak = parseInt(localStorage.getItem("octagonle_daily_streak") || "0", 10);
  if (kind === "moments"){
    el("daily-result-title").textContent = "Daily Moments complete";
    el("daily-result-sub").textContent = `You scored ${rec.score} / ${rec.max} today.`;
  } else {
    el("daily-result-title").textContent = rec.won ? "Daily solved! 🎉" : "Daily complete";
    el("daily-result-sub").textContent = rec.won
      ? `Solved in ${rec.guesses} guess${rec.guesses === 1 ? "" : "es"}.`
      : `Out of guesses — it was ${rec.answer}.`;
  }
  el("daily-streak").textContent = String(streak);
  el("daily-panel").classList.remove("hidden");
  startCountdown();
}

// Classic era pools, by a fighter's most recent UFC bout year.
const NORMAL_SINCE = new Date().getFullYear() - 3;  // "last 3 years"
const HARD_SINCE = 2010;
function inClassicPool(f){
  if (mode === "classic-extreme") return true;   // all-time: every fighter in DATA
  const since = mode === "classic-hard" ? HARD_SINCE : NORMAL_SINCE;
  return (f.lastUfcYear || 0) >= since;
}
// Per-mode guess limit. Reaching it (without solving) ends the game.
function maxAttempts(){
  switch (mode){
    case "classic-normal": return 10;
    case "classic-hard":   return 12;
    case "classic-extreme": return 13;
    case "title-normal":   return 5;
    case "title-hard":     return 6;
    case "title-extreme":  return 6;
    default:               return 10;
  }
}

const el = (id) => document.getElementById(id);
const isTitleMode = () =>
  mode === "title-normal" || mode === "title-hard" || mode === "title-extreme";

function ageFromDob(dob){
  if (!dob) return null;
  const d = new Date(dob);
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
  return a;
}

// ---------- Account level (lifetime points -> level) ----------
// Points accrue from wins across every mode (WIN_POINTS + awardWinPoints) and
// from Defining Moments (1 per point earned, via addPoints in moments.js).
// Stored per-browser in localStorage. Level 1 = 0 points; climbs forever.
// Cost to advance FROM a level: L1–5 =100 · L5–20 =200 · L20–50 =450
//   · L50–100 =1000 · L100+ =2000.
const WIN_POINTS = {
  "classic-normal": 10, "classic-hard": 15, "classic-extreme": 20,
  "title-normal":   10, "title-hard":   15, "title-extreme":   15,
  // Moments never reaches awardWinPoints (it has no win/lose path); moments.js
  // scales this base by the share of clues solved.
  "moments":        50,
};
function levelStepCost(level){
  if (level < 5)   return 100;
  if (level < 20)  return 200;
  if (level < 50)  return 450;
  if (level < 100) return 1000;
  return 2000;
}
function getPoints(){ return parseInt(localStorage.getItem("octagonle_points") || "0", 10); }
function levelInfo(points){
  let level = 1, spent = 0;
  while (points - spent >= levelStepCost(level)){ spent += levelStepCost(level); level++; }
  return { level, into: points - spent, need: levelStepCost(level) };
}
function renderLevelBox(){
  const { level, into, need } = levelInfo(getPoints());
  el("level-num").textContent = level;
  el("level-points").textContent = `${into} / ${need}`;
  el("level-bar-fill").style.width = `${Math.round(100 * into / need)}%`;
}
function addPoints(n){
  if (!n || n < 0) return;
  const before = levelInfo(getPoints()).level;
  const points = getPoints() + n;
  localStorage.setItem("octagonle_points", String(points));
  renderLevelBox();
  if (levelInfo(points).level > before){       // brief level-up pulse
    const box = el("level-box");
    box.classList.remove("leveled");
    void box.offsetWidth;                        // restart the CSS animation
    box.classList.add("leveled");
  }
}
// Classic/Title win: base points by mode + an efficiency bonus of 2 per unused
// guess, then a speed boost by how fast it was solved:
//   3 guesses or fewer -> +65%, rounded UP to the nearest point
//   exactly 4 guesses  -> +20%, rounded to the nearest point
// Finally a difficulty boost on the total: Hard +10%, Extreme +15% (both game
// modes). Boosts apply to every Classic/Title mode+difficulty. Defining Moments
// never runs through here, so it is excluded from all boosts by design.
const SPEED_BOOST = 1.65;   // <= 3 guesses -> x1.65 (ceil)
const FAST_BOOST  = 1.20;   // exactly 4 guesses -> x1.20 (round)
const DAILY_BOOST = 10;     // Daily play style -> multiplies all points earned
function difficultyBoost(){
  if (mode.endsWith("-extreme")) return 1.15;   // Extreme -> +15%
  if (mode.endsWith("-hard"))    return 1.10;   // Hard    -> +10%
  return 1;                                      // Normal  -> unchanged
}
function awardWinPoints(){
  const base = WIN_POINTS[mode] || 10;
  const unused = Math.max(0, maxAttempts() - guessCount);
  let pts = base + 2 * unused;
  if (guessCount <= 3)      pts = Math.ceil(pts * SPEED_BOOST);
  else if (guessCount === 4) pts = Math.round(pts * FAST_BOOST);
  pts = Math.round(pts * difficultyBoost());   // Hard +10% / Extreme +15%
  if (playStyle === "daily") pts *= DAILY_BOOST;   // Daily play style
  addPoints(pts);
}

async function load(){
  // no-cache: revalidate on each load so a redeployed dataset shows immediately.
  const res = await fetch("fighters.json", { cache: "no-cache" });
  const json = await res.json();
  DATA = json.fighters.filter(f => f.heightIn && f.debutYear);
  BORDERS = json.borders || {};
  newGame();
}

// Fighters guessable in the current mode: classic restricts to the era pool;
// title modes allow any fighter (the answer is always a champion in DATA).
function guessablePool(){
  return isTitleMode() ? DATA : DATA.filter(inClassicPool);
}
// ---------- Autocomplete ----------
// <datalist> suggestions are unreliable on mobile Safari/Chrome — they often
// never render, which left phone users able to type but unable to pick a
// fighter. This is a custom dropdown that works with touch: it filters as you
// type, uses large tap targets, and you tap a name to choose it. Arrow keys +
// Enter still work for desktop.
function attachAutocomplete(input, getNames, onPick, opts = {}){
  const submitOnEnter = !!opts.submitOnEnter;
  const menu = document.createElement("div");
  menu.className = "ac-menu hidden";
  document.body.appendChild(menu);
  let items = [];
  let active = -1;
  const isOpen = () => !menu.classList.contains("hidden");

  const place = () => {
    const r = input.getBoundingClientRect();
    menu.style.left  = (r.left + window.scrollX) + "px";
    menu.style.top   = (r.bottom + window.scrollY) + "px";
    menu.style.width = r.width + "px";
  };
  const close = () => { menu.classList.add("hidden"); menu.replaceChildren(); items = []; active = -1; };
  const highlight = () => {
    [...menu.children].forEach((c, i) => c.classList.toggle("active", i === active));
    if (active >= 0) menu.children[active].scrollIntoView({ block: "nearest" });
  };
  const render = () => {
    const q = input.value.trim().toLowerCase();
    if (!q){ close(); return; }
    const starts = [], contains = [];
    for (const n of getNames()){
      const low = n.toLowerCase();
      if (low.startsWith(q)) starts.push(n);
      else if (low.includes(q)) contains.push(n);
    }
    items = starts.concat(contains).slice(0, 8);
    if (!items.length){ close(); return; }
    menu.replaceChildren(...items.map(n => {
      const d = document.createElement("div");
      d.className = "ac-item";
      d.textContent = n;
      return d;
    }));
    active = -1;
    place();
    menu.classList.remove("hidden");
  };
  const pick = (i) => {
    if (i < 0 || i >= items.length) return;
    const name = items[i];
    input.value = name;
    close();
    onPick(name);
  };

  input.addEventListener("input", render);
  input.addEventListener("focus", render);
  // Capture phase so we can intercept Enter before other listeners (e.g. the
  // Moments form's submit-on-Enter) whenever a suggestion is highlighted.
  input.addEventListener("keydown", (e) => {
    if (!isOpen()){
      if (e.key === "Enter" && submitOnEnter) onPick(input.value);
      return;
    }
    if (e.key === "ArrowDown"){ e.preventDefault(); active = Math.min(active + 1, items.length - 1); highlight(); }
    else if (e.key === "ArrowUp"){ e.preventDefault(); active = Math.max(active - 1, 0); highlight(); }
    else if (e.key === "Enter"){
      if (active >= 0){ e.preventDefault(); e.stopPropagation(); pick(active); }
      else if (submitOnEnter){ e.preventDefault(); const v = input.value; close(); onPick(v); }
      else close();   // let the host form handle Enter (e.g. Moments submit)
    }
    else if (e.key === "Escape"){ close(); }
  }, true);

  // Tap/click a suggestion. Fire on pointer/mouse *down* + preventDefault so the
  // input doesn't blur (which would close the menu) before the pick registers.
  // Both event types are wired so touch, mouse, and pen all work; after a pick
  // the menu is emptied, so the redundant event is a harmless no-op.
  const onDown = (e) => {
    const item = e.target.closest(".ac-item");
    if (!item) return;
    e.preventDefault();
    pick([...menu.children].indexOf(item));
  };
  menu.addEventListener("pointerdown", onDown);
  menu.addEventListener("mousedown", onDown);

  document.addEventListener("pointerdown", (e) => {
    if (e.target !== input && !menu.contains(e.target)) close();
  });
  window.addEventListener("scroll", () => { if (isOpen()) place(); }, true);
  window.addEventListener("resize", () => { if (isOpen()) place(); });
}

// Target selection is weighted, not uniform, so familiar (higher-win) names and
// champions come up more often.
// Each boost's "effect" (distance from the neutral baseline) was made 50% stronger:
//   win exponent  1.5  -> 1.0 + 0.5*1.5  = 1.75
//   champion      1.25 -> 1.0 + 0.25*1.5 = 1.375
//   top-10        1.75 -> 1.0 + 0.75*1.5 = 2.125
const WIN_EXP = 1.75;       // superlinear bias toward higher win totals
const WIN_CAP = 30;         // wins above this don't add weight (avoid journeymen skew)
const CHAMP_BOOST = 1.375;  // champions (current or former) more likely
const TOP10_BOOST = 2.125;  // top-10 ranked fighters more likely (stacks w/ champ)

// Classic Extreme only: slightly favor earlier-era targets, by UFC debut year.
// The earliest bracket gets a marginally bigger boost.
const ERA_BOOST_EARLY = 1.45;   // debut 1993–2004
const ERA_BOOST_MID   = 1.40;   // debut 2005–2015
function eraBoost(f){
  if (mode !== "classic-extreme") return 1;
  const y = f.debutYear || 0;
  if (y >= 1993 && y <= 2004) return ERA_BOOST_EARLY;
  if (y >= 2005 && y <= 2015) return ERA_BOOST_MID;
  return 1;
}

function fighterWeight(f){
  // floor of 1 so nobody is impossible; cap at WIN_CAP so 40 wins == 30 wins
  const wins = Math.min(Math.max(f.wins || 0, 1), WIN_CAP);
  let w = Math.pow(wins, WIN_EXP);
  if (f.isChampion) w *= CHAMP_BOOST;
  if (f.topTen) w *= TOP10_BOOST;   // stacks: a top-10 champ gets 1.25 * 1.75
  w *= eraBoost(f);                 // Extreme: nudge toward earlier debut years
  return w;
}

// Guess-history boost, Classic + Infinity only: 10% of the time the target is drawn
// uniformly from the fighters guessed in the previous game, instead of the usual
// weighted draw. History is kept per difficulty and holds one game only. The previous
// answer is excluded so a solved fighter doesn't cycle straight back around.
const HISTORY_BOOST = 0.10;
function historyKey(){ return "octagonle_lastguesses_" + mode; }
function getLastGuesses(){
  try {
    const a = JSON.parse(localStorage.getItem(historyKey()) || "[]");
    return Array.isArray(a) ? a : [];
  } catch { return []; }
}
function saveLastGuesses(){
  const names = [...guessed].filter(n => n !== target.name);
  localStorage.setItem(historyKey(), JSON.stringify(names));
}
// Returns null when the boost doesn't fire, or when there's no usable history (the
// first game of a difficulty, or a previous game solved in one guess) — the caller
// then falls back to the weighted draw.
function pickFromHistory(pool, rng){
  if (rng() >= HISTORY_BOOST) return null;
  const last = new Set(getLastGuesses());
  const cands = pool.filter(f => last.has(f.name));
  return cands.length ? cands[Math.floor(rng() * cands.length)] : null;
}

// useHistory stays off for Daily: the boost is per-browser, and Daily's answer has to
// be identical for everyone. Leaving it off also consumes no rng(), so Daily's seeded
// sequence is unchanged from before this existed.
function pickTarget(rng = Math.random, useHistory = false){
  const pool = DATA.filter(inClassicPool);           // era-restricted (Normal/Hard)
  if (useHistory){
    const boosted = pickFromHistory(pool, rng);
    if (boosted) return boosted;
  }
  const total = pool.reduce((s, f) => s + fighterWeight(f), 0);
  let r = rng() * total;
  for (const f of pool){
    r -= fighterWeight(f);
    if (r <= 0) return f;
  }
  return pool[pool.length - 1];
}

// Title Defense targets: any champion with at least one completed title bout.
function pickChampion(){
  // Title Defense keeps its established 2010+ champion pool even though DATA now
  // includes pre-2010 fighters (added for Classic Extreme).
  const pool = DATA.filter(f => f.isChampion && f.titleBouts && f.titleBouts.length
                                && (f.lastUfcYear || 0) >= HARD_SINCE);
  return pool[Math.floor(Math.random() * pool.length)];
}

function newGame(){
  guessed = new Set();
  guessCount = 0;
  solved = false;
  el("reveal").classList.add("hidden");
  el("play-again-btn").classList.remove("hidden");
  el("daily-panel").classList.add("hidden");
  clearInterval(countdownInterval);

  // Daily is limited to Classic-Normal + Moments.
  if (playStyle === "daily" && mode !== "moments") mode = "classic-normal";
  syncGiveUp();   // reads the settled mode/playStyle; covers the early returns below

  // Defining Moments is a self-contained trivia mode (own view + module).
  const momentsMode = mode === "moments";
  document.querySelector(".guess-box").classList.toggle("hidden", momentsMode);
  el("timer").classList.toggle("hidden", momentsMode);
  if (momentsMode){
    el("classic-view").classList.add("hidden");
    el("title-view").classList.add("hidden");
    el("moments-view").classList.remove("hidden");
    clearInterval(timerInterval);
    startMoments();       // defined in moments.js
    return;
  }
  el("moments-view").classList.add("hidden");

  // Daily Classic: if today's puzzle is already done, show the locked panel.
  if (playStyle === "daily"){
    const rec = getDailyRecord("classic");
    if (rec && rec.done){
      el("classic-view").classList.add("hidden");
      el("title-view").classList.add("hidden");
      document.querySelector(".guess-box").classList.add("hidden");
      el("timer").classList.add("hidden");
      clearInterval(timerInterval);
      showDailyLocked();
      return;
    }
  }

  el("guess-input").value = "";
  el("guess-input").disabled = false;

  if (isTitleMode()){
    el("classic-view").classList.add("hidden");
    el("title-view").classList.remove("hidden");
    target = pickChampion();
    renderCluePanel();
  } else {
    el("title-view").classList.add("hidden");
    el("classic-view").classList.remove("hidden");
    target = playStyle === "daily"
      ? pickTarget(seededRng(dailyKey() + "|classic"))
      : pickTarget(Math.random, true);
    el("rows").innerHTML = "";
    updateAttempts();
  }
  el("guess-input").focus();
  startTimer();
}

// Extreme clue: pick ONE title bout with a linear lean toward the least-recent
// (earliest) one. titleBouts is oldest-first, so weight[i] = n - i favors index 0.
function weightedEarliestBoutIndex(n){
  const total = n * (n + 1) / 2;            // sum of weights n..1
  let r = Math.random() * total;
  for (let i = 0; i < n; i++){ r -= (n - i); if (r <= 0) return i; }
  return 0;
}

function renderCluePanel(){
  // Hard: first UFC title bout. Normal: first three (chronological). Extreme: one
  // random bout, weighted toward the earliest (titleBouts is oldest-first).
  let bouts, caption;
  if (mode === "title-extreme"){
    bouts = [target.titleBouts[weightedEarliestBoutIndex(target.titleBouts.length)]];
    caption = "A random UFC title bout";   // don't reveal which number it is
  } else if (mode === "title-hard"){
    bouts = target.titleBouts.slice(0, 1);
    caption = "First UFC title bout";
  } else {
    bouts = target.titleBouts.slice(0, 3);
    caption = "First three UFC title bouts";
  }
  el("clue-caption").textContent = caption;
  el("clue-rows").innerHTML = bouts.map(b => {
    const cls = b.result === "Won" ? "won" : b.result === "Lost" ? "lost" : "draw";
    return `<div class="clue-row">
      <span class="clue-result ${cls}">${b.result}</span>
      <span class="clue-opp">vs ${b.opponent}</span>
      <span class="clue-div">${b.division} Title</span>
      <span class="clue-year">${b.year ?? ""}</span>
    </div>`;
  }).join("");
  el("title-rows").innerHTML = "";
  el("title-grid").classList.add("hidden");  // shown after first guess
  updateAttempts();
}

function updateAttempts(){
  const id = isTitleMode() ? "attempts" : "attempts-classic";
  el(id).textContent = `Guesses: ${guessCount} / ${maxAttempts()}`;
}

function startTimer(){
  startTime = Date.now();
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const s = Math.floor((Date.now() - startTime)/1000);
    const mm = String(Math.floor(s/60)).padStart(2,"0");
    const ss = String(s%60).padStart(2,"0");
    el("timer").textContent = `${mm}:${ss}`;
  }, 1000);
}

// Build one comparison cell. status: exact|border|close|wrong-gender|none, plus an
// optional arrow. `label` names the column. It is invisible on desktop (the grid
// header does that job) and surfaces via .cell::before on phones, where the row
// becomes a card and the header is hidden.
function cell(display, status, arrow, label){
  const arr = arrow ? ` <span class="arrow">${arrow}</span>` : "";
  const l = label ? ` data-label="${label}"` : "";
  if (status === "exact") return `<div class="cell"${l}><span class="chip green">${display} ✓</span></div>`;
  // Orange carries an arrow for Div (one weight class away) but not for Nation,
  // which passes none — a bordering country has no direction.
  if (status === "border") return `<div class="cell"${l}><span class="chip orange">${display}${arr}</span></div>`;
  if (status === "close") return `<div class="cell"${l}><span class="chip yellow">${display}${arr || " ≈"}</span></div>`;
  if (status === "wrong-gender") return `<div class="cell"${l}><span class="chip red">${display}${arr}</span></div>`;
  return `<div class="cell"${l}><span class="val">${display}${arr}</span></div>`;
}

function numCompare(guessVal, targetVal, key){
  if (guessVal == null || targetVal == null) return {status:"none", arrow:""};
  if (guessVal === targetVal) return {status:"exact", arrow:""};
  const arrow = targetVal > guessVal ? "↑" : "↓";
  const close = Math.abs(targetVal - guessVal) <= NUM_CLOSE[key];
  return {status: close ? "close" : "none", arrow};
}

function renderGuess(f){
  const row = document.createElement("div");
  row.className = "guess-row";

  // Division: exact (green) > adjacent weight, same gender (orange) > same gender
  // (yellow) > wrong gender (red). Gender gates the colours — matching only the
  // weight half of the name ("Bantamweight" against "Women's Bantamweight") earns
  // red, not credit, since the divisions are separate ladders. The arrow compares
  // by poundage and still points the right way across genders, so it always shows.
  const gi = wcIndex(f.weightClass), ti = wcIndex(target.weightClass);
  let divStatus, divArrow = "";
  if (gi >= 0 && ti >= 0 && gi !== ti) divArrow = ti > gi ? "↑" : "↓";
  if (f.weightClass === target.weightClass) divStatus = "exact";
  else if (wcGender(f.weightClass) !== wcGender(target.weightClass)) divStatus = "wrong-gender";
  else if (gi >= 0 && ti >= 0 && Math.abs(ti - gi) === 1) divStatus = "border";
  else divStatus = "close";

  // Nationality: exact country > shares a border (orange) > same continent (yellow).
  let natStatus = "none";
  if (f.nationality === target.nationality) natStatus = "exact";
  else if ((BORDERS[target.nationality] || []).includes(f.nationality)) natStatus = "border";
  else if (continent(f.nationality) && continent(f.nationality) === continent(target.nationality)) natStatus = "close";

  // Numerics
  const gAge = ageFromDob(f.dob), tAge = ageFromDob(target.dob);
  const wins = numCompare(f.wins, target.wins, "wins");
  const losses = numCompare(f.losses, target.losses, "losses");
  const height = numCompare(f.heightIn, target.heightIn, "height");
  const age = numCompare(gAge, tAge, "age");
  const debut = numCompare(f.debutYear, target.debutYear, "debut");

  // Stance (categorical)
  const stanceStatus = f.stance && f.stance === target.stance ? "exact" : "none";

  // Champion (boolean). isChampion means "has held a UFC belt at some point",
  // undisputed or interim, current or former — hence the "Ever Champ" label. The
  // roster has no current-vs-former split: ESPN's champion rankings have been
  // frozen since ~2021, so the only source is the hand-kept list in champions.py.
  const champStatus = f.isChampion === target.isChampion ? "exact" : "none";
  const champTxt = f.isChampion ? "Yes" : "No";

  row.innerHTML =
    `<div class="cell cell-name">${f.name}</div>` +
    cell(f.weightClass.replace(/Women's\s+/i,"W "), divStatus, divArrow, "Div") +
    cell(f.nationality, natStatus, "", "Nation") +
    cell(f.wins, wins.status, wins.arrow, "Wins") +
    cell(f.losses, losses.status, losses.arrow, "Losses") +
    cell(f.displayHeight || `${f.heightIn}"`, height.status, height.arrow, "Height") +
    cell(gAge ?? "?", age.status, age.arrow, "Age") +
    cell(f.stance || "—", stanceStatus, "", "Stance") +
    cell(f.debutYear, debut.status, debut.arrow, "Debut") +
    cell(champTxt, champStatus, "", "Ever Champ");

  el(isTitleMode() ? "title-rows" : "rows").appendChild(row);
}

function submitGuess(name){
  if (solved) return;
  const f = DATA.find(x => x.name.toLowerCase() === name.trim().toLowerCase());
  if (!f) return;
  // Classic modes only accept guesses from the current era pool.
  if (!isTitleMode() && !inClassicPool(f)) { el("guess-input").value=""; return; }
  if (guessed.has(f.name)) { el("guess-input").value=""; return; }
  guessed.add(f.name);
  guessCount++;
  el("guess-input").value = "";

  if (isTitleMode()){
    renderGuess(f);              // same classic comparison columns vs the champion
    el("title-grid").classList.remove("hidden");
    updateAttempts();
    if (f.name === target.name) win();
    else if (guessCount >= maxAttempts()) lose();
    return;
  }

  renderGuess(f);
  updateAttempts();
  if (f.name === target.name) win();
  else if (guessCount >= maxAttempts()) lose();
}

// Daily Classic finish: record the result, update the day-streak, lock the day.
function finishDailyClassic(won){
  setDailyRecord("classic", { done: true, won, guesses: guessCount, answer: target.name });
  updateDailyStreak(won);
  document.querySelector(".guess-box").classList.add("hidden");
  el("timer").classList.add("hidden");
  showDailyLocked();
}

// Give Up is Infinity-only (Daily is one-and-done, so there's no burning today's shot
// by accident) and never applies to the self-contained Moments mode.
function canGiveUp(){
  return playStyle === "infinity" && mode !== "moments" && !solved;
}
function syncGiveUp(){
  el("giveup-btn").classList.toggle("hidden", !canGiveUp());
}

function giveUp(){
  solved = true;
  syncGiveUp();
  clearInterval(timerInterval);
  el("guess-input").disabled = true;
  // Reveal the answer as a comparison row, matching lose().
  if (isTitleMode() && !guessed.has(target.name)){
    renderGuess(target);
    el("title-grid").classList.remove("hidden");
  }
  // No saveLastGuesses() here, on purpose: giving up leaves the guess-history boost
  // untouched, so the next game still draws from your last *finished* game.
  localStorage.setItem("octagonle_streak", "0");
  showReveal(false);
}

function lose(){
  solved = true;
  syncGiveUp();
  clearInterval(timerInterval);
  el("guess-input").disabled = true;
  // Reveal the answer as a comparison row so its columns are shown (all green).
  if (isTitleMode() && !guessed.has(target.name)){
    renderGuess(target);
    el("title-grid").classList.remove("hidden");
  }
  if (playStyle === "daily"){ finishDailyClassic(false); return; }
  if (!isTitleMode()) saveLastGuesses();
  localStorage.setItem("octagonle_streak", "0");
  showReveal(false);
}

function win(){
  solved = true;
  syncGiveUp();
  clearInterval(timerInterval);
  el("guess-input").disabled = true;
  awardWinPoints();
  if (playStyle === "daily"){ finishDailyClassic(true); return; }
  if (!isTitleMode()) saveLastGuesses();
  // Streak (session-persistent via localStorage)
  const streak = parseInt(localStorage.getItem("octagonle_streak") || "0", 10) + 1;
  localStorage.setItem("octagonle_streak", String(streak));
  showReveal(true, streak);
}

function showReveal(won, streak){
  el("result-title").textContent = won ? "You won!" : "Out of guesses!";
  el("reveal-img").src = target.headshot;
  el("reveal-name").textContent = target.name;
  el("result-guesses").textContent = won
    ? `${guessCount} guess${guessCount===1?"":"es"}`
    : `The answer was ${target.name}`;
  el("result-streak").textContent = won ? String(streak) : "0";

  if (isTitleMode()){
    renderTitleReveal();
  } else {
    el("reveal-label").textContent = "Today's Fighter is…";
    el("reveal-stats").classList.remove("hidden");
    el("reveal-title").classList.add("hidden");
    const stats = [
      ["Division", target.weightClass],
      ["Nation", target.nationality],
      ["Record", target.record],
      ["Height", target.displayHeight],
      ["Age", ageFromDob(target.dob)],
      ["Stance", target.stance || "—"],
      ["Debut", target.debutYear],
      ["Ever Champ", target.isChampion ? "Yes" : "No"],
    ];
    el("reveal-stats").innerHTML = stats
      .map(([k,v]) => `<div><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");
  }
  el("reveal").classList.remove("hidden");
}

// A bout's weightClass ("Heavyweight") is the same for an interim and an
// undisputed belt; only ESPN's title label (titleDivision) carries the
// distinction, and it prefixes "Interim" but never spells out "Undisputed".
// TUF tournament finals are flagged as title bouts but aren't championships,
// so their label is left alone.
function titleBoutLabel(b){
  const label = b.titleDivision || b.division || b.weightClass || "";
  if (/tournament/i.test(label)) return label;
  return /^interim\b/i.test(label) ? label : `Undisputed ${label}`;
}

// Championship résumé for the Title Defense reveal.
function renderTitleReveal(){
  el("reveal-label").textContent = "The Champion is…";
  el("reveal-stats").classList.add("hidden");
  el("reveal-title").classList.remove("hidden");

  const bouts = target.titleBouts || [];
  const wins = bouts.filter(b => b.result === "Won").length;
  const losses = bouts.filter(b => b.result === "Lost").length;
  const draws = bouts.filter(b => b.result === "Draw").length;
  // Distinct divisions a title was contested in, kept in first-appearance order.
  const belts = [];
  for (const b of bouts) if (!belts.includes(b.division)) belts.push(b.division);
  const rec = `${wins}-${losses}${draws ? "-" + draws : ""}`;

  el("title-summary").innerHTML =
    `<div class="ts-item"><div class="k">Title Bouts</div><div class="v">${bouts.length}</div></div>` +
    `<div class="ts-item"><div class="k">Title Record</div><div class="v">${rec}</div></div>` +
    `<div class="ts-item"><div class="k">Divisions</div><div class="v">${belts.length}</div></div>`;

  el("title-belts").innerHTML = belts
    .map(d => `<span class="belt-chip">🏆 ${d}</span>`).join("");

  // Full UFC fight log, across ALL weight classes; title fights get a belt.
  const fights = (target.ufcFights && target.ufcFights.length) ? target.ufcFights : bouts;
  el("title-log").innerHTML = fights.map(b => {
    const cls = b.result === "Won" ? "won" : b.result === "Lost" ? "lost" : "draw";
    const div = b.isTitle ? titleBoutLabel(b) : (b.weightClass || b.division || "");
    const belt = b.isTitle ? '<span class="log-belt">🏆</span>' : "";
    return `<div class="log-row">
      <span class="log-year">${b.year ?? ""}</span>
      <span class="log-result ${cls}">${b.result}</span>
      <span class="log-opp">vs ${b.opponent}</span>
      <span class="log-div">${belt}${div}</span>
    </div>`;
  }).join("");
}

// ---------- Events ----------
// Guesses are restricted to the current mode's pool; suggestions refresh live.
attachAutocomplete(
  el("guess-input"),
  () => guessablePool().map(f => f.name),
  submitGuess,
  { submitOnEnter: true }
);
el("play-again-btn").addEventListener("click", newGame);
const SHARE_URL = "https://weiddle.com";   // canonical origin; points live in its localStorage
el("share-btn").addEventListener("click", () => {
  const label = isTitleMode() ? "Weiddle Title Defense" : "Weiddle";
  const line = `${label} — solved in ${guessCount} guesses ⏱\n${SHARE_URL}`;
  if (navigator.clipboard) navigator.clipboard.writeText(line);
  el("share-btn").textContent = "Copied!";
  setTimeout(() => el("share-btn").textContent = "↗ Share", 1500);
});

// ---------- Give-up modal ----------
function closeGiveUp(){ el("giveup-modal").classList.add("hidden"); }
el("giveup-btn").addEventListener("click", () => {
  if (canGiveUp()) el("giveup-modal").classList.remove("hidden");
});
el("giveup-cancel").addEventListener("click", closeGiveUp);
el("giveup-modal").addEventListener("click", (e) => {
  if (e.target.id === "giveup-modal") closeGiveUp();
});
el("giveup-confirm").addEventListener("click", () => {
  closeGiveUp();
  if (canGiveUp()) giveUp();   // re-checked: the game may have ended while open
});

// ---------- Game mode modal ----------
function markSelectedMode(){
  document.querySelectorAll(".mode-option").forEach(b =>
    b.classList.toggle("selected", b.dataset.mode === mode));
}
el("mode-btn").addEventListener("click", () => {
  markSelectedMode();
  el("mode-modal").classList.remove("hidden");
});
el("mode-close").addEventListener("click", () => el("mode-modal").classList.add("hidden"));
el("mode-modal").addEventListener("click", (e) => {
  if (e.target.id === "mode-modal") el("mode-modal").classList.add("hidden");
});
document.querySelectorAll(".mode-option").forEach(btn => {
  btn.addEventListener("click", () => {
    mode = btn.dataset.mode;
    localStorage.setItem("octagonle_mode", mode);
    el("mode-modal").classList.add("hidden");
    newGame();
  });
});

// ---------- Play-style (Infinity / Daily) ----------
function applyPlayStyle(){
  const daily = playStyle === "daily";
  el("play-label").textContent = daily ? "Daily" : "Infinity";
  document.querySelector("#play-btn .ico").textContent = daily ? "📅" : "♾️";
  // Daily only offers the data-daily modes (Classic-Normal + Moments).
  document.querySelectorAll(".mode-option").forEach(b =>
    b.classList.toggle("hidden", daily && b.dataset.daily === undefined));
  if (daily && mode !== "moments") mode = "classic-normal";
}
function markSelectedPlay(){
  document.querySelectorAll(".play-option").forEach(b =>
    b.classList.toggle("selected", b.dataset.style === playStyle));
}
el("play-btn").addEventListener("click", () => {
  markSelectedPlay();
  el("play-modal").classList.remove("hidden");
});
el("play-close").addEventListener("click", () => el("play-modal").classList.add("hidden"));
el("play-modal").addEventListener("click", (e) => {
  if (e.target.id === "play-modal") el("play-modal").classList.add("hidden");
});
document.querySelectorAll(".play-option").forEach(btn => {
  btn.addEventListener("click", () => {
    playStyle = btn.dataset.style;
    localStorage.setItem("octagonle_playstyle", playStyle);
    el("play-modal").classList.add("hidden");
    applyPlayStyle();
    newGame();
  });
});
el("daily-share").addEventListener("click", () => {
  const kind = (mode === "moments") ? "moments" : "classic";
  const rec = getDailyRecord(kind) || {};
  const streak = localStorage.getItem("octagonle_daily_streak") || "0";
  const line = kind === "moments"
    ? `Weiddle Daily Moments — ${rec.score}/${rec.max} · streak ${streak} 🥊\n${SHARE_URL}`
    : `Weiddle Daily (${dailyKey()}) — ${rec.won ? rec.guesses + " guesses" : "X"} · streak ${streak} 🥊\n${SHARE_URL}`;
  if (navigator.clipboard) navigator.clipboard.writeText(line);
  el("daily-share").textContent = "Copied!";
  setTimeout(() => el("daily-share").textContent = "↗ Share", 1500);
});

applyPlayStyle();
renderLevelBox();
load();
