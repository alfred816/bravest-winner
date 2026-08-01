(function () {
  "use strict";

  var root = document.getElementById("supply-chain-diagram");
  if (!root) return;

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // On narrow screens the whole 1200-unit-wide viewBox scales down a lot —
  // per-clinic labels would need to be tiny to avoid overlapping each
  // other, so on mobile we show fewer clinics with no individual labels
  // (lines/nodes still convey "many small sources") and let the zone/
  // counter/manufacturer text run larger instead.
  var isCompact = window.matchMedia("(max-width: 640px)").matches;
  var svgNS = "http://www.w3.org/2000/svg";

  /* ======================================================================
     Layout — fixed coordinates in the diagram's 1200x660 viewBox. Only
     the clinic subset, their values, and the winning manufacturer change
     per cycle; the geometry itself stays put.
     ====================================================================== */

  var CLINIC_SLOTS = [
    { x: 100, y: 60 },
    { x: 300, y: 50 },
    { x: 55, y: 180 },
    { x: 330, y: 170 },
    { x: 150, y: 270 },
    { x: 310, y: 300 },
    { x: 70, y: 400 },
    { x: 340, y: 420 },
    { x: 170, y: 510 },
    { x: 260, y: 590 }
  ];

  var CONFLUENCE = { x: 460, y: 330 };
  // yOut sits below the counter text so the outbound order line never
  // crosses through the "N UNITS POOLED" label as it departs the bar.
  var CORE = { xLeft: 490, xRight: 554, y: 330, yOut: 400 };
  var MANUFACTURERS = [
    { id: "A", x: 1010, y: 150 },
    { id: "B", x: 1010, y: 330 },
    { id: "C", x: 1010, y: 510 }
  ];

  var TRUNK_MIN_WIDTH = 1.5;
  var TRUNK_MAX_WIDTH = 12;
  var GREY = "#3A3F45";
  var EMERALD = "#2FBE86";

  var linesGroup = root.querySelector(".sc-clinic-lines");
  var nodesGroup = root.querySelector(".sc-clinic-nodes");
  var labelsGroup = root.querySelector(".sc-clinic-labels");
  var trunk = root.querySelector(".sc-trunk");
  var confluenceGlow = root.querySelector(".sc-confluence-glow");
  var core = root.querySelector(".sc-core");
  var counterEl = root.querySelector(".sc-counter");
  var counterSubEl = root.querySelector(".sc-counter-sub");
  var outputLine = root.querySelector(".sc-output-line");
  var mfrNodes = root.querySelectorAll(".sc-mfr-node");
  var mfrLabel = root.querySelector(".sc-mfr-label");
  var caption = document.querySelector(".supply-chain-caption .scc-text");

  var running = false;
  var loopHandle = null;
  var firstCycleDone = false;

  /* ---------------------------------------------------------------------
     Helpers
     --------------------------------------------------------------------- */

  function wait(ms) {
    return new Promise(function (resolve) {
      loopHandle = setTimeout(resolve, ms);
    });
  }

  function rand(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = rand(0, i);
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function curvePath(sx, sy, ex, ey) {
    var midX = sx + (ex - sx) * 0.6;
    return "M" + sx + "," + sy + " C" + midX + "," + sy + " " + midX + "," + ey + " " + ex + "," + ey;
  }

  // On mobile the whole diagram scales down enough that this string needs
  // to run larger to stay legible — which only fits if it wraps to two
  // lines instead of shrinking to match the single-line desktop version.
  function setMfrLabelText(x) {
    while (mfrLabel.firstChild) mfrLabel.removeChild(mfrLabel.firstChild);
    if (isCompact) {
      var line1 = document.createElementNS(svgNS, "tspan");
      line1.setAttribute("x", String(x));
      line1.setAttribute("dy", "0");
      line1.textContent = "1 ORDER — MANUFACTURER";
      var line2 = document.createElementNS(svgNS, "tspan");
      line2.setAttribute("x", String(x));
      line2.setAttribute("dy", "1.3em");
      line2.textContent = "PRICING UNLOCKED";
      mfrLabel.appendChild(line1);
      mfrLabel.appendChild(line2);
    } else {
      mfrLabel.textContent = "1 ORDER — MANUFACTURER PRICING UNLOCKED";
    }
  }

  function mixColor(hexA, hexB, t) {
    t = Math.max(0, Math.min(1, t));
    var a = parseInt(hexA.slice(1), 16);
    var b = parseInt(hexB.slice(1), 16);
    var ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
    var br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
    var r = Math.round(ar + (br - ar) * t);
    var g = Math.round(ag + (bg - ag) * t);
    var bl = Math.round(ab + (bb - ab) * t);
    return "rgb(" + r + "," + g + "," + bl + ")";
  }

  function clearGroup(group) {
    while (group.firstChild) group.removeChild(group.firstChild);
  }

  function fadeOut(el, duration) {
    el.style.transition = "opacity " + duration + "ms ease";
    el.style.opacity = "0";
  }

  /* ---------------------------------------------------------------------
     One full cycle: build up clinics -> pool -> consolidate -> deliver.
     --------------------------------------------------------------------- */

  async function runCycle() {
    // Reset visual state.
    clearGroup(linesGroup);
    clearGroup(nodesGroup);
    clearGroup(labelsGroup);

    trunk.style.transition = "none";
    trunk.style.strokeWidth = String(TRUNK_MIN_WIDTH);
    trunk.style.stroke = GREY;
    void trunk.getBoundingClientRect();
    trunk.style.transition = "";

    confluenceGlow.style.opacity = "0";
    core.style.filter = "drop-shadow(0 0 0 rgba(47,190,134,0))";

    outputLine.setAttribute("d", "M" + CORE.xRight + "," + CORE.yOut + " L" + CORE.xRight + "," + CORE.yOut);
    outputLine.style.transition = "none";
    outputLine.style.opacity = "0";

    mfrNodes.forEach(function (n) { n.classList.remove("active"); });
    mfrLabel.classList.remove("is-visible");

    counterSubEl.textContent = "POOLING";
    counterEl.textContent = "0 UNITS";

    // Pick this cycle's clinics. Fewer on narrow screens, where 8-10
    // scattered labels would have to overlap or shrink unreadably.
    var count = isCompact ? rand(5, 6) : rand(8, 10);
    var slots = shuffle(CLINIC_SLOTS).slice(0, count);

    var total = 0;
    var clinicIdCounter = rand(8, 60);

    for (var k = 0; k < slots.length; k++) {
      if (!running) return;

      var slot = slots[k];
      var units = rand(5, 30);
      total += units;
      clinicIdCounter += rand(3, 17);
      var clinicId = "CL-" + pad(clinicIdCounter % 100);

      // Thin grey line, drawn in from the clinic toward the confluence point.
      var line = document.createElementNS(svgNS, "path");
      line.setAttribute("class", "sc-line");
      line.setAttribute("d", curvePath(slot.x, slot.y, CONFLUENCE.x, CONFLUENCE.y));
      linesGroup.appendChild(line);
      var len = line.getTotalLength();
      line.style.strokeDasharray = String(len);
      line.style.strokeDashoffset = String(len);
      line.style.transition = "none";
      void line.getBoundingClientRect();
      line.style.transition = "stroke-dashoffset 0.45s ease, opacity 0.25s ease";
      line.style.opacity = "1";
      line.style.strokeDashoffset = "0";

      // Small clinic node.
      var node = document.createElementNS(svgNS, "circle");
      node.setAttribute("class", "sc-node");
      node.setAttribute("cx", String(slot.x));
      node.setAttribute("cy", String(slot.y));
      node.setAttribute("r", "3.5");
      nodesGroup.appendChild(node);
      requestAnimationFrame(function (n) { n.style.opacity = "1"; }.bind(null, node));

      // Label, e.g. "CL-014: 12 UNITS" — skipped on narrow screens, where
      // the lines/nodes alone still read as "many small sources".
      if (!isCompact) {
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

      // Arrival: the line has "joined" — thicken/brighten the trunk and
      // the confluence glow, and tick the running counter upward.
      var progress = (k + 1) / slots.length;
      trunk.style.strokeWidth = String(TRUNK_MIN_WIDTH + (TRUNK_MAX_WIDTH - TRUNK_MIN_WIDTH) * progress);
      trunk.style.stroke = mixColor(GREY, EMERALD, progress);
      confluenceGlow.style.opacity = String(Math.min(0.85, 0.18 * (k + 1)));
      core.style.filter = "drop-shadow(0 0 " + Math.round(4 + progress * 8) + "px rgba(47,190,134," + (0.25 + progress * 0.45).toFixed(2) + "))";
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

    // Send the single consolidated order to one manufacturer.
    var target = MANUFACTURERS[rand(0, MANUFACTURERS.length - 1)];
    outputLine.setAttribute("d", curvePath(CORE.xRight, CORE.yOut, target.x, target.y));
    var outLen = outputLine.getTotalLength();
    outputLine.style.strokeDasharray = String(outLen);
    outputLine.style.strokeDashoffset = String(outLen);
    outputLine.style.opacity = "1";
    outputLine.style.transition = "none";
    void outputLine.getBoundingClientRect();
    outputLine.style.transition = "stroke-dashoffset 0.9s cubic-bezier(0.22,1,0.36,1)";
    outputLine.style.strokeDashoffset = "0";

    await wait(950);
    if (!running) return;

    var targetNode = root.querySelector('.sc-mfr-node[data-id="' + target.id + '"]');
    if (targetNode) targetNode.classList.add("active");

    var labelY = target.y < 300 ? target.y + 34 : target.y > 400 ? target.y - 22 : target.y + 34;
    mfrLabel.setAttribute("x", String(target.x));
    mfrLabel.setAttribute("y", String(labelY));
    setMfrLabelText(target.x);
    mfrLabel.classList.add("is-visible");

    if (!firstCycleDone) {
      firstCycleDone = true;
      if (caption) caption.classList.add("is-typed");
    }

    await wait(2000);
    if (!running) return;

    // Brief fade before the next cycle picks up.
    fadeOut(trunk, 350);
    linesGroup.querySelectorAll(".sc-line").forEach(function (l) { fadeOut(l, 350); });
    nodesGroup.querySelectorAll(".sc-node").forEach(function (n) { fadeOut(n, 350); });
    labelsGroup.querySelectorAll(".sc-clinic-label").forEach(function (l) { fadeOut(l, 350); });
    fadeOut(outputLine, 350);
    fadeOut(confluenceGlow, 350);
    if (targetNode) targetNode.classList.remove("active");
    mfrLabel.classList.remove("is-visible");

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
     Reduced motion — render one representative final frame, no animation.
     --------------------------------------------------------------------- */

  function renderStaticFrame() {
    var slots = CLINIC_SLOTS;
    var total = 0;
    var clinicIdCounter = 20;

    slots.forEach(function (slot) {
      var units = rand(5, 30);
      total += units;
      clinicIdCounter += rand(3, 17);
      var clinicId = "CL-" + pad(clinicIdCounter % 100);

      var line = document.createElementNS(svgNS, "path");
      line.setAttribute("class", "sc-line");
      line.setAttribute("d", curvePath(slot.x, slot.y, CONFLUENCE.x, CONFLUENCE.y));
      line.style.opacity = "1";
      linesGroup.appendChild(line);

      var node = document.createElementNS(svgNS, "circle");
      node.setAttribute("class", "sc-node");
      node.setAttribute("cx", String(slot.x));
      node.setAttribute("cy", String(slot.y));
      node.setAttribute("r", "3.5");
      node.style.opacity = "1";
      nodesGroup.appendChild(node);

      var label = document.createElementNS(svgNS, "text");
      label.setAttribute("class", "sc-clinic-label");
      label.setAttribute("x", String(slot.x + 8));
      label.setAttribute("y", String(slot.y - 8));
      label.textContent = clinicId + ": " + units + " UNITS";
      label.style.opacity = "1";
      labelsGroup.appendChild(label);
    });

    trunk.style.strokeWidth = String(TRUNK_MAX_WIDTH);
    trunk.style.stroke = EMERALD;
    confluenceGlow.style.opacity = "0.7";
    core.style.filter = "drop-shadow(0 0 10px rgba(47,190,134,0.6))";
    counterSubEl.textContent = "CONSOLIDATED ORDER";
    counterEl.textContent = total + " UNITS POOLED";

    var target = MANUFACTURERS[1];
    outputLine.setAttribute("d", curvePath(CORE.xRight, CORE.yOut, target.x, target.y));
    outputLine.style.opacity = "1";

    var targetNode = root.querySelector('.sc-mfr-node[data-id="' + target.id + '"]');
    if (targetNode) targetNode.classList.add("active");
    mfrLabel.setAttribute("x", String(target.x));
    mfrLabel.setAttribute("y", String(target.y + 34));
    setMfrLabelText(target.x);
    mfrLabel.classList.add("is-visible");

    if (caption) caption.classList.add("is-typed");
  }

  /* ---------------------------------------------------------------------
     Wire it up: start once scrolled into view, pause when tab hidden.
     --------------------------------------------------------------------- */

  if (reduceMotion) {
    renderStaticFrame();
  } else if ("IntersectionObserver" in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          start();
        } else {
          stop();
        }
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
