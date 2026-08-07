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

// ---------- Moment enrichment (age + first-title-bout clues) ----------
// Both are derived at render time from DATA (game.js) so moments.json stays the
// curated source and the tags never drift from the dataset. Deterministic across
// clients (same DATA + MOMENTS everywhere), so Daily's shared set stays identical.
let _mDataIdx = null;
function mDataIndex(){
  if (_mDataIdx) return _mDataIdx;
  _mDataIdx = new Map();
  if (Array.isArray(DATA)) for (const f of DATA){
    const k = mNorm(f.name);
    if (k && !_mDataIdx.has(k)) _mDataIdx.set(k, f);   // first spelling wins the key
  }
  return _mDataIdx;
}
function mLookup(name){ return mDataIndex().get(mNorm(name)) || null; }
function mAgeInYear(f, year){
  if (!f || !f.dob || !year) return null;
  const born = parseInt(String(f.dob).slice(0, 4), 10);
  return Number.isFinite(born) ? year - born : null;   // year-based (no fight date), so ±1
}
function mSurname(name){ const t = mNorm(name).split(" "); return t[t.length - 1] || ""; }
function mSameFighter(a, b){ return mNorm(a) === mNorm(b) || mSurname(a) === mSurname(b); }
// Interim vs undisputed rides on the bout's `division` prefix (titleDivision is null
// in the dataset), e.g. "Interim Welterweight" vs "Welterweight".
function mBeltType(bout){
  const d = bout.division || bout.weightClass || "";
  return /^interim\b/i.test(d) ? "Interim" : "Undisputed";
}
function mPairKey(m){ return [mNorm(m.fighter1), mNorm(m.fighter2)].sort().join("|"); }
// Returns the matched bout if THIS moment is `fighter`'s first UFC title bout, else
// null. Their earliest title bout (titleBouts is oldest-first) must land in the
// moment's year against the moment's other fighter. Same-year rematches vs the same
// opponent are byte-identical in the dataset (no date), so they're disambiguated by
// event order within MOMENTS: the lower event number is the first fight.
function mFirstTitleBout(fighter, oppName, m){
  const tb = fighter && fighter.titleBouts;
  if (!tb || !tb.length) return null;
  const b0 = tb[0];
  if (b0.year !== m.year || !mSameFighter(b0.opponent || "", oppName)) return null;
  const dup = tb.filter(b => b.year === m.year && mSameFighter(b.opponent || "", oppName)).length;
  if (dup > 1){
    const earlier = MOMENTS.some(m2 =>
      m2 !== m && m2.title && m2.year === m.year &&
      mPairKey(m2) === mPairKey(m) && m2.eventNumber < m.eventNumber);
    if (earlier) return null;
  }
  return b0;
}
// The chip row for a moment: division/venue (as before) + ages + a first-title tag.
// The title tag never names the fighter — that would leak an answer.
function momentTags(m){
  const tags = [];
  if (m.weightClass) tags.push(m.title ? `${m.weightClass} Championship` : m.weightClass);
  if (m.venue) tags.push(m.venue);

  const f1 = mLookup(m.fighter1), f2 = mLookup(m.fighter2);
  const ages = [mAgeInYear(f1, m.year), mAgeInYear(f2, m.year)]
    .filter(a => a != null).sort((x, y) => x - y);   // sorted so order doesn't hint who's who
  if (ages.length === 2) tags.push(`🎂 Ages ${ages[0]} & ${ages[1]}`);
  else if (ages.length === 1) tags.push(`🎂 Age ${ages[0]}`);

  const t1 = f1 && mFirstTitleBout(f1, m.fighter2, m);
  const t2 = f2 && mFirstTitleBout(f2, m.fighter1, m);
  const t = t1 || t2;
  if (t){
    const who = (t1 && t2) ? "Both fighters' first title fight" : "A fighter's first title fight";
    tags.push(`🏆 ${who} · ${mBeltType(t)}`);
  }
  return tags;
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
  // Keyed by mNorm, not by the raw string: the roster and the moments spell the
  // same fighter differently ("Yair Rodriguez" vs "Yair Rodríguez", "BJ Penn" vs
  // "B.J. Penn"), so a Set of raw names offers both spellings as separate
  // suggestions. mNorm is what scoring compares, so either spelling is correct —
  // the duplicate is purely cosmetic. DATA is added first and wins the key, which
  // keeps the dropdown on the roster spelling used everywhere else on the site.
  const byKey = new Map();
  const add = n => { const k = mNorm(n); if (k && !byKey.has(k)) byKey.set(k, n); };
  if (Array.isArray(DATA)) DATA.forEach(f => add(f.name));
  MOMENTS.forEach(m => { add(m.fighter1); add(m.fighter2); });
  const sorted = [...byKey.values()].sort();
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

  el("m-tags").innerHTML = momentTags(m).map(t => `<span class="chip">${t}</span>`).join("");
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
  // No Corner Coins here — Moments earns account points only, never hint coins.
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
