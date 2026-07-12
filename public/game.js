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

const el = (id) => document.getElementById(id);

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

function newGame(){
  target = DATA[Math.floor(Math.random() * DATA.length)];
  guessed = new Set();
  guessCount = 0;
  solved = false;
  el("rows").innerHTML = "";
  el("reveal").classList.add("hidden");
  el("guess-input").value = "";
  el("guess-input").disabled = false;
  el("guess-input").focus();
  el("silhouette-img").src = target.headshot;
  startTimer();
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

  el("rows").appendChild(row);
}

function submitGuess(name){
  if (solved) return;
  const f = DATA.find(x => x.name.toLowerCase() === name.trim().toLowerCase());
  if (!f) return;
  if (guessed.has(f.name)) { el("guess-input").value=""; return; }
  guessed.add(f.name);
  guessCount++;
  renderGuess(f);
  el("guess-input").value = "";
  if (f.name === target.name) win();
}

function win(){
  solved = true;
  clearInterval(timerInterval);
  el("guess-input").disabled = true;

  // Streak (session-persistent via localStorage)
  let streak = parseInt(localStorage.getItem("octagonle_streak") || "0", 10) + 1;
  localStorage.setItem("octagonle_streak", String(streak));

  el("reveal-img").src = target.headshot;
  el("reveal-name").textContent = target.name;
  el("result-guesses").textContent = `${guessCount} guess${guessCount===1?"":"es"}`;
  el("result-streak").textContent = String(streak);
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
  el("reveal").classList.remove("hidden");
}

// ---------- Events ----------
el("guess-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitGuess(e.target.value);
});
el("guess-input").addEventListener("change", (e) => {
  // Fires when a datalist option is picked
  if (DATA.some(x => x.name === e.target.value)) submitGuess(e.target.value);
});
el("silhouette-btn").addEventListener("click", () => {
  el("silhouette-modal").classList.remove("hidden");
});
el("silhouette-modal").addEventListener("click", () => {
  el("silhouette-modal").classList.add("hidden");
});
el("play-again-btn").addEventListener("click", newGame);
el("share-btn").addEventListener("click", () => {
  const line = `Octagonle — solved in ${guessCount} guesses ⏱`;
  if (navigator.clipboard) navigator.clipboard.writeText(line);
  el("share-btn").textContent = "Copied!";
  setTimeout(() => el("share-btn").textContent = "↗ Share", 1500);
});

load();
