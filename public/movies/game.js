"use strict";

// Cindle — movie-guessing game.
//   Modes: Daily (one shared seeded puzzle per UTC day, one-and-done) + three
//   endless difficulty tiers gated on fame (voteCount). Scoring/streak in
//   localStorage under a cindle_ prefix (kept fully separate from the UFC game's
//   octagonle_ keys, which share the same origin).

// Numeric "close" thresholds (|diff| <= threshold and not equal => yellow).
const NUM_CLOSE = { year: 3, runtime: 10, rating: 0.3, oscars: 1 };

// Difficulty tiers. minVotes gates the pool by fame; Daily draws from the Normal
// (most-recognizable) pool so the shared puzzle stays fair. Guess limits scale
// with how deep the pool goes. Thresholds tuned against the real ~1980-film
// vote_count spread (2.7k–40.6k), a roughly-doubling ladder:
// Normal >=10k (~373 famous films), Hard >=5k (~1020), Extreme all (~1980).
const TIERS = {
  daily:   { label: "Daily",   minVotes: 10000, guesses: 8,  endless: false,
             desc: "One movie a day, same for everyone. Drawn from the famous pool." },
  normal:  { label: "Normal",  minVotes: 10000, guesses: 8,  endless: true,
             desc: "The most famous, widely-seen films. 8 guesses." },
  hard:    { label: "Hard",    minVotes: 5000,  guesses: 10, endless: true,
             desc: "Broader — solid hits and older classics. 10 guesses." },
  extreme: { label: "Extreme", minVotes: 0,     guesses: 12, endless: true,
             desc: "The whole pool, deep cuts included. 12 guesses." },
};

let DATA = [];
let mode = localStorage.getItem("cindle_mode") || "daily";
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

// ---------- deterministic daily seeding (mirrors the UFC game) ----------
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

// ---------- pools ----------
function poolFor(m){ return DATA.filter(x => (x.voteCount || 0) >= TIERS[m].minVotes); }
function maxAttempts(){ return TIERS[mode].guesses; }

// ---------- boot ----------
async function boot(){
  const res = await fetch("../movies.json", { cache: "no-cache" });
  const j = await res.json();
  DATA = j.movies || [];
  buildDatalist();
  wireUI();
  renderStats();
  selectMode(mode);
}

function buildDatalist(){
  el("titles").innerHTML = DATA
    .map(m => `<option value="${esc(m.title)}"></option>`)
    .join("");
}

// ---------- mode handling ----------
function selectMode(m){
  mode = TIERS[m] ? m : "daily";
  localStorage.setItem("cindle_mode", mode);
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
  target = pool[Math.floor(Math.random() * pool.length)];
  resetBoard();
  el("guess-input").disabled = false;
  el("guess-input").focus();
  showGiveUp(true);
}

// Daily: same film for everyone on a given UTC day; one-and-done, resumable.
function startDaily(){
  const pool = poolFor("daily").slice().sort((a, b) => a.id - b.id); // stable order
  const rng = mulberry32(hashStr(dailyKey() + "-cindle"));
  target = pool[Math.floor(rng() * pool.length)];
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
function boxCompare(g, t){
  if (g == null || t == null) return { status: "none", arrow: "" };
  if (g === t) return { status: "exact", arrow: "" };
  const arrow = t > g ? "↑" : "↓";
  const ratio = g > t ? g / t : t / g;
  return { status: ratio <= 2 ? "close" : "none", arrow };
}
function genreCompare(g, t){
  const ts = new Set(t);
  if (g.length === t.length && g.every(x => ts.has(x))) return "exact";
  return g.some(x => ts.has(x)) ? "close" : "none";
}
// First initial of a person's first (given) name, lower-cased. "" if unknown.
function firstInitial(name){
  const first = String(name || "").trim().split(/\s+/)[0] || "";
  return first.charAt(0).toLowerCase();
}
// Director / Lead Actor grading, warmest match wins:
//   exact  (green)  same person
//   letter (orange) same first-name initial as the answer's
//   gender (yellow) same gender as the answer's   (TMDB: 1 F, 2 M, 3 NB; 0 unknown)
//   none            no signal
function personCompare(gName, tName, gGender, tGender){
  if (gName != null && gName === tName) return "exact";
  const gi = firstInitial(gName), ti = firstInitial(tName);
  if (gi && gi === ti) return "letter";
  if (gGender && tGender && gGender === tGender) return "gender";
  return "none";
}
function money(n){
  if (n == null) return "—";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return "$" + Math.round(n / 1e6) + "M";
  if (n >= 1e3) return "$" + Math.round(n / 1e3) + "K";
  return "$" + n;
}

function cell(display, status, arrow, label){
  const arr = arrow ? ` <span class="arrow">${arrow}</span>` : "";
  const l = label ? ` data-label="${label}"` : "";
  if (status === "exact")  return `<div class="cell"${l}><span class="chip green">${display} ✓</span></div>`;
  if (status === "close")  return `<div class="cell"${l}><span class="chip yellow">${display}${arr || " ≈"}</span></div>`;
  if (status === "letter") return `<div class="cell"${l}><span class="chip orange">${display}</span></div>`;
  if (status === "gender") return `<div class="cell"${l}><span class="chip yellow">${display}</span></div>`;
  return `<div class="cell"${l}><span class="val">${display}${arr}</span></div>`;
}

// Returns the 7 column statuses so the same call renders a row and records the
// share grid (order: Year Genre Runtime Director Lead Box IMDb).
function renderGuess(m){
  const year    = numCompare(m.year, target.year, "year");
  const runtime = numCompare(m.runtime, target.runtime, "runtime");
  const rating  = numCompare(m.rating, target.rating, "rating");
  const oscars  = numCompare(m.oscarsWon, target.oscarsWon, "oscars");
  const box     = boxCompare(m.boxOffice, target.boxOffice);
  const gen     = genreCompare(m.genres, target.genres);
  const dir     = personCompare(m.director, target.director, m.directorGender, target.directorGender);
  const act     = personCompare(m.leadActor, target.leadActor, m.leadActorGender, target.leadActorGender);

  const row = document.createElement("div");
  row.className = "guess-row";
  row.innerHTML =
    `<div class="cell cell-name">${esc(m.title)} <span class="yr">(${m.year})</span></div>` +
    cell(m.year, year.status, year.arrow, "Year") +
    cell(esc(m.genres.join(" / ")), gen, "", "Genre") +
    cell(m.runtime + "m", runtime.status, runtime.arrow, "Runtime") +
    cell(esc(m.director), dir, "", "Director") +
    cell(esc(m.leadActor), act, "", "Lead Actor") +
    cell(money(m.boxOffice), box.status, box.arrow, "Box Office") +
    cell(m.rating != null ? m.rating.toFixed(1) : "—", rating.status, rating.arrow, "IMDb") +
    cell(m.oscarsWon, oscars.status, oscars.arrow, "Oscars");
  el("rows").appendChild(row);

  return [year.status, gen, runtime.status, dir, act, box.status, rating.status, oscars.status];
}

// ---------- guess handling ----------
function matchMovie(val){
  const v = val.trim().toLowerCase();
  return DATA.find(x => `${x.title} (${x.year})`.toLowerCase() === v)
      || DATA.find(x => x.title.toLowerCase() === v)
      || null;
}

function submitGuess(val){
  if (solved) return;
  const m = matchMovie(val);
  if (!m) return;
  if (guessed.has(m.id)) { el("guess-input").value = ""; return; }
  guessed.add(m.id);
  guessCount++;
  el("guess-input").value = "";
  guessRows.push(renderGuess(m));
  const won = m.id === target.id;
  if (won || guessCount >= maxAttempts()) endGame(won);
  updateStatus();
}

// Reveal the answer without spending a guess; ends the round as a loss.
function giveUp(){
  if (solved) return;
  endGame(false, true);
}

function endGame(won, gaveUp = false){
  solved = true;
  el("guess-input").disabled = true;
  showGiveUp(false);
  if (mode === "daily"){
    setDailyRecord({ won, guesses: guessCount, answer: `${target.title} (${target.year})`, grid: guessRows, gaveUp });
    updateDailyStreak(won);
    if (won) addPoints(TIERS.daily.guesses - guessCount + 3);
    showDailyPanel(won, null, gaveUp);
  } else {
    if (won){ addPoints(scoreFor()); bumpStreak(true); } else bumpStreak(false);
    const r = el("reveal");
    r.className = "reveal" + (won ? " win" : "");
    r.innerHTML = won
      ? `<div class="reveal-title">🎉 Got it in ${guessCount}!</div>
         <div>${esc(target.title)} (${target.year}) — dir. ${esc(target.director)}</div>`
      : `<div class="reveal-title">${gaveUp ? "Gave up" : "Out of guesses"}</div>
         <div>It was <b>${esc(target.title)} (${target.year})</b> — dir. ${esc(target.director)}, ${esc(target.leadActor)}.</div>`;
  }
  renderStats();
}

function scoreFor(){
  // Base by tier, bonus for solving with guesses to spare.
  const base = { normal: 60, hard: 100, extreme: 150 }[mode] || 60;
  return Math.round(base * (1 + (maxAttempts() - guessCount) / maxAttempts()));
}

// ---------- Daily state ----------
function dailyRecordKey(){ return `cindle_daily_${dailyKey()}`; }
function getDailyRecord(){ try { return JSON.parse(localStorage.getItem(dailyRecordKey()) || "null"); } catch { return null; } }
function setDailyRecord(rec){ localStorage.setItem(dailyRecordKey(), JSON.stringify(rec)); }

function updateDailyStreak(won){
  const today = dailyKey();
  if (localStorage.getItem("cindle_daily_counted") === today) return;
  let streak = parseInt(localStorage.getItem("cindle_daily_streak") || "0", 10);
  if (won){
    streak = (localStorage.getItem("cindle_daily_lastwin") === prevDay(today)) ? streak + 1 : 1;
    localStorage.setItem("cindle_daily_lastwin", today);
  } else streak = 0;
  localStorage.setItem("cindle_daily_streak", String(streak));
  localStorage.setItem("cindle_daily_counted", today);
}

// Re-render a Daily that was already completed today, then show the locked panel.
function replayDaily(rec){
  el("guess-input").disabled = true;
  showGiveUp(false);
  guessRows = rec.grid || [];
  // We don't persist the actual guessed films, only the grid — so redraw the grid
  // rows from stored statuses (title hidden as "•••" isn't worth the storage).
  showDailyPanel(rec.won, rec);
}

function showDailyPanel(won, rec, gaveUp = false){
  const guesses = rec ? rec.guesses : guessCount;
  const answer = rec ? rec.answer : `${target.title} (${target.year})`;
  const gave = rec ? rec.gaveUp : gaveUp;   // a resumed record remembers how it ended
  el("daily-title").textContent = won ? "Daily solved! 🎉" : "Daily complete";
  el("daily-sub").innerHTML = won
    ? `Solved in ${guesses} guess${guesses === 1 ? "" : "es"}.`
    : `${gave ? "Gave up" : "Out of guesses"} — it was <b>${esc(answer)}</b>.`;
  el("daily-streak").textContent = localStorage.getItem("cindle_daily_streak") || "0";
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
  const p = parseInt(localStorage.getItem("cindle_points") || "0", 10) + n;
  localStorage.setItem("cindle_points", String(p));
}
function bumpStreak(won){
  const k = "cindle_win_streak";
  localStorage.setItem(k, won ? String(parseInt(localStorage.getItem(k) || "0", 10) + 1) : "0");
}
function renderStats(){
  el("points").textContent = localStorage.getItem("cindle_points") || "0";
  el("streak").textContent = localStorage.getItem("cindle_daily_streak") || "0";
}

// ---------- share ----------
function shareText(){
  const rec = getDailyRecord();
  const grid = (rec && rec.grid) || guessRows;
  const emoji = s => s === "exact" ? "🟩" : s === "letter" ? "🟧"
                   : (s === "close" || s === "gender") ? "🟨" : "⬜";
  const head = `Cindle ${dailyKey()} — ${rec && !rec.won ? "X" : (rec ? rec.guesses : guessCount)}/${TIERS.daily.guesses}`;
  const body = grid.map(row => row.map(emoji).join("")).join("\n");
  return `${head}\n${body}\nhttps://weiddle.com/movies`;
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
  const input = el("guess-input");
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); submitGuess(input.value); }
  });
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
