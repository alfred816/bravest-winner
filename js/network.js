(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ======================================================================
     Hero network canvas — an abstract, slowly-consolidating point network.
     Individual points drift; a subset drifts toward a fixed "network layer"
     hub on the right, representing demand converging through CellTonis.
     ====================================================================== */

  var canvas = document.getElementById("hero-canvas");

  if (canvas && "getContext" in canvas) {
    var ctx = canvas.getContext("2d");
    var hero = canvas.closest(".hero");
    var width = 0, height = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
    var points = [];
    var hub = { x: 0, y: 0 };
    var rafId = null;
    var running = false;

    function pointCount() {
      return width < 640 ? 26 : width < 1080 ? 44 : 68;
    }

    function resize() {
      var rect = hero.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      hub.x = width * 0.78;
      hub.y = height * 0.5;
      seed();
    }

    function seed() {
      var count = pointCount();
      points = [];
      for (var i = 0; i < count; i++) {
        points.push(makePoint());
      }
    }

    function makePoint() {
      return {
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.18,
        pull: Math.random() * 0.55 + 0.15
      };
    }

    function step() {
      for (var i = 0; i < points.length; i++) {
        var p = points[i];

        var dx = hub.x - p.x;
        var dy = hub.y - p.y;
        var dist = Math.sqrt(dx * dx + dy * dy) || 1;

        p.vx += (dx / dist) * 0.0018 * p.pull;
        p.vy += (dy / dist) * 0.0018 * p.pull;

        p.vx *= 0.985;
        p.vy *= 0.985;

        p.x += p.vx;
        p.y += p.vy;

        if (dist < 26) {
          var np = makePoint();
          p.x = np.x; p.y = np.y; p.vx = np.vx; p.vy = np.vy; p.pull = np.pull;
        }
        if (p.x < -20 || p.x > width + 20 || p.y < -20 || p.y > height + 20) {
          var rp = makePoint();
          p.x = rp.x; p.y = rp.y; p.vx = rp.vx; p.vy = rp.vy;
        }
      }
    }

    function draw() {
      ctx.clearRect(0, 0, width, height);

      // connections between nearby points
      for (var i = 0; i < points.length; i++) {
        for (var j = i + 1; j < points.length; j++) {
          var a = points[i], b = points[j];
          var dx = a.x - b.x, dy = a.y - b.y;
          var d = Math.sqrt(dx * dx + dy * dy);
          if (d < 130) {
            var alpha = (1 - d / 130) * 0.16;
            ctx.strokeStyle = "rgba(156, 160, 166, " + alpha + ")";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }

        // connection into the hub for nearby points
        var hd = Math.sqrt((points[i].x - hub.x) * (points[i].x - hub.x) + (points[i].y - hub.y) * (points[i].y - hub.y));
        if (hd < 260) {
          var hAlpha = (1 - hd / 260) * 0.3;
          ctx.strokeStyle = "rgba(47, 190, 134, " + hAlpha + ")";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(points[i].x, points[i].y);
          ctx.lineTo(hub.x, hub.y);
          ctx.stroke();
        }
      }

      // points
      ctx.fillStyle = "rgba(156, 160, 166, 0.55)";
      for (var k = 0; k < points.length; k++) {
        ctx.beginPath();
        ctx.arc(points[k].x, points[k].y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }

      // hub
      var grad = ctx.createRadialGradient(hub.x, hub.y, 0, hub.x, hub.y, 70);
      grad.addColorStop(0, "rgba(47, 190, 134, 0.22)");
      grad.addColorStop(1, "rgba(47, 190, 134, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(hub.x, hub.y, 70, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#2FBE86";
      ctx.beginPath();
      ctx.arc(hub.x, hub.y, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    function loop() {
      if (!running) return;
      step();
      draw();
      rafId = requestAnimationFrame(loop);
    }

    function start() {
      if (running) return;
      running = true;
      rafId = requestAnimationFrame(loop);
    }

    function stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
    }

    resize();

    if (reduceMotion) {
      draw();
    } else {
      start();

      if ("IntersectionObserver" in window) {
        var heroObserver = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) start(); else stop();
          });
        }, { threshold: 0 });
        heroObserver.observe(hero);
      }

      document.addEventListener("visibilitychange", function () {
        if (document.hidden) stop(); else if (!reduceMotion) start();
      });

      var resizeTimer;
      window.addEventListener("resize", function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(resize, 200);
      });
    }
  }

  /* ======================================================================
     Network diagram — draws connecting lines in on scroll, tier by tier.
     ====================================================================== */

  var diagram = document.getElementById("network-diagram");

  if (diagram) {
    var groups = [
      { selector: ".net-lines--in", delay: 0 },
      { selector: ".net-lines--core", delay: 500 },
      { selector: ".net-lines--out", delay: 900 }
    ];

    var allLines = [];
    groups.forEach(function (g) {
      var lines = diagram.querySelectorAll(g.selector + " .net-line");
      lines.forEach(function (line, idx) {
        var length = line.getTotalLength();
        line.style.strokeDasharray = length;
        line.style.strokeDashoffset = reduceMotion ? 0 : length;
        allLines.push({ el: line, delay: g.delay + idx * 60 });
      });
    });

    function playDiagram() {
      diagram.classList.add("in-view");
      allLines.forEach(function (item) {
        setTimeout(function () {
          item.el.style.strokeDashoffset = 0;
        }, item.delay);
      });
    }

    if (reduceMotion) {
      diagram.classList.add("in-view");
    } else if ("IntersectionObserver" in window) {
      var diagramObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            playDiagram();
            diagramObserver.unobserve(entry.target);
          }
        });
      }, { threshold: 0.3 });
      diagramObserver.observe(diagram);
    } else {
      playDiagram();
    }
  }

})();
