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
    { id: "footle", emoji: "⚽", name: "Footle", path: "/footle/",
      blurb: "Guess the Premier League starter." },
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

// ---------------------------------------------------------------------------
// Shared "Apple-friendly" share.  Old behaviour just copied text to the
// clipboard; on iOS that means a bare text bubble in Messages. Here we render
// the round to a PNG card and hand it to the native share sheet as a *file*, so
// iMessage (and other apps) show the picture inline. Text-share and clipboard
// are kept as graceful fallbacks for browsers without file sharing.
//
// iOS gotcha: navigator.share() must run inside the same synchronous turn as the
// click, or it throws NotAllowedError ("user gesture required"). So the whole
// card is drawn and turned into a File synchronously (toDataURL, not the async
// toBlob) before share() is called — no awaits in the hot path.
(function () {
  const CARD = "#f4ecd6", INK = "#161327";
  const CELL = { "🟩": "#3bd93b", "🟧": "#ff8c1a", "🟨": "#ffd23a",
                 "🟥": "#ff6b6b", "⬜": "#d9d3e0" };

  function roundRect(ctx, x, y, w, h, r) {
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // opts: { headline, subtitle, footer, grid } — grid is rows of emoji strings.
  function renderCard(opts) {
    const grid = opts.grid || [];
    const rows = grid.length;
    const cols = rows ? Math.max.apply(null, grid.map((r) => r.length)) : 0;
    const cell = 46, gap = 8, pad = 44;
    const gridW = cols ? cols * cell + (cols - 1) * gap : 0;
    const W = Math.max(gridW, 460) + pad * 2;

    const F = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    let y = pad;
    // Measure height by walking the same cursor we draw with.
    y += 54;                                  // headline
    y += 18 + 30;                             // gap + subtitle
    if (rows) y += 30 + rows * cell + (rows - 1) * gap; // gap + grid
    y += 30 + 26;                             // gap + footer
    const H = y + pad - 26;

    const scale = 2;
    const c = document.createElement("canvas");
    c.width = W * scale; c.height = H * scale;
    const ctx = c.getContext("2d");
    ctx.scale(scale, scale);

    // Card: cream fill + thick ink border + offset shadow, matching the site.
    ctx.fillStyle = INK; ctx.fillRect(8, 10, W - 8, H - 10);   // drop shadow
    ctx.fillStyle = CARD; ctx.fillRect(0, 0, W - 8, H - 10);
    ctx.lineWidth = 6; ctx.strokeStyle = INK;
    ctx.strokeRect(3, 3, W - 14, H - 16);

    const cx = (W - 8) / 2;
    ctx.textAlign = "center";
    ctx.fillStyle = INK;

    y = pad;
    ctx.font = "800 44px " + F;
    ctx.textBaseline = "top";
    ctx.fillText(opts.headline, cx, y);
    y += 54 + 18;

    ctx.font = "700 26px " + F;
    ctx.fillText(opts.subtitle, cx, y);
    y += 30;

    if (rows) {
      y += 30;
      for (let r = 0; r < rows; r++) {
        const rowLen = grid[r].length;
        let x = cx - (rowLen * cell + (rowLen - 1) * gap) / 2;
        for (let col = 0; col < rowLen; col++) {
          ctx.fillStyle = CELL[grid[r][col]] || CELL["⬜"];
          roundRect(ctx, x, y, cell, cell, 9);
          ctx.fill();
          ctx.lineWidth = 2; ctx.strokeStyle = INK;
          roundRect(ctx, x, y, cell, cell, 9);
          ctx.stroke();
          x += cell + gap;
        }
        y += cell + gap;
      }
      y -= gap;
      y += 30;
    }

    ctx.fillStyle = INK;
    ctx.font = "700 22px " + F;
    ctx.fillText(opts.footer, cx, y);

    return c;
  }

  function dataURLToFile(dataURL, name) {
    const comma = dataURL.indexOf(",");
    const bin = atob(dataURL.slice(comma + 1));
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new File([arr], name, { type: "image/png" });
  }

  // Overlay showing the rendered card so the user can save/share it manually.
  // This is the universal path: it works on every iOS version and on desktop,
  // regardless of whether navigator.share supports files. On touch devices the
  // user press-and-holds the image → "Share…"/"Save to Photos" → Messages.
  function showOverlay(dataURL, opts) {
    const touch = matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
    const ov = document.createElement("div");
    ov.style.cssText =
      "position:fixed;inset:0;z-index:9999;background:rgba(22,19,39,.72);" +
      "display:flex;align-items:center;justify-content:center;padding:18px;";
    const hint = touch
      ? "Press &amp; hold the image, then choose <b>Share…</b> or <b>Save to Photos</b> to send it in Messages."
      : "Right-click the image to copy it, or use <b>Save image</b> below.";
    ov.innerHTML =
      '<div style="background:' + CARD + ';border:4px solid ' + INK + ';border-radius:14px;' +
      'box-shadow:6px 8px 0 ' + INK + ';max-width:min(460px,92vw);max-height:92vh;overflow:auto;' +
      'padding:16px;text-align:center;font-family:system-ui,-apple-system,sans-serif;">' +
      '<img src="' + dataURL + '" style="max-width:100%;height:auto;border-radius:8px;display:block;">' +
      '<p style="color:' + INK + ';font-size:14px;line-height:1.4;margin:12px 4px;">' + hint + "</p>" +
      '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">' +
      '<a id="ws-save" download="weiddle.png" href="' + dataURL + '" ' +
      'style="background:' + INK + ';color:' + CARD + ';text-decoration:none;font-weight:700;' +
      'border-radius:8px;padding:9px 14px;font-size:15px;">⬇ Save image</a>' +
      '<button id="ws-close" style="background:' + CARD + ';color:' + INK + ';border:2px solid ' + INK + ';' +
      'font-weight:700;border-radius:8px;padding:9px 14px;font-size:15px;cursor:pointer;">Close</button>' +
      "</div></div>";
    const close = () => ov.remove();
    ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
    document.body.appendChild(ov);
    ov.querySelector("#ws-close").addEventListener("click", close);
  }

  // Public entry point. opts:
  //   text     full text (clipboard copy for anyone who wants the emoji grid)
  //   url      canonical link (printed on the card art)
  //   headline big title on the card, e.g. "🎬 Cindle"
  //   subtitle score/date line, e.g. "2026-08-09 · 3/6"
  //   grid     optional rows of emoji strings (colored squares); omit for none
  //   onCopied optional callback fired when we also copy the text to clipboard
  window.weiddleShare = function (opts) {
    const footer = (opts.url || "").replace(/^https?:\/\//, "");

    let file = null, dataURL = "";
    try {
      const canvas = renderCard({
        headline: opts.headline, subtitle: opts.subtitle,
        footer: footer, grid: opts.grid,
      });
      dataURL = canvas.toDataURL("image/png");
      file = dataURLToFile(dataURL, "weiddle.png");
    } catch (e) { /* fall through to text-only paths */ }

    // Copy the text grid too, so it's on the clipboard either way.
    if (navigator.clipboard) navigator.clipboard.writeText(opts.text).catch(() => {});
    if (opts.onCopied) opts.onCopied();

    // 1) One-tap native share of the image FILE (best case: iOS Messages inline).
    // Share ONLY the file — a share carrying a URL makes Messages unfurl a link
    // preview and drop the image. If the native share fails for any reason other
    // than the user cancelling, fall back to the on-screen overlay.
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file] }).catch((err) => {
        if (err && err.name === "AbortError") return;   // user dismissed the sheet
        if (dataURL) showOverlay(dataURL, opts);
      });
      return;
    }
    // 2) No file sharing (older iOS, desktop, in-app browsers): show the image so
    // the user can save/share it by hand. Guaranteed to surface the picture.
    if (dataURL) { showOverlay(dataURL, opts); return; }
    // 3) Image couldn't be built at all: last-ditch native text share.
    if (navigator.share) navigator.share({ text: opts.text }).catch(() => {});
  };
})();
