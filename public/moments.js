"use strict";

// Defining Moments: a clue-based trivia mode. A famous numbered UFC main event is
// described by spoiler-free clues; the player guesses the event number, both
// fighters, and the year for up to 4 points. Endless, with a running/best score.
// Reuses `el` and `DATA` from game.js (loaded first).

let MOMENTS = [];
// no-cache: revalidate on each load so a redeployed set shows immediately.
const momentsReady = fetch("moments.json", { cache: "no-cache" })
  .then(r => r.json()).then(j => { MOMENTS = j.moments; });

let mCurrent = null;
let mScore = 0;
let mPlayed = 0;
let mBest = parseInt(localStorage.getItem("octagonle_moments_best") || "0", 10);

// Daily Moments: a fixed seeded set played once per UTC day.
const DAILY_MOMENTS_N = 5;
const MOMENT_CLUES = 4;   // event #, fighter 1, fighter 2, year
let mDaily = false, mDailySet = [], mDailyIdx = 0;
function seededMoments(n){
  const rng = seededRng(dailyKey() + "|moments");  // helpers from game.js
  const arr = MOMENTS.slice();
  for (let i = arr.length - 1; i > 0; i--){
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, n);
}

function mNorm(s){
  return (s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9 ]/g, "").trim().replace(/\s+/g, " ");
}

async function startMoments(){
  await momentsReady;
  buildMomentsAutocomplete();
  mScore = 0;
  mPlayed = 0;
  mDaily = (typeof playStyle !== "undefined" && playStyle === "daily");
  if (mDaily){
    const rec = getDailyRecord("moments");
    if (rec && rec.done){ el("moments-view").classList.add("hidden"); showDailyLocked(); return; }
    mDailySet = seededMoments(DAILY_MOMENTS_N);
    mDailyIdx = 0;
  }
  updateMomentsScore();
  nextMoment();
}

function finishDailyMoments(){
  setDailyRecord("moments", { done: true, score: mScore, max: DAILY_MOMENTS_N * MOMENT_CLUES });
  updateDailyStreak(true);
  el("moments-view").classList.add("hidden");
  showDailyLocked();       // defined in game.js
}

// Suggest any roster fighter plus every fighter named in a moment. Uses the
// shared mobile-friendly dropdown from game.js (attachAutocomplete) instead of
// a <datalist>, which doesn't render suggestions reliably on phones.
function buildMomentsAutocomplete(){
  if (buildMomentsAutocomplete._done) return;   // attach the widgets once
  buildMomentsAutocomplete._done = true;
  const names = new Set();
  if (Array.isArray(DATA)) DATA.forEach(f => names.add(f.name));
  MOMENTS.forEach(m => { names.add(m.fighter1); names.add(m.fighter2); });
  const sorted = [...names].sort();
  const getNames = () => sorted;
  attachAutocomplete(el("m-f1"), getNames, () => {});
  attachAutocomplete(el("m-f2"), getNames, () => {});
}

function updateMomentsScore(){
  el("m-score").textContent = mDaily
    ? `Daily · Moment ${Math.min(mDailyIdx || 1, DAILY_MOMENTS_N)} / ${DAILY_MOMENTS_N}  ·  Score: ${mScore}`
    : `Score: ${mScore}  ·  Best: ${mBest}  ·  Moments: ${mPlayed}`;
}

function nextMoment(){
  let m;
  if (mDaily){
    if (mDailyIdx >= mDailySet.length){ finishDailyMoments(); return; }
    m = mDailySet[mDailyIdx++];
  } else {
    do { m = MOMENTS[Math.floor(Math.random() * MOMENTS.length)]; }
    while (MOMENTS.length > 1 && m === mCurrent);
  }
  mCurrent = m;

  const tags = [];
  if (m.weightClass) tags.push(m.title ? `${m.weightClass} Championship` : m.weightClass);
  if (m.venue) tags.push(m.venue);
  el("m-tags").innerHTML = tags.map(t => `<span class="chip">${t}</span>`).join("");
  el("m-clue").textContent = m.clue;

  for (const id of ["m-event", "m-f1", "m-f2", "m-year"]) el(id).value = "";
  el("m-reveal").classList.add("hidden");
  el("m-submit").disabled = false;
  updateMomentsScore();
  el("m-event").focus();
}

function submitMoment(){
  if (!mCurrent || el("m-submit").disabled) return;
  const m = mCurrent;
  const gEvent = parseInt(el("m-event").value, 10);
  const gYear = parseInt(el("m-year").value, 10);

  const gotEvent = Number.isFinite(gEvent) && Math.abs(gEvent - m.eventNumber) <= 1;
  const gotYear = Number.isFinite(gYear) && Math.abs(gYear - m.year) <= 1;

  // Fighters: order-independent set match, each worth a point.
  const target = [mNorm(m.fighter1), mNorm(m.fighter2)];
  const used = [false, false];
  const matched = [false, false];  // which entered input matched
  [mNorm(el("m-f1").value), mNorm(el("m-f2").value)].forEach((entry, idx) => {
    if (!entry) return;
    for (let i = 0; i < 2; i++){
      if (!used[i] && entry === target[i]){ used[i] = true; matched[idx] = true; break; }
    }
  });
  const fighterPts = used.filter(Boolean).length;
  const pts = (gotEvent ? 1 : 0) + (gotYear ? 1 : 0) + fighterPts;

  // Account points scale with the SHARE of clues solved, against the mode's
  // base score: 4/4 -> 50, 3/4 -> 38, 2/4 -> 25, 1/4 -> 13, 0/4 -> 0.
  // mScore stays the raw clue tally, since Best and the Daily record's max
  // (DAILY_MOMENTS_N * MOMENT_CLUES) are both counted in clues.
  const awarded = Math.round((pts / MOMENT_CLUES) * WIN_POINTS.moments);

  mScore += pts;
  mPlayed += 1;
  // Lifetime account points — from game.js.
  // Daily Moments get the Daily boost (DAILY_BOOST, defined in game.js).
  addPoints(mDaily ? awarded * DAILY_BOOST : awarded);
  if (mScore > mBest){ mBest = mScore; localStorage.setItem("octagonle_moments_best", String(mBest)); }
  updateMomentsScore();

  const mark = ok => ok ? "✓" : "✗";
  el("m-points").textContent =
    `+${mDaily ? awarded * DAILY_BOOST : awarded} points  ·  ${pts}/${MOMENT_CLUES} clues (${Math.round(100 * pts / MOMENT_CLUES)}%)`;
  el("m-answer").innerHTML =
    `<div class="ma-row ${gotEvent ? "hit" : "miss"}">${mark(gotEvent)} Event — <b>UFC ${m.eventNumber}</b></div>` +
    `<div class="ma-row ${used[0] || used[1] ? "hit" : "miss"}">${mark(fighterPts > 0)} Fighters — <b>${m.fighter1}</b> vs <b>${m.fighter2}</b> <span class="ma-sub">(${fighterPts}/2)</span></div>` +
    `<div class="ma-row ${gotYear ? "hit" : "miss"}">${mark(gotYear)} Year — <b>${m.year}</b></div>`;
  el("m-reveal").classList.remove("hidden");
  el("m-submit").disabled = true;
  el("m-next").focus();
}

// ---------- events ----------
el("m-submit").addEventListener("click", submitMoment);
el("m-next").addEventListener("click", nextMoment);
// Enter anywhere in the form submits (or advances once revealed).
["m-event", "m-f1", "m-f2", "m-year"].forEach(id =>
  el(id).addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    if (el("m-submit").disabled) nextMoment(); else submitMoment();
  }));
