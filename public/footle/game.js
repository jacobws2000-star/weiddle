"use strict";

// Footle — guess the mystery 2025-26 Premier League starter.
//   Modes: Daily (one shared seeded puzzle per UTC day, one-and-done) + Endless
//   (unlimited random draws). Progress/points/streak live in localStorage under
//   footle_ keys (same origin as Weiddle's octagonle_, Cindle's cindle_, and
//   Puttle's puttle_ keys).
//
// The pool is every player with >= 10 league starts in 2025-26 (see
// data/build_footle.py). Each guess grades six columns: Nationality (green
// exact, orange borders, yellow same continent), Club (green exact, orange
// within 3 final-table places, yellow within 7), Position (green exact, yellow
// adjacent line), Age / Goals / Shirt (numeric, arrows point toward the answer).
// Age is computed client-side from DOB so it never goes stale.

const NUM_CLOSE = { age: 2, goals: 3, shirt: 3 };
const POS_ORDER = { GK: 0, DEF: 1, MID: 2, FWD: 3 };

const TIERS = {
  daily:   { label: "Daily",   guesses: 8,
             desc: "One Premier League starter for everyone today. One try, come back tomorrow." },
  endless: { label: "Endless", guesses: 8, endless: true,
             desc: "Keep guessing new starters from the 2025-26 season. Unlimited rounds." },
};

let DATA = [];
let BORDERS = {};
let CONTINENTS = {};
let CLUBTABLE = {};
let mode = localStorage.getItem("footle_mode") || "daily";
if (!TIERS[mode]) mode = "daily";
let target = null;
let guessed = new Set();
let guessRows = [];       // per-guess status arrays, for the share grid
let guessCount = 0;
let solved = false;
let countdownInterval = null;

const el = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- deterministic daily seeding (mirrors the UFC/movie/golf games) ----------
function dailyKey(){ return new Date().toISOString().slice(0, 10); }
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
function prevDay(key){ const d = new Date(key + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }

// Age computed client-side from DOB so it never goes stale (same as the other games).
function ageOf(dob){
  const d = new Date(String(dob) + "T00:00:00Z");
  if (isNaN(d)) return null;
  const now = new Date();
  let a = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) a--;
  return a;
}

// ---------- pools ----------
// Only two modes, both drawing from the whole starter pool; there are no tiers.
function poolFor(){ return DATA; }
function maxAttempts(){ return TIERS[mode].guesses; }

// ---------- target selection ----------
// A player's chance of being the mystery target ramps with minutes played, so the
// week-in-week-out starters everyone recognizes come up more often than a fringe
// regular. Pure selection weight; bands are thresholds (one weight each).
function minsWeight(min){
  min = min || 0;
  if (min >= 3000) return 1.70;   // near ever-present
  if (min >= 2200) return 1.45;
  if (min >= 1400) return 1.20;
  return 1.0;                     // squad-rotation starter
}
// Weighted pick from `pool` using rng() (a function returning [0,1)); shared by
// the seeded daily and the Math.random endless draw so both honor the boost.
function pickWeighted(pool, rng){
  let total = 0;
  for (const p of pool) total += minsWeight(p.min);
  let r = rng() * total;
  for (const p of pool){
    r -= minsWeight(p.min);
    if (r < 0) return p;
  }
  return pool[pool.length - 1];  // float-rounding fallback
}

// ---------- boot ----------
async function boot(){
  const res = await fetch("../footle_players.json", { cache: "no-cache" });
  const j = await res.json();
  DATA = (j.players || []).map(p => ({ ...p, age: ageOf(p.dob) }));
  BORDERS = j.borders || {};
  CONTINENTS = j.continents || {};
  CLUBTABLE = j.clubTable || {};
  wireUI();
  renderStats();
  selectMode(mode);
}

// ---------- Autocomplete ----------
// Custom touch-friendly dropdown (mobile Safari/Chrome never render <datalist>
// reliably). Ported from the other games; styles live in the parent stylesheet's
// .ac-menu / .ac-item, which this page @imports.
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
  // Mobile tap-through guard: we pick on pointer/mouse *down* and close the menu,
  // but touch browsers then synthesize a `click` at those coordinates that lands
  // on whatever is now underneath. Arm a one-shot capture listener that eats that
  // ghost click; a short timeout disarms it so a genuine later tap survives.
  const swallowGhostClick = () => {
    const onClick = (ev) => { ev.preventDefault(); ev.stopPropagation(); disarm(); };
    const disarm = () => { document.removeEventListener("click", onClick, true); clearTimeout(t); };
    const t = setTimeout(disarm, 400);
    document.addEventListener("click", onClick, true);
  };
  const pick = (i) => {
    if (i < 0 || i >= items.length) return;
    const name = items[i];
    input.value = name;
    close();
    swallowGhostClick();
    onPick(name);
  };

  input.addEventListener("input", render);
  input.addEventListener("focus", render);
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
      else close();
    }
    else if (e.key === "Escape"){ close(); }
  }, true);

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

// Duplicate display names (rare, but e.g. two "Danny Ings"-alikes) are shown as
// "Name (Club)" so they're pickable; unique names stay bare.
function nameCounts(){
  const c = {};
  for (const p of DATA) c[p.name] = (c[p.name] || 0) + 1;
  return c;
}
function playerNames(){
  const c = nameCounts();
  return DATA.map(p => c[p.name] > 1 ? `${p.name} (${p.club})` : p.name);
}

// ---------- mode handling ----------
function selectMode(m){
  mode = TIERS[m] ? m : "daily";
  localStorage.setItem("footle_mode", mode);
  document.querySelectorAll(".mode-tab").forEach(b =>
    b.classList.toggle("active", b.dataset.mode === mode));
  el("mode-desc").textContent = TIERS[mode].desc;
  el("new-btn").classList.toggle("hidden", !TIERS[mode].endless);
  if (mode === "daily") startDaily();
  else newGame();
}

// The Give Up button only makes sense while a game is live (input enabled).
function showGiveUp(on){ el("giveup-btn").classList.toggle("hidden", !on); }

function newGame(){
  target = pickWeighted(poolFor(), Math.random);
  resetBoard();
  el("guess-input").disabled = false;
  el("guess-input").focus();
  showGiveUp(true);
}

// Daily: same player for everyone on a given UTC day; one-and-done, resumable.
function startDaily(){
  const pool = poolFor().slice().sort((a, b) => a.name < b.name ? -1 : 1); // stable order
  const rng = mulberry32(hashStr(dailyKey() + "-footle"));
  target = pickWeighted(pool, rng);
  resetBoard();

  const rec = getDailyRecord();
  if (rec){ replayDaily(rec); return; }        // already played today
  el("guess-input").disabled = false;
  el("guess-input").focus();
  showGiveUp(true);
}

function resetBoard(){
  guessed = new Set();
  guessRows = [];
  guessCount = 0;
  solved = false;
  el("rows").innerHTML = "";
  el("reveal").className = "reveal hidden";
  el("daily-panel").className = "reveal hidden";
  el("guess-input").value = "";
  showGiveUp(false);
  updateStatus();
}

function updateStatus(){ el("status").textContent = `${guessCount} / ${maxAttempts()}`; }

// ---------- comparators ----------
function numCompare(g, t, key){
  if (g == null || t == null) return { status: "none", arrow: "" };
  if (g === t) return { status: "exact", arrow: "" };
  const arrow = t > g ? "↑" : "↓";
  return { status: Math.abs(t - g) <= NUM_CLOSE[key] ? "close" : "none", arrow };
}
// Nationality: green if same, orange if the guess borders the answer's country,
// yellow if it's merely on the same continent.
function countryCompare(g, t){
  if (g === t) return "exact";
  if ((BORDERS[t] || []).includes(g)) return "border";
  if (CONTINENTS[g] && CONTINENTS[g] === CONTINENTS[t]) return "continent";
  return "none";
}
// Club: green if same, orange if the two clubs finished within 3 places in the
// 2025-26 table, yellow within 7 (reuses the border/continent chip colors).
function clubCompare(g, t){
  if (g === t) return "exact";
  const pg = CLUBTABLE[g], pt = CLUBTABLE[t];
  if (pg == null || pt == null) return "none";
  const d = Math.abs(pg - pt);
  if (d <= 3) return "border";
  if (d <= 7) return "continent";
  return "none";
}
// Position: green exact, yellow if the two lines are adjacent (GK↔DEF↔MID↔FWD).
function positionCompare(g, t){
  if (g === t) return "exact";
  const a = POS_ORDER[g], b = POS_ORDER[t];
  if (a == null || b == null) return "none";
  return Math.abs(a - b) === 1 ? "close" : "none";
}
function cell(display, status, arrow, label){
  const arr = arrow ? ` <span class="arrow">${arrow}</span>` : "";
  const l = label ? ` data-label="${label}"` : "";
  if (status === "exact")  return `<div class="cell"${l}><span class="chip green">${display} ✓</span></div>`;
  if (status === "close")  return `<div class="cell"${l}><span class="chip yellow">${display}${arr || " ≈"}</span></div>`;
  if (status === "border") return `<div class="cell"${l}><span class="chip orange">${display}</span></div>`;
  if (status === "continent") return `<div class="cell"${l}><span class="chip yellow">${display}</span></div>`;
  return `<div class="cell"${l}><span class="val">${display}${arr}</span></div>`;
}

// Returns the 6 column statuses so the same call renders a row and records the
// share grid (order: Nationality Club Position Age Goals Shirt).
function renderGuess(p){
  const nat   = countryCompare(p.nation, target.nation);
  const club  = clubCompare(p.club, target.club);
  const pos   = positionCompare(p.pos, target.pos);
  const age   = numCompare(p.age, target.age, "age");
  const goals = numCompare(p.goals, target.goals, "goals");
  const shirt = numCompare(p.shirt, target.shirt, "shirt");

  const row = document.createElement("div");
  row.className = "guess-row";
  row.innerHTML =
    `<div class="cell cell-name">${esc(p.name)}</div>` +
    cell(esc(p.nation || "—"), nat, "", "Nationality") +
    cell(esc(p.club), club, "", "Club") +
    cell(p.pos || "—", pos, "", "Position") +
    cell(p.age != null ? p.age : "—", age.status, age.arrow, "Age") +
    cell(p.goals, goals.status, goals.arrow, "Goals") +
    cell(p.shirt != null ? p.shirt : "—", shirt.status, shirt.arrow, "Shirt");
  el("rows").appendChild(row);

  return [nat, club, pos, age.status, goals.status, shirt.status];
}

// ---------- guess handling ----------
// Matches on the exact display name, or the "Name (Club)" form used for dupes.
function matchPlayer(val){
  const v = val.trim().toLowerCase();
  return DATA.find(x => x.name.toLowerCase() === v)
      || DATA.find(x => `${x.name} (${x.club})`.toLowerCase() === v)
      || null;
}

function submitGuess(val){
  if (solved) return;
  const p = matchPlayer(val);
  if (!p) return;
  if (guessed.has(p)) { el("guess-input").value = ""; return; }
  guessed.add(p);
  guessCount++;
  el("guess-input").value = "";
  guessRows.push(renderGuess(p));
  const won = p === target;
  if (won || guessCount >= maxAttempts()) endGame(won);
  updateStatus();
}

// Reveal the answer without spending a guess; ends the round as a loss.
function giveUp(){
  if (solved) return;
  endGame(false, true);
}

function playerLine(p){
  const bits = [p.club, p.pos, p.nation, `${p.goals} goal${p.goals === 1 ? "" : "s"}`];
  return bits.filter(Boolean).join(" · ");
}

function endGame(won, gaveUp = false){
  solved = true;
  el("guess-input").disabled = true;
  showGiveUp(false);
  if (mode === "daily"){
    setDailyRecord({ won, guesses: guessCount, answer: target.name, grid: guessRows, gaveUp });
    updateDailyStreak(won);
    if (won) addPoints(TIERS.daily.guesses - guessCount + 3);
    showDailyPanel(won, null, gaveUp);
  } else {
    if (won){ addPoints(scoreFor()); bumpStreak(true); } else bumpStreak(false);
    const r = el("reveal");
    r.className = "reveal" + (won ? " win" : "");
    r.innerHTML = won
      ? `<div class="reveal-title">🎉 Got it in ${guessCount}!</div>
         <div>${esc(target.name)} — ${esc(playerLine(target))}</div>`
      : `<div class="reveal-title">${gaveUp ? "Gave up" : "Out of guesses"}</div>
         <div>It was <b>${esc(target.name)}</b> — ${esc(playerLine(target))}.</div>`;
  }
  renderStats();
}

function scoreFor(){
  // Base score, bonus for solving with guesses to spare.
  const base = 70;
  return Math.round(base * (1 + (maxAttempts() - guessCount) / maxAttempts()));
}

// ---------- Daily state ----------
function dailyRecordKey(){ return `footle_daily_${dailyKey()}`; }
function getDailyRecord(){ try { return JSON.parse(localStorage.getItem(dailyRecordKey()) || "null"); } catch { return null; } }
function setDailyRecord(rec){ localStorage.setItem(dailyRecordKey(), JSON.stringify(rec)); }

function updateDailyStreak(won){
  const today = dailyKey();
  if (localStorage.getItem("footle_daily_counted") === today) return;
  let streak = parseInt(localStorage.getItem("footle_daily_streak") || "0", 10);
  if (won){
    streak = (localStorage.getItem("footle_daily_lastwin") === prevDay(today)) ? streak + 1 : 1;
    localStorage.setItem("footle_daily_lastwin", today);
  } else streak = 0;
  localStorage.setItem("footle_daily_streak", String(streak));
  localStorage.setItem("footle_daily_counted", today);
}

// Re-render a Daily that was already completed today, then show the locked panel.
function replayDaily(rec){
  el("guess-input").disabled = true;
  showGiveUp(false);
  guessRows = rec.grid || [];
  // We persist only the grid statuses, not the guessed players, so there's no
  // per-row redraw here — the share grid replays from stored statuses.
  showDailyPanel(rec.won, rec);
}

function showDailyPanel(won, rec, gaveUp = false){
  const guesses = rec ? rec.guesses : guessCount;
  const answer = rec ? rec.answer : target.name;
  const gave = rec ? rec.gaveUp : gaveUp;   // a resumed record remembers how it ended
  el("daily-title").textContent = won ? "Daily solved! 🎉" : "Daily complete";
  el("daily-sub").innerHTML = won
    ? `Solved in ${guesses} guess${guesses === 1 ? "" : "es"}.`
    : `${gave ? "Gave up" : "Out of guesses"} — it was <b>${esc(answer)}</b>.`;
  el("daily-streak").textContent = localStorage.getItem("footle_daily_streak") || "0";
  el("daily-panel").className = "reveal" + (won ? " win" : "");
  startCountdown();
}

function startCountdown(){
  clearInterval(countdownInterval);
  const tick = () => {
    const now = new Date();
    const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0);
    const ms = Math.max(0, next - now.getTime());
    const pad = n => String(n).padStart(2, "0");
    el("daily-countdown").textContent =
      `${pad(Math.floor(ms / 3.6e6))}:${pad(Math.floor(ms % 3.6e6 / 6e4))}:${pad(Math.floor(ms % 6e4 / 1e3))}`;
  };
  tick();
  countdownInterval = setInterval(tick, 1000);
}

// ---------- points & endless streak ----------
function addPoints(n){
  const p = parseInt(localStorage.getItem("footle_points") || "0", 10) + n;
  localStorage.setItem("footle_points", String(p));
}
function bumpStreak(won){
  const k = "footle_win_streak";
  localStorage.setItem(k, won ? String(parseInt(localStorage.getItem(k) || "0", 10) + 1) : "0");
}
function renderStats(){
  el("points").textContent = localStorage.getItem("footle_points") || "0";
  el("streak").textContent = localStorage.getItem("footle_daily_streak") || "0";
}

// ---------- share ----------
function shareText(){
  const rec = getDailyRecord();
  const grid = (rec && rec.grid) || guessRows;
  const emoji = s => s === "exact" ? "🟩" : s === "border" ? "🟧"
                   : (s === "close" || s === "continent") ? "🟨" : "⬜";
  const head = `Footle ${dailyKey()} — ${rec && !rec.won ? "X" : (rec ? rec.guesses : guessCount)}/${TIERS.daily.guesses}`;
  const body = grid.map(row => row.map(emoji).join("")).join("\n");
  return `${head}\n${body}\nhttps://weiddle.com/footle`;
}
function doShare(){
  const rec = getDailyRecord();
  const grid = (rec && rec.grid) || guessRows;
  const emoji = s => s === "exact" ? "🟩" : s === "border" ? "🟧"
                   : (s === "close" || s === "continent") ? "🟨" : "⬜";
  const score = rec && !rec.won ? "X" : (rec ? rec.guesses : guessCount);
  window.weiddleShare({
    text: shareText(),
    url: "https://weiddle.com/footle",
    headline: "⚽ Footle",
    subtitle: `${dailyKey()} · ${score}/${TIERS.daily.guesses}`,
    grid: grid.map(row => row.map(emoji)),
    onCopied: () => {
      el("share-copied").classList.remove("hidden");
      setTimeout(() => el("share-copied").classList.add("hidden"), 2000);
    },
  });
}

// ---------- wiring ----------
function wireUI(){
  attachAutocomplete(
    el("guess-input"),
    playerNames,
    submitGuess,
    { submitOnEnter: true }
  );
  el("new-btn").addEventListener("click", newGame);
  el("giveup-btn").addEventListener("click", () => {
    if (!solved) el("giveup-modal").classList.remove("hidden");
  });
  el("giveup-confirm").addEventListener("click", () => {
    el("giveup-modal").classList.add("hidden");
    giveUp();
  });
  el("giveup-cancel").addEventListener("click", () => el("giveup-modal").classList.add("hidden"));
  el("share-btn").addEventListener("click", doShare);
  document.querySelectorAll(".mode-tab").forEach(b =>
    b.addEventListener("click", () => selectMode(b.dataset.mode)));
}

boot();
