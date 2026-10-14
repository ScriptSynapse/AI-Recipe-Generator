/**
 * landing.js -- motion and placeholders for the landing page.
 *  - the request-path illustration (a loop: one request passes, one is blocked)
 *  - count-up for the four facts
 *  - gentle reveal of the feature rows
 *  - swaps a screenshot / video placeholder for the real file once it exists
 * No HTML-string DOM writes; nothing here talks to the API. With reduced motion, or with
 * scripting off, the page shows its final state and nothing moves.
 */
(function () {
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (id) => document.getElementById(id);

  // ---- request-path illustration -----------------------------------------
  const flow = $('flow');
  if (flow) {
    const ok = flow.querySelector('.lane-ok');
    const bad = flow.querySelector('.lane-bad');
    const tokOk = $('token-ok'); const tokBad = $('token-bad');
    const resOk = $('result-ok'); const resBad = $('result-bad');
    const setPos = (lane, tok, p) => {
      lane.classList.remove('p0', 'p1', 'p2', 'p3', 'p4');
      lane.classList.add(`p${p}`);
      tok.style.setProperty('--pos', String(p));
    };
    const reset = () => {
      setPos(ok, tokOk, 0); setPos(bad, tokBad, 0);
      bad.classList.remove('blocked');
      resOk.classList.remove('show'); resBad.classList.remove('show');
    };
    const final = () => {
      setPos(ok, tokOk, 4); setPos(bad, tokBad, 1);
      bad.classList.add('blocked');
      resOk.classList.add('show'); resBad.classList.add('show');
    };
    // [delay since previous step in ms, action]
    const script = [
      [900, () => { setPos(ok, tokOk, 1); setPos(bad, tokBad, 1); }],
      [900, () => { setPos(ok, tokOk, 2); bad.classList.add('blocked'); }],
      [500, () => resBad.classList.add('show')],
      [700, () => setPos(ok, tokOk, 3)],
      [900, () => setPos(ok, tokOk, 4)],
      [500, () => resOk.classList.add('show')],
      [4200, () => { resOk.classList.remove('show'); resBad.classList.remove('show'); }],
      [700, reset],
    ];

    if (reduce) {
      final();
    } else {
      let visible = true; let timer = null; let i = 0;
      const tick = () => {
        timer = null;
        if (!visible || document.hidden) return;     // paused: resumes when it is on screen again
        const [wait, action] = script[i];
        timer = setTimeout(() => { action(); i = (i + 1) % script.length; tick(); }, wait);
      };
      reset(); i = 0; tick();
      const resume = () => { if (!timer) tick(); };
      document.addEventListener('visibilitychange', resume);
      if ('IntersectionObserver' in window) {
        new IntersectionObserver((entries) => { visible = entries[0].isIntersecting; if (visible) resume(); }).observe(flow);
      }
    }
  }

  // ---- count-up -------------------------------------------------------------
  const counters = document.querySelectorAll('[data-count]');
  const animateCount = (el) => {
    const target = Number(el.getAttribute('data-count'));
    if (!Number.isFinite(target)) return;
    const start = performance.now(); const dur = 900;
    const frame = (now) => {
      const t = Math.min(1, (now - start) / dur);
      el.textContent = String(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) requestAnimationFrame(frame);
    };
    el.textContent = '0';
    requestAnimationFrame(frame);
  };
  if (!reduce && 'IntersectionObserver' in window && counters.length) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { animateCount(e.target); io.unobserve(e.target); } });
    }, { threshold: 0.6 });
    counters.forEach((c) => io.observe(c));
  }

  // ---- reveal ------------------------------------------------------------------
  const reveals = document.querySelectorAll('.reveal');
  if (!reduce && 'IntersectionObserver' in window && reveals.length) {
    document.body.classList.add('js-reveal');
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.18 });
    reveals.forEach((r) => io.observe(r));
  }

  // ---- placeholders become real once the file exists -------------------------
  document.querySelectorAll('.shot[data-src]').forEach((fig) => {
    const img = new Image();
    img.onload = () => {
      img.alt = fig.getAttribute('data-alt') || '';
      img.loading = 'lazy';
      fig.textContent = '';
      fig.appendChild(img);
    };
    img.src = fig.getAttribute('data-src');     // a missing file just leaves the placeholder
  });

  const videoFig = $('demo-video');
  if (videoFig) {
    const video = document.createElement('video');
    video.controls = true; video.preload = 'metadata'; video.playsInline = true;
    video.setAttribute('aria-label', 'RecipeAI Sentinel demo video');
    video.addEventListener('loadedmetadata', () => { videoFig.textContent = ''; videoFig.appendChild(video); });
    video.src = videoFig.getAttribute('data-src');
  }
})();
