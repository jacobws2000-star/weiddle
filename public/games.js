"use strict";

// Shared game switcher for weiddle.com.
//   One registry of every game on the site + one "🎮 Games" button and modal,
//   injected into each page's top bar. This replaces the old per-page cross-game
//   nav links (which added one link to every top bar per game — clutter that got
//   worse with each new game, worst on mobile). Adding a game later is a one-line
//   edit to GAMES below.
//
//   Loaded with an ABSOLUTE path (<script src="/games.js">) so the same file runs
//   from /, /movies/, and /golf/. Reuses the shared .mode-modal / .mode-card /
//   .mode-option chrome from styles.css (the movies/golf stylesheets @import it),
//   so no per-page styling is needed beyond the tiny anchor tweaks injected here.

(function () {
  const GAMES = [
    { id: "weiddle", emoji: "🥊", name: "Weiddle", path: "/",
      blurb: "Guess the mystery UFC fighter." },
    { id: "cindle", emoji: "🎬", name: "Cindle", path: "/movies/",
      blurb: "Guess the mystery movie." },
    { id: "puttle", emoji: "⛳", name: "Puttle", path: "/golf/",
      blurb: "Guess the mystery PGA Tour golfer." },
  ];

  // Which game is this page? Longest non-root path prefix wins; fall back to root.
  const path = location.pathname;
  const matches = (g) =>
    g.path !== "/" && (path.startsWith(g.path) || path === g.path.slice(0, -1));
  const current = GAMES.find(matches) || GAMES.find((g) => g.id === "weiddle");

  function build() {
    const bar = document.querySelector(".topbar");
    if (!bar || document.getElementById("games-btn")) return;

    // Anchors need de-linking to look like the .mode-option buttons; the current
    // game's entry is a non-navigating div. The blurb uses a dedicated class, NOT
    // .mode-desc: the movie/golf pages repurpose .mode-desc as cream page text, so
    // reusing it here would render the blurb cream-on-cream (invisible). Scoped
    // <style> keeps everything in this one file.
    const style = document.createElement("style");
    style.textContent =
      "a.mode-option{text-decoration:none;color:inherit;display:block;}" +
      ".games-blurb{font-size:14px;color:#4a4658;margin-top:4px;}" +
      ".mode-option.selected .games-blurb{color:var(--ink);}" +
      ".games-here{display:inline-block;margin-top:6px;font-size:12px;font-weight:700;" +
      "background:var(--ink);color:var(--cream);border-radius:6px;padding:2px 8px;}";
    document.head.appendChild(style);

    // "🎮 Games" button — sits just before the trailing status widgets (timer /
    // streak / points), i.e. after the action buttons, on every page.
    const btn = document.createElement("button");
    btn.id = "games-btn";
    btn.className = "btn";
    btn.innerHTML = '<span class="ico">🎮</span> Games';
    const anchor = bar.querySelector(".timer, .stat-box, #status, #timer");
    if (anchor) bar.insertBefore(btn, anchor);
    else bar.appendChild(btn);

    // Modal.
    const modal = document.createElement("div");
    modal.id = "games-modal";
    modal.className = "mode-modal hidden";
    const options = GAMES.map((g) => {
      const here = g.id === current.id;
      const inner =
        '<div class="mode-name">' + g.emoji + " " + g.name + "</div>" +
        '<div class="games-blurb">' + g.blurb + "</div>" +
        (here ? '<div><span class="games-here">You’re here</span></div>' : "");
      return here
        ? '<div class="mode-option selected">' + inner + "</div>"
        : '<a class="mode-option" href="' + g.path + '">' + inner + "</a>";
    }).join("");
    modal.innerHTML =
      '<div class="mode-card">' +
        '<div class="mode-title">🎮 Switch Game</div>' +
        "<hr>" +
        options +
        '<button id="games-close" class="btn">Close</button>' +
      "</div>";
    document.body.appendChild(modal);

    const open = () => modal.classList.remove("hidden");
    const close = () => modal.classList.add("hidden");
    btn.addEventListener("click", open);
    document.getElementById("games-close").addEventListener("click", close);
    modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !modal.classList.contains("hidden")) close();
    });
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", build);
  else build();
})();
