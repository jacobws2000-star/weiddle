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

// Nationality -> continent, so "close" nationality = same continent.
// Covers every nationality present in fighters.json (kept in sync with the data).
const CONTINENT = {
  // North America
  "USA":"NA","Canada":"NA","Mexico":"NA","Cuba":"NA","Jamaica":"NA","Haiti":"NA",
  "Dominican Republic":"NA","Puerto Rico":"NA","Panama":"NA","Aruba":"NA","Guam":"NA",
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
  "Türkiye":"EU",
  // Asia
  "China":"AS","Japan":"AS","South Korea":"AS","Korea":"AS","Kazakhstan":"AS",
  "Philippines":"AS","Thailand":"AS","India":"AS","Mongolia":"AS","Kyrgyzstan":"AS",
  "Uzbekistan":"AS","Tajikistan":"AS","Afghanistan":"AS","Bahrain":"AS","Hong Kong":"AS",
  "Indonesia":"AS","Iraq":"AS","Israel":"AS","Lebanon":"AS","Myanmar":"AS","Palestine":"AS",
  "United Arab Emirates":"AS","Vietnam":"AS",
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
let target = null;
let guessed = new Set();
let guessCount = 0;
let solved = false;
let startTime = null;
let timerInterval = null;

// Game mode: "classic" | "title-normal" | "title-hard"
let mode = localStorage.getItem("octagonle_mode") || "classic";
const TITLE_MAX_ATTEMPTS = 6;

const el = (id) => document.getElementById(id);
const isTitleMode = () => mode === "title-normal" || mode === "title-hard";

function ageFromDob(dob){
  if (!dob) return null;
  const d = new Date(dob);
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
  return a;
}

async function load(){
  const res = await fetch("fighters.json");
  const json = await res.json();
  DATA = json.fighters.filter(f => f.heightIn && f.debutYear);
  // Populate autocomplete
  const dl = el("fighter-list");
  dl.innerHTML = DATA.map(f => `<option value="${f.name}">`).join("");
  newGame();
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

function fighterWeight(f){
  // floor of 1 so nobody is impossible; cap at WIN_CAP so 40 wins == 30 wins
  const wins = Math.min(Math.max(f.wins || 0, 1), WIN_CAP);
  let w = Math.pow(wins, WIN_EXP);
  if (f.isChampion) w *= CHAMP_BOOST;
  if (f.topTen) w *= TOP10_BOOST;   // stacks: a top-10 champ gets 1.25 * 1.75
  return w;
}

function pickTarget(){
  const total = DATA.reduce((s, f) => s + fighterWeight(f), 0);
  let r = Math.random() * total;
  for (const f of DATA){
    r -= fighterWeight(f);
    if (r <= 0) return f;
  }
  return DATA[DATA.length - 1];
}

// Title Defense targets: any champion with at least one completed title bout.
function pickChampion(){
  const pool = DATA.filter(f => f.isChampion && f.titleBouts && f.titleBouts.length);
  return pool[Math.floor(Math.random() * pool.length)];
}

function newGame(){
  guessed = new Set();
  guessCount = 0;
  solved = false;
  el("reveal").classList.add("hidden");
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
    target = pickTarget();
    el("rows").innerHTML = "";
  }
  el("guess-input").focus();
  startTimer();
}

function renderCluePanel(){
  // Hard: only the first UFC title bout. Normal: the first three (1st/2nd/3rd),
  // chronological (titleBouts is oldest-first).
  const bouts = mode === "title-hard"
    ? target.titleBouts.slice(0, 1)
    : target.titleBouts.slice(0, 3);
  el("clue-caption").textContent = mode === "title-hard"
    ? "First UFC title bout" : "First three UFC title bouts";
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
  el("attempts").textContent = `Guesses: ${guessCount} / ${TITLE_MAX_ATTEMPTS}`;
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

// Build one comparison cell. kind: exact|close|none plus optional arrow.
function cell(display, status, arrow){
  const arr = arrow ? `<span class="arrow">${arrow}</span>` : "";
  if (status === "exact") return `<div class="cell"><span class="chip green">${display} ✓</span></div>`;
  if (status === "close") return `<div class="cell"><span class="chip yellow">${display} ${arr||"≈"}</span></div>`;
  return `<div class="cell">${display} ${arr}</div>`;
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

  // Division (weight class)
  const gi = wcIndex(f.weightClass), ti = wcIndex(target.weightClass);
  let divStatus = "none", divArrow = "";
  if (f.weightClass === target.weightClass) divStatus = "exact";
  else if (gi >= 0 && ti >= 0){
    divArrow = ti > gi ? "↑" : "↓";
    if (Math.abs(ti - gi) === 1) divStatus = "close";
  }

  // Nationality
  let natStatus = "none";
  if (f.nationality === target.nationality) natStatus = "exact";
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

  // Champion (boolean)
  const champStatus = f.isChampion === target.isChampion ? "exact" : "none";
  const champTxt = f.isChampion ? "Yes" : "No";

  row.innerHTML =
    `<div class="cell cell-name">${f.name}</div>` +
    cell(f.weightClass.replace(/Women's\s+/i,"W "), divStatus, divArrow) +
    cell(f.nationality, natStatus, "") +
    cell(f.wins, wins.status, wins.arrow) +
    cell(f.losses, losses.status, losses.arrow) +
    cell(f.displayHeight || `${f.heightIn}"`, height.status, height.arrow) +
    cell(gAge ?? "?", age.status, age.arrow) +
    cell(f.stance || "—", stanceStatus, "") +
    cell(f.debutYear, debut.status, debut.arrow) +
    cell(champTxt, champStatus, "");

  el(isTitleMode() ? "title-rows" : "rows").appendChild(row);
}

function submitGuess(name){
  if (solved) return;
  const f = DATA.find(x => x.name.toLowerCase() === name.trim().toLowerCase());
  if (!f) return;
  if (guessed.has(f.name)) { el("guess-input").value=""; return; }
  guessed.add(f.name);
  guessCount++;
  el("guess-input").value = "";

  if (isTitleMode()){
    renderGuess(f);              // same classic comparison columns vs the champion
    el("title-grid").classList.remove("hidden");
    updateAttempts();
    if (f.name === target.name) win();
    else if (guessCount >= TITLE_MAX_ATTEMPTS) lose();
    return;
  }

  renderGuess(f);
  if (f.name === target.name) win();
}

function lose(){
  solved = true;
  clearInterval(timerInterval);
  el("guess-input").disabled = true;
  // Reveal the answer as a comparison row so its columns are shown (all green).
  if (isTitleMode() && !guessed.has(target.name)){
    renderGuess(target);
    el("title-grid").classList.remove("hidden");
  }
  showReveal(false);
}

function win(){
  // Streak (session-persistent via localStorage)
  let streak = parseInt(localStorage.getItem("octagonle_streak") || "0", 10) + 1;
  localStorage.setItem("octagonle_streak", String(streak));
  solved = true;
  clearInterval(timerInterval);
  el("guess-input").disabled = true;
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
  if (!won) localStorage.setItem("octagonle_streak", "0");

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
      ["Champ", target.isChampion ? "Yes" : "No"],
    ];
    el("reveal-stats").innerHTML = stats
      .map(([k,v]) => `<div><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");
  }
  el("reveal").classList.remove("hidden");
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
    const div = b.weightClass || b.division || "";
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
el("guess-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitGuess(e.target.value);
});
el("guess-input").addEventListener("change", (e) => {
  // Fires when a datalist option is picked
  if (DATA.some(x => x.name === e.target.value)) submitGuess(e.target.value);
});
el("play-again-btn").addEventListener("click", newGame);
el("share-btn").addEventListener("click", () => {
  const label = mode === "classic" ? "Octagonle" : "Octagonle Title Defense";
  const line = `${label} — solved in ${guessCount} guesses ⏱`;
  if (navigator.clipboard) navigator.clipboard.writeText(line);
  el("share-btn").textContent = "Copied!";
  setTimeout(() => el("share-btn").textContent = "↗ Share", 1500);
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

load();
