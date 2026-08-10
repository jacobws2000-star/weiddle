"use strict";

// Puttle — golfer-guessing game.
//   Modes: Daily (one shared seeded puzzle per UTC day, one-and-done) + three
//   endless difficulty tiers gated on a fame rank (see build_golfers.py). Scoring/
//   streak in localStorage under a puttle_ prefix (kept fully separate from the
//   UFC game's octagonle_ and Cindle's cindle_ keys, which share the same origin).

// Numeric "close" thresholds (|diff| <= threshold and not equal => yellow). The
// pgaWins / turnedPro windows are a touch generous on purpose: they cushion the
// small drift in the curated PGA-win snapshot (see data/golfers_seed.py).
const NUM_CLOSE = { age: 3, turnedPro: 3, majors: 1, pgaWins: 2 };

// Difficulty tiers gate the pool by tier level (1 Normal ⊂ 2 Hard ⊂ 3 Extreme),
// assigned in build_golfers.py by ranking every golfer on a fame score (majors,
// PGA wins, worldwide wins, Wikipedia footprint). Daily draws from the Normal
// head so the shared puzzle stays fair. Guess limits grow as the pool deepens.
const TIERS = {
  daily:   { label: "Daily",   level: 1, guesses: 8,  endless: false,
             desc: "One golfer a day, same for everyone. Drawn from the big names." },
  normal:  { label: "Normal",  level: 1, guesses: 8,  endless: true,
             desc: "The ~290 biggest names of the modern era. 8 guesses." },
  hard:    { label: "Hard",    level: 2, guesses: 9,  endless: true,
             desc: "~700 modern golfers — tour winners and classics, deeper cuts. 9 guesses." },
  extreme: { label: "Extreme", level: 3, guesses: 10, endless: true,
             desc: "The whole modern pool — every pro since 1987. 10 guesses." },
  // Themed mode: champions only. `filter` (not `level`) defines the pool — every
  // major winner already ranks tier 1, but level:3 keeps it robust if the fame
  // ranking ever shifts. ~300 golfers, all recognizable, so guesses are tight.
  majors:  { label: "Majors",  level: 3, guesses: 6, endless: true,
             filter: g => (g.majors || 0) >= 1,
             desc: "Major champions only — the ~300 golfers with at least one major. 6 guesses." },
  // Themed mode: the current PGA Tour. Pool is the golfers who hold a 2026 Tour
  // card (2025 FedEx Cup top 125 + Korn Ferry graduates), flagged `tour2026` in
  // build_golfers.py. level:3 + the flag define the pool; the modern-era cutoff
  // in poolFor is waived for it (the flag is the authority). Aimed at fans who
  // watch every week, so every answer is a name you've seen on a leaderboard.
  tour:    { label: "Tour",    level: 3, guesses: 8, endless: true,
             filter: g => g.tour2026,
             desc: "On the PGA Tour right now — the golfers with a 2026 card. For fans who watch every week. 8 guesses." },
};

let DATA = [];
let BORDERS = {};
let CONTINENTS = {};
let mode = localStorage.getItem("puttle_mode") || "daily";
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

// ---------- deterministic daily seeding (mirrors the UFC & movie games) ----------
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

// Age computed client-side from DOB so it never goes stale (same as the UFC game).
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
// Every mode except Majors is restricted to the modern era: golfers who turned
// pro in 1987 or later (John Daly, class of '87, is the earliest that qualifies).
// Majors keeps its full historical set of champions.
const MODERN_TURNED_PRO = 1987;
function poolFor(m){
  const t = TIERS[m];
  return DATA.filter(x =>
    (x.tier || 3) <= t.level &&
    (!t.filter || t.filter(x)) &&
    (m === "majors" || m === "tour" || (x.turnedPro || 0) >= MODERN_TURNED_PRO));
}
function maxAttempts(){ return TIERS[mode].guesses; }

// ---------- target selection ----------
// A golfer's chance of being the mystery target ramps with their PGA Tour wins:
// more wins => picked more often. This is a pure selection weight, entirely
// separate from the fame/tier ranking. Bands are thresholds (one weight each).
function pgaWeight(pga){
  pga = pga || 0;
  if (pga >= 51) return 1.70;    // 51+   wins -> +70%
  if (pga >= 21) return 1.60;    // 21-50 wins -> +60%
  if (pga >= 11) return 1.40;    // 11-20 wins -> +40%
  if (pga >= 4)  return 1.14;    // 4-10  wins -> +14%
  return 1.0;                    // 0-3   wins -> no boost
}
// Weighted pick from `pool` using rng() (a function returning [0,1)). Used for
// both the seeded daily and the Math.random endless draws, so both honor the
// PGA-win boost identically.
function pickWeighted(pool, rng){
  let total = 0;
  for (const g of pool) total += pgaWeight(g.pgaWins);
  let r = rng() * total;
  for (const g of pool){
    r -= pgaWeight(g.pgaWins);
    if (r < 0) return g;
  }
  return pool[pool.length - 1];  // float-rounding fallback
}

// ---------- boot ----------
async function boot(){
  const res = await fetch("../golfers.json", { cache: "no-cache" });
  const j = await res.json();
  DATA = (j.golfers || []).map(g => ({ ...g, age: ageOf(g.dob) }));
  BORDERS = j.borders || {};
  CONTINENTS = j.continents || {};
  wireUI();
  renderStats();
  selectMode(mode);
}

// ---------- Autocomplete ----------
// <datalist> suggestions are unreliable on mobile Safari/Chrome — they often
// never render, which left phone users able to type but unable to pick a golfer.
// This is a custom dropdown that works with touch: it filters as you type, uses
// large tap targets, and you tap a name to choose it. Arrow keys + Enter still
// work for desktop. (Ported from the Weiddle main game; styles live in the
// parent stylesheet's .ac-menu / .ac-item, which this page @imports.)
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

  // Fire on pointer/mouse *down* + preventDefault so the input doesn't blur
  // (which would close the menu) before the pick registers. Both event types are
  // wired so touch, mouse, and pen all work.
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

// ---------- mode handling ----------
function selectMode(m){
  mode = TIERS[m] ? m : "daily";
  localStorage.setItem("puttle_mode", mode);
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
  const pool = poolFor(mode);
  target = pickWeighted(pool, Math.random);
  resetBoard();
  el("guess-input").disabled = false;
  el("guess-input").focus();
  showGiveUp(true);
}

// Daily: same golfer for everyone on a given UTC day; one-and-done, resumable.
function startDaily(){
  const pool = poolFor("daily").slice().sort((a, b) => a.name < b.name ? -1 : 1); // stable order
  const rng = mulberry32(hashStr(dailyKey() + "-puttle"));
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
// Country: green if same, orange if the guess borders the answer's country,
// yellow if it's merely on the same continent.
function countryCompare(g, t){
  if (g === t) return "exact";
  if ((BORDERS[t] || []).includes(g)) return "border";
  if (CONTINENTS[g] && CONTINENTS[g] === CONTINENTS[t]) return "continent";
  return "none";
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

// Returns the 5 column statuses so the same call renders a row and records the
// share grid (order: Country Age TurnedPro Majors PGAWins).
function renderGuess(g){
  const country = countryCompare(g.country, target.country);
  const age     = numCompare(g.age, target.age, "age");
  const tp      = numCompare(g.turnedPro, target.turnedPro, "turnedPro");
  const majors  = numCompare(g.majors, target.majors, "majors");
  const wins    = numCompare(g.pgaWins, target.pgaWins, "pgaWins");

  const row = document.createElement("div");
  row.className = "guess-row";
  row.innerHTML =
    `<div class="cell cell-name">${esc(g.name)}</div>` +
    cell(esc(g.country), country, "", "Country") +
    cell(g.age != null ? g.age : "—", age.status, age.arrow, "Age") +
    cell(g.turnedPro, tp.status, tp.arrow, "Turned Pro") +
    cell(g.majors, majors.status, majors.arrow, "Majors") +
    cell(g.pgaWins, wins.status, wins.arrow, "PGA Wins");
  el("rows").appendChild(row);

  return [country, age.status, tp.status, majors.status, wins.status];
}

// ---------- guess handling ----------
function matchGolfer(val){
  const v = val.trim().toLowerCase();
  return DATA.find(x => x.name.toLowerCase() === v) || null;
}

function submitGuess(val){
  if (solved) return;
  const g = matchGolfer(val);
  if (!g) return;
  if (guessed.has(g.name)) { el("guess-input").value = ""; return; }
  guessed.add(g.name);
  guessCount++;
  el("guess-input").value = "";
  guessRows.push(renderGuess(g));
  const won = g.name === target.name;
  if (won || guessCount >= maxAttempts()) endGame(won);
  updateStatus();
}

// Reveal the answer without spending a guess; ends the round as a loss.
function giveUp(){
  if (solved) return;
  endGame(false, true);
}

function golferLine(g){
  const bits = [g.country, `${g.majors} major${g.majors === 1 ? "" : "s"}`,
                `${g.pgaWins} PGA win${g.pgaWins === 1 ? "" : "s"}`];
  return bits.join(" · ");
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
         <div>${esc(target.name)} — ${esc(golferLine(target))}</div>`
      : `<div class="reveal-title">${gaveUp ? "Gave up" : "Out of guesses"}</div>
         <div>It was <b>${esc(target.name)}</b> — ${esc(golferLine(target))}.</div>`;
  }
  renderStats();
}

function scoreFor(){
  // Base by tier, bonus for solving with guesses to spare.
  const base = { normal: 60, hard: 100, extreme: 150, majors: 90, tour: 80 }[mode] || 60;
  return Math.round(base * (1 + (maxAttempts() - guessCount) / maxAttempts()));
}

// ---------- Daily state ----------
function dailyRecordKey(){ return `puttle_daily_${dailyKey()}`; }
function getDailyRecord(){ try { return JSON.parse(localStorage.getItem(dailyRecordKey()) || "null"); } catch { return null; } }
function setDailyRecord(rec){ localStorage.setItem(dailyRecordKey(), JSON.stringify(rec)); }

function updateDailyStreak(won){
  const today = dailyKey();
  if (localStorage.getItem("puttle_daily_counted") === today) return;
  let streak = parseInt(localStorage.getItem("puttle_daily_streak") || "0", 10);
  if (won){
    streak = (localStorage.getItem("puttle_daily_lastwin") === prevDay(today)) ? streak + 1 : 1;
    localStorage.setItem("puttle_daily_lastwin", today);
  } else streak = 0;
  localStorage.setItem("puttle_daily_streak", String(streak));
  localStorage.setItem("puttle_daily_counted", today);
}

// Re-render a Daily that was already completed today, then show the locked panel.
function replayDaily(rec){
  el("guess-input").disabled = true;
  showGiveUp(false);
  guessRows = rec.grid || [];
  // We persist only the grid statuses, not the guessed golfers, so there's no
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
  el("daily-streak").textContent = localStorage.getItem("puttle_daily_streak") || "0";
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
  const p = parseInt(localStorage.getItem("puttle_points") || "0", 10) + n;
  localStorage.setItem("puttle_points", String(p));
}
function bumpStreak(won){
  const k = "puttle_win_streak";
  localStorage.setItem(k, won ? String(parseInt(localStorage.getItem(k) || "0", 10) + 1) : "0");
}
function renderStats(){
  el("points").textContent = localStorage.getItem("puttle_points") || "0";
  el("streak").textContent = localStorage.getItem("puttle_daily_streak") || "0";
}

// ---------- share ----------
function shareText(){
  const rec = getDailyRecord();
  const grid = (rec && rec.grid) || guessRows;
  const emoji = s => s === "exact" ? "🟩" : s === "border" ? "🟧"
                   : (s === "close" || s === "continent") ? "🟨" : "⬜";
  const head = `Puttle ${dailyKey()} — ${rec && !rec.won ? "X" : (rec ? rec.guesses : guessCount)}/${TIERS.daily.guesses}`;
  const body = grid.map(row => row.map(emoji).join("")).join("\n");
  return `${head}\n${body}\nhttps://weiddle.com/golf`;
}
function doShare(){
  const txt = shareText();
  navigator.clipboard.writeText(txt).then(() => {
    el("share-copied").classList.remove("hidden");
    setTimeout(() => el("share-copied").classList.add("hidden"), 2000);
  });
}

// ---------- wiring ----------
function wireUI(){
  attachAutocomplete(
    el("guess-input"),
    () => DATA.map(g => g.name),
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
