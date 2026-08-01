(function () {
  "use strict";

  var root = document.getElementById("supply-chain-diagram");
  if (!root) return;

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var isCompact = window.matchMedia("(max-width: 640px)").matches;
  var svgNS = "http://www.w3.org/2000/svg";

  var GREY = "#3A3F45";
  var EMERALD = "#2FBE86";
  var TRUNK_MIN_WIDTH = 1.5;
  var TRUNK_MAX_WIDTH = 11;

  /* ======================================================================
     Layouts. Mobile is a genuinely different composition (vertical flow),
     not the desktop layout scaled down — label sizes, clinic count and
     spacing are all tuned for a narrow, tall canvas.
     ====================================================================== */

  var DESKTOP = {
    viewBox: "0 0 1200 660",
    clinicSlots: [
      { x: 100, y: 60 }, { x: 300, y: 50 }, { x: 55, y: 180 }, { x: 330, y: 170 },
      { x: 150, y: 270 }, { x: 310, y: 300 }, { x: 70, y: 400 }, { x: 340, y: 420 },
      { x: 170, y: 510 }, { x: 260, y: 590 }
    ],
    clinicCount: [8, 10],
    zoneClinics: { x: 210, y: 630 },
    confluence: { x: 460, y: 330 },
    core: { x: 490, y: 230, width: 64, height: 200 },
    coreEntry: { x: 490, y: 330 },
    coreExit: { x: 554, y: 400 },
    zoneCore: { x: 522, y: 195 },
    counterSub: { x: 522, y: 315 },
    counter: { x: 522, y: 340 },
    branch: { x: 740, y: 330 },
    destMfr: { x: 1040, y: 190 },
    destDist: { x: 1040, y: 490 },
    labelMfr: { x: 1040, y: 150 },
    labelDist: { x: 1040, y: 522 },
    showClinicLabels: true
  };

  // Spacing here is generous on purpose — mobile text runs much larger
  // relative to the viewBox than desktop's (see the font-size overrides
  // in styles.css), so rows need proportionally more clearance or labels
  // collide with each other.
  var MOBILE = {
    viewBox: "0 0 640 960",
    clinicSlots: [
      { x: 110, y: 40 }, { x: 430, y: 35 }, { x: 55, y: 130 },
      { x: 545, y: 120 }, { x: 230, y: 180 }, { x: 390, y: 195 }
    ],
    clinicCount: [5, 6],
    zoneClinics: { x: 320, y: 265 },
    confluence: { x: 320, y: 325 },
    core: { x: 195, y: 420, width: 250, height: 78 },
    coreEntry: { x: 320, y: 420 },
    coreExit: { x: 320, y: 498 },
    zoneCore: { x: 320, y: 388 },
    counterSub: { x: 320, y: 450 },
    counter: { x: 320, y: 484 },
    branch: { x: 320, y: 590 },
    destMfr: { x: 190, y: 740 },
    destDist: { x: 470, y: 820 },
    labelMfr: { x: 190, y: 695 },
    labelDist: { x: 470, y: 865 },
    showClinicLabels: false
  };

  var LAYOUT = isCompact ? MOBILE : DESKTOP;

  /* ======================================================================
     DOM refs / one-time setup
     ====================================================================== */

  root.setAttribute("viewBox", LAYOUT.viewBox);

  var linesGroup = root.querySelector(".sc-clinic-lines");
  var nodesGroup = root.querySelector(".sc-clinic-nodes");
  var labelsGroup = root.querySelector(".sc-clinic-labels");
  var trunkIn = root.querySelector(".sc-trunk-in");
  var confluenceGlow = root.querySelector(".sc-confluence-glow");
  var core = root.querySelector(".sc-core");
  var counterEl = root.querySelector(".sc-counter");
  var counterSubEl = root.querySelector(".sc-counter-sub");
  var trunkOut = root.querySelector(".sc-trunk-out");
  var branchGlow = root.querySelector(".sc-branch-glow");
  var branchMfr = root.querySelector(".sc-branch-mfr");
  var branchDist = root.querySelector(".sc-branch-dist");
  var destMfr = root.querySelector(".sc-dest-mfr");
  var destDist = root.querySelector(".sc-dest-dist");
  var labelMfr = root.querySelector(".sc-dest-label-mfr");
  var labelDist = root.querySelector(".sc-dest-label-dist");
  var zoneClinics = root.querySelector(".sc-zone-clinics");
  var zoneCore = root.querySelector(".sc-zone-label-core");
  var caption = document.querySelector(".supply-chain-caption");

  // Static geometry that never changes mid-cycle.
  confluenceGlow.setAttribute("cx", String(LAYOUT.confluence.x));
  confluenceGlow.setAttribute("cy", String(LAYOUT.confluence.y));
  confluenceGlow.setAttribute("r", "24");

  core.setAttribute("x", String(LAYOUT.core.x));
  core.setAttribute("y", String(LAYOUT.core.y));
  core.setAttribute("width", String(LAYOUT.core.width));
  core.setAttribute("height", String(LAYOUT.core.height));
  core.setAttribute("rx", "8");

  counterSubEl.setAttribute("x", String(LAYOUT.counterSub.x));
  counterSubEl.setAttribute("y", String(LAYOUT.counterSub.y));
  counterEl.setAttribute("x", String(LAYOUT.counter.x));
  counterEl.setAttribute("y", String(LAYOUT.counter.y));

  branchGlow.setAttribute("cx", String(LAYOUT.branch.x));
  branchGlow.setAttribute("cy", String(LAYOUT.branch.y));
  branchGlow.setAttribute("r", "16");

  destMfr.setAttribute("cx", String(LAYOUT.destMfr.x));
  destMfr.setAttribute("cy", String(LAYOUT.destMfr.y));
  destDist.setAttribute("cx", String(LAYOUT.destDist.x));
  destDist.setAttribute("cy", String(LAYOUT.destDist.y));

  labelMfr.setAttribute("x", String(LAYOUT.labelMfr.x));
  labelMfr.setAttribute("y", String(LAYOUT.labelMfr.y));
  labelMfr.textContent = "MANUFACTURERS";

  labelDist.setAttribute("x", String(LAYOUT.labelDist.x));
  labelDist.setAttribute("y", String(LAYOUT.labelDist.y));
  labelDist.textContent = "SELECT DISTRIBUTION PARTNERS";

  zoneClinics.setAttribute("x", String(LAYOUT.zoneClinics.x));
  zoneClinics.setAttribute("y", String(LAYOUT.zoneClinics.y));
  zoneClinics.textContent = "CLINICS & BUYERS";

  zoneCore.setAttribute("x", String(LAYOUT.zoneCore.x));
  zoneCore.setAttribute("y", String(LAYOUT.zoneCore.y));
  zoneCore.textContent = "CELLTONIS";

  trunkIn.setAttribute("d", curvePath(LAYOUT.confluence.x, LAYOUT.confluence.y, LAYOUT.coreEntry.x, LAYOUT.coreEntry.y));

  var running = false;
  var loopHandle = null;
  var firstCycleDone = false;

  /* ---------------------------------------------------------------------
     Helpers
     --------------------------------------------------------------------- */

  function wait(ms) {
    return new Promise(function (resolve) { loopHandle = setTimeout(resolve, ms); });
  }

  function rand(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = rand(0, i);
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function pad(n) { return n < 10 ? "0" + n : String(n); }

  function curvePath(sx, sy, ex, ey) {
    var midX = sx + (ex - sx) * 0.55;
    var midY = sy + (ey - sy) * 0.55;
    // Bias the control points toward whichever axis has more distance to
    // cover, so both the desktop (mostly horizontal) and mobile (mostly
    // vertical) layouts get a natural-looking curve rather than a kink.
    if (Math.abs(ex - sx) >= Math.abs(ey - sy)) {
      return "M" + sx + "," + sy + " C" + midX + "," + sy + " " + midX + "," + ey + " " + ex + "," + ey;
    }
    return "M" + sx + "," + sy + " C" + sx + "," + midY + " " + ex + "," + midY + " " + ex + "," + ey;
  }

  function mixColor(hexA, hexB, t) {
    t = Math.max(0, Math.min(1, t));
    var a = parseInt(hexA.slice(1), 16), b = parseInt(hexB.slice(1), 16);
    var ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
    var br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
    return "rgb(" + Math.round(ar + (br - ar) * t) + "," + Math.round(ag + (bg - ag) * t) + "," + Math.round(ab + (bb - ab) * t) + ")";
  }

  function clearGroup(group) { while (group.firstChild) group.removeChild(group.firstChild); }

  function fadeOut(el, duration) {
    el.style.transition = "opacity " + duration + "ms ease";
    el.style.opacity = "0";
  }

  function drawPath(el, d, duration, timingFn) {
    el.setAttribute("d", d);
    var len = el.getTotalLength();
    el.style.transition = "none";
    el.style.strokeDasharray = String(len);
    el.style.strokeDashoffset = String(len);
    el.style.opacity = "1";
    void el.getBoundingClientRect();
    el.style.transition = "stroke-dashoffset " + duration + "ms " + timingFn;
    el.style.strokeDashoffset = "0";
  }

  /* ---------------------------------------------------------------------
     One full cycle
     --------------------------------------------------------------------- */

  async function runCycle() {
    // --- reset ---
    clearGroup(linesGroup);
    clearGroup(nodesGroup);
    clearGroup(labelsGroup);

    trunkIn.style.transition = "none";
    trunkIn.style.strokeWidth = String(TRUNK_MIN_WIDTH);
    trunkIn.style.stroke = GREY;
    void trunkIn.getBoundingClientRect();
    trunkIn.style.transition = "";

    confluenceGlow.style.opacity = "0";
    branchGlow.style.opacity = "0";
    core.style.filter = "drop-shadow(0 0 0 rgba(47,190,134,0))";

    [trunkOut, branchMfr, branchDist].forEach(function (el) {
      el.style.transition = "none";
      el.style.opacity = "0";
    });

    destMfr.classList.remove("active");
    destDist.classList.remove("active");
    labelMfr.classList.remove("is-visible");
    labelDist.classList.remove("is-visible");

    counterSubEl.textContent = "POOLING";
    counterEl.textContent = "0 UNITS";

    // --- stage 1 + 2 + 3: clinics pulse in, converge, pool ---
    var count = rand(LAYOUT.clinicCount[0], LAYOUT.clinicCount[1]);
    var slots = shuffle(LAYOUT.clinicSlots).slice(0, count);
    var total = 0;
    var clinicIdCounter = rand(8, 60);

    for (var k = 0; k < slots.length; k++) {
      if (!running) return;

      var slot = slots[k];
      var units = rand(5, 30);
      total += units;
      clinicIdCounter += rand(3, 17);
      var clinicId = "CL-" + pad(clinicIdCounter % 100);

      // Node + independent "ping" pulse.
      var node = document.createElementNS(svgNS, "circle");
      node.setAttribute("class", "sc-node");
      node.setAttribute("cx", String(slot.x));
      node.setAttribute("cy", String(slot.y));
      node.setAttribute("r", "3.5");
      nodesGroup.appendChild(node);
      requestAnimationFrame(function (n) { n.style.opacity = "1"; }.bind(null, node));

      var ping = document.createElementNS(svgNS, "circle");
      ping.setAttribute("class", "sc-node-ping");
      ping.setAttribute("cx", String(slot.x));
      ping.setAttribute("cy", String(slot.y));
      ping.setAttribute("r", "6");
      nodesGroup.appendChild(ping);
      requestAnimationFrame(function (p) { p.classList.add("is-active"); }.bind(null, ping));

      // Line drawing toward the confluence point.
      var line = document.createElementNS(svgNS, "path");
      line.setAttribute("class", "sc-line");
      linesGroup.appendChild(line);
      drawPath(line, curvePath(slot.x, slot.y, LAYOUT.confluence.x, LAYOUT.confluence.y), 450, "ease");

      if (LAYOUT.showClinicLabels) {
        var label = document.createElementNS(svgNS, "text");
        label.setAttribute("class", "sc-clinic-label");
        label.setAttribute("x", String(slot.x + 8));
        label.setAttribute("y", String(slot.y - 8));
        label.textContent = clinicId + ": " + units + " UNITS";
        labelsGroup.appendChild(label);
        requestAnimationFrame(function (l) { l.style.opacity = "1"; }.bind(null, label));
      }

      await wait(480);
      if (!running) return;

      var progress = (k + 1) / slots.length;
      trunkIn.style.strokeWidth = String(TRUNK_MIN_WIDTH + (TRUNK_MAX_WIDTH - TRUNK_MIN_WIDTH) * progress);
      trunkIn.style.stroke = mixColor(GREY, EMERALD, progress);
      confluenceGlow.style.opacity = String(Math.min(0.85, 0.18 * (k + 1)));
      core.style.filter = "drop-shadow(0 0 " + Math.round(4 + progress * 9) + "px rgba(47,190,134," + (0.25 + progress * 0.5).toFixed(2) + "))";
      counterEl.textContent = total + " UNITS";

      await wait(160);
      if (!running) return;
    }

    await wait(500);
    if (!running) return;

    counterSubEl.textContent = "CONSOLIDATED ORDER";
    counterEl.textContent = total + " UNITS POOLED";

    await wait(750);
    if (!running) return;

    // --- stage 4: one stronger pulse exits CellTonis ---
    drawPath(trunkOut, curvePath(LAYOUT.coreExit.x, LAYOUT.coreExit.y, LAYOUT.branch.x, LAYOUT.branch.y), 650, "cubic-bezier(0.22,1,0.36,1)");

    await wait(650);
    if (!running) return;

    branchGlow.style.opacity = "0.75";

    // --- stage 5: it splits — most weight to manufacturers, a smaller
    // branch to distribution partners, manufacturers drawing first ---
    drawPath(branchMfr, curvePath(LAYOUT.branch.x, LAYOUT.branch.y, LAYOUT.destMfr.x, LAYOUT.destMfr.y), 700, "cubic-bezier(0.22,1,0.36,1)");

    await wait(220);
    if (!running) return;
    drawPath(branchDist, curvePath(LAYOUT.branch.x, LAYOUT.branch.y, LAYOUT.destDist.x, LAYOUT.destDist.y), 650, "cubic-bezier(0.22,1,0.36,1)");

    await wait(500);
    if (!running) return;

    // --- stage 6: manufacturer glows (primary), distributor glows
    // (secondary, quieter), cycle then holds and repeats ---
    destMfr.classList.add("active");
    labelMfr.classList.add("is-visible");

    await wait(280);
    if (!running) return;
    destDist.classList.add("active");
    labelDist.classList.add("is-visible");

    if (!firstCycleDone) {
      firstCycleDone = true;
      if (caption) caption.classList.add("is-visible");
    }

    await wait(2000);
    if (!running) return;

    // --- fade before next cycle ---
    fadeOut(trunkIn, 350);
    linesGroup.querySelectorAll(".sc-line").forEach(function (l) { fadeOut(l, 350); });
    nodesGroup.querySelectorAll(".sc-node").forEach(function (n) { fadeOut(n, 350); });
    labelsGroup.querySelectorAll(".sc-clinic-label").forEach(function (l) { fadeOut(l, 350); });
    fadeOut(confluenceGlow, 350);
    fadeOut(branchGlow, 350);
    fadeOut(trunkOut, 350);
    fadeOut(branchMfr, 350);
    fadeOut(branchDist, 350);
    destMfr.classList.remove("active");
    destDist.classList.remove("active");
    labelMfr.classList.remove("is-visible");
    labelDist.classList.remove("is-visible");

    await wait(400);
  }

  async function loop() {
    while (running) {
      await runCycle();
    }
  }

  function start() {
    if (running) return;
    running = true;
    loop();
  }

  function stop() {
    running = false;
    if (loopHandle) clearTimeout(loopHandle);
  }

  /* ---------------------------------------------------------------------
     Reduced motion — one static end-state frame, no animation.
     --------------------------------------------------------------------- */

  function renderStaticFrame() {
    var total = 0;
    var clinicIdCounter = 20;

    LAYOUT.clinicSlots.forEach(function (slot) {
      var units = rand(5, 30);
      total += units;
      clinicIdCounter += rand(3, 17);
      var clinicId = "CL-" + pad(clinicIdCounter % 100);

      var line = document.createElementNS(svgNS, "path");
      line.setAttribute("class", "sc-line");
      line.setAttribute("d", curvePath(slot.x, slot.y, LAYOUT.confluence.x, LAYOUT.confluence.y));
      line.style.opacity = "1";
      linesGroup.appendChild(line);

      var node = document.createElementNS(svgNS, "circle");
      node.setAttribute("class", "sc-node");
      node.setAttribute("cx", String(slot.x));
      node.setAttribute("cy", String(slot.y));
      node.setAttribute("r", "3.5");
      node.style.opacity = "1";
      nodesGroup.appendChild(node);

      if (LAYOUT.showClinicLabels) {
        var label = document.createElementNS(svgNS, "text");
        label.setAttribute("class", "sc-clinic-label");
        label.setAttribute("x", String(slot.x + 8));
        label.setAttribute("y", String(slot.y - 8));
        label.textContent = clinicId + ": " + units + " UNITS";
        label.style.opacity = "1";
        labelsGroup.appendChild(label);
      }
    });

    trunkIn.style.strokeWidth = String(TRUNK_MAX_WIDTH);
    trunkIn.style.stroke = EMERALD;
    confluenceGlow.style.opacity = "0.7";
    branchGlow.style.opacity = "0.7";
    core.style.filter = "drop-shadow(0 0 11px rgba(47,190,134,0.6))";
    counterSubEl.textContent = "CONSOLIDATED ORDER";
    counterEl.textContent = total + " UNITS POOLED";

    trunkOut.setAttribute("d", curvePath(LAYOUT.coreExit.x, LAYOUT.coreExit.y, LAYOUT.branch.x, LAYOUT.branch.y));
    trunkOut.style.opacity = "1";
    branchMfr.setAttribute("d", curvePath(LAYOUT.branch.x, LAYOUT.branch.y, LAYOUT.destMfr.x, LAYOUT.destMfr.y));
    branchMfr.style.opacity = "1";
    branchDist.setAttribute("d", curvePath(LAYOUT.branch.x, LAYOUT.branch.y, LAYOUT.destDist.x, LAYOUT.destDist.y));
    branchDist.style.opacity = "1";

    destMfr.classList.add("active");
    destDist.classList.add("active");
    labelMfr.classList.add("is-visible");
    labelDist.classList.add("is-visible");

    if (caption) caption.classList.add("is-visible");
  }

  /* ---------------------------------------------------------------------
     Wire it up
     --------------------------------------------------------------------- */

  if (reduceMotion) {
    renderStaticFrame();
  } else if ("IntersectionObserver" in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) start(); else stop();
      });
    }, { threshold: 0.2 });
    observer.observe(root);

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        stop();
      } else {
        var rect = root.getBoundingClientRect();
        if (rect.top < window.innerHeight && rect.bottom > 0) start();
      }
    });
  } else {
    start();
  }
})();
