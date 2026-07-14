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

function mNorm(s){
  return (s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9 ]/g, "").trim().replace(/\s+/g, " ");
}

async function startMoments(){
  await momentsReady;
  buildMomentsAutocomplete();
  mScore = 0;
  mPlayed = 0;
  updateMomentsScore();
  nextMoment();
}

// Suggest any roster fighter plus every fighter named in a moment.
function buildMomentsAutocomplete(){
  const names = new Set();
  if (Array.isArray(DATA)) DATA.forEach(f => names.add(f.name));
  MOMENTS.forEach(m => { names.add(m.fighter1); names.add(m.fighter2); });
  el("moments-fighter-list").innerHTML =
    [...names].sort().map(n => `<option value="${n}"></option>`).join("");
}

function updateMomentsScore(){
  el("m-score").textContent =
    `Score: ${mScore}  ·  Best: ${mBest}  ·  Moments: ${mPlayed}`;
}

function nextMoment(){
  let m;
  do { m = MOMENTS[Math.floor(Math.random() * MOMENTS.length)]; }
  while (MOMENTS.length > 1 && m === mCurrent);
  mCurrent = m;

  const tags = [];
  if (m.weightClass) tags.push(m.title ? `${m.weightClass} Championship` : m.weightClass);
  if (m.venue) tags.push(m.venue);
  el("m-tags").innerHTML = tags.map(t => `<span class="chip">${t}</span>`).join("");
  el("m-clue").textContent = m.clue;

  for (const id of ["m-event", "m-f1", "m-f2", "m-year"]) el(id).value = "";
  el("m-reveal").classList.add("hidden");
  el("m-submit").disabled = false;
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

  mScore += pts;
  mPlayed += 1;
  if (mScore > mBest){ mBest = mScore; localStorage.setItem("octagonle_moments_best", String(mBest)); }
  updateMomentsScore();

  const mark = ok => ok ? "✓" : "✗";
  el("m-points").textContent = `+${pts} point${pts === 1 ? "" : "s"} this moment`;
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
