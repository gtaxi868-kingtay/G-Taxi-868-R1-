/* ============================================================
   G 868
   No scroll listeners anywhere: IntersectionObserver for reveals,
   rAF only while an element is actually on screen.
   ============================================================ */
(() => {
  'use strict';

  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Supabase (anon key is public by design) ---------- */
  const SUPABASE_URL = 'https://ffbbuafgeypvkpcuvdnv.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmYmJ1YWZnZXlwdmtwY3V2ZG52Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5Mzc5ODAsImV4cCI6MjA4NjUxMzk4MH0.0bvE6YskOdVROtbto3RrJA9Vj--9M2hKg76oZkOxia8';

  /* ============================================================
     1. Island canvas.
     A night seascape, not a map. Horizon low in frame, a Trinidad
     ridge silhouette with rolling Northern Range hills and the
     Chaguaramas peninsula reaching out at the NW tip, Tobago smaller
     and further off. One lit rim traces the skyline (the brand's
     lit-edge rule, applied to a horizon instead of a UI border). A
     column of moonlight-style shimmer on the water ties back to the
     pin floating above it. Village lights twinkle; they do NOT
     represent live signup counts, because that data does not exist
     yet. Light, not statistics.
     ============================================================ */

  // Skyline profile: x fraction across the landmass, height fraction
  // above the horizon baseline. Reads as a real coastline at this
  // scale, not a cartographic trace.
  const TRINIDAD_RIDGE = [
    [0.00,0.04],[0.04,0.05],[0.07,0.19],[0.10,0.24],[0.10,0.10],
    [0.15,0.16],[0.20,0.34],[0.24,0.52],[0.28,0.66],[0.33,0.56],
    [0.37,0.68],[0.41,0.80],[0.46,0.62],[0.52,0.46],[0.58,0.35],
    [0.65,0.27],[0.72,0.19],[0.80,0.24],[0.87,0.15],[0.94,0.08],
    [1.00,0.04]
  ];
  const TOBAGO_RIDGE = [
    [0.00,0.04],[0.14,0.20],[0.30,0.34],[0.48,0.44],
    [0.66,0.30],[0.84,0.17],[1.00,0.04]
  ];

  // Port of Spain, low and coastal, sitting in front of the Northern
  // Range so the hills still rise behind it. {x, w, h} are fractions
  // of the city's own block: position, width, height. Two taller
  // slabs mid-block read as the Twin Towers without spelling it out.
  const CITY_BLOCK = [
    {x:0.00,w:0.045,h:0.30},{x:0.045,w:0.035,h:0.20},{x:0.09,w:0.05,h:0.42},
    {x:0.15,w:0.03,h:0.22},{x:0.19,w:0.045,h:0.58},{x:0.245,w:0.035,h:0.32},
    {x:0.29,w:0.06,h:0.78},{x:0.36,w:0.055,h:0.74},{x:0.43,w:0.035,h:0.28},
    {x:0.475,w:0.045,h:0.48},{x:0.53,w:0.03,h:0.18},{x:0.57,w:0.05,h:0.36},
    {x:0.63,w:0.035,h:0.54},{x:0.675,w:0.045,h:0.24},{x:0.73,w:0.03,h:0.16},
    {x:0.77,w:0.05,h:0.40},{x:0.83,w:0.035,h:0.21},{x:0.875,w:0.045,h:0.13},
  ];

  function island(canvas){
    if(!canvas) return;
    const ctx = canvas.getContext('2d');
    let w = 0, h = 0, raf = 0, t = 0, live = false;
    let horizonY = 0, glowX = 0;
    let shimmer = [];
    let cityBaseX = 0, cityBaseW = 0, cityMaxH = 0, cityRects = [], cityLights = [], tallestIdx = 0;
    let traffic = { start: 0.5 + Math.random() * 0.5 };

    function layout(){
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const r = canvas.getBoundingClientRect();
      w = r.width; h = r.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      horizonY = h * 0.91;
      glowX = w * 0.60;

      // moonlight-on-water shimmer: denser near the horizon, sparser
      // further down, faint horizontal drift, per-dash twinkle
      shimmer = Array.from({length: 46}, (_, i) => {
        const depth = Math.pow(i / 46, 1.6);
        return {
          y: horizonY + 6 + depth * (h - horizonY - 6),
          baseX: glowX + (Math.random() - 0.5) * (60 + depth * (w * 0.5)),
          len: 10 + Math.random() * 34 * (1 - depth * 0.5),
          phase: Math.random() * 6.28,
          speed: 0.5 + Math.random() * 0.6,
        };
      });

      // Port of Spain: shorter than the hills behind it, sitting on
      // the coast left of centre so the horizon glow lights it from
      // the harbour side.
      cityBaseX = w * 0.05;
      cityBaseW = w * 0.46;
      cityMaxH = h * 0.055;

      cityRects = CITY_BLOCK.map(b => ({
        x: cityBaseX + b.x * cityBaseW,
        w: b.w * cityBaseW,
        h: b.h * cityMaxH,
      }));
      tallestIdx = cityRects.reduce((best, r, i) => r.h > cityRects[best].h ? i : best, 0);

      cityLights = [];
      cityRects.forEach(r => {
        const n = Math.max(2, Math.round(r.h / 6));
        for (let i = 0; i < n; i++){
          cityLights.push({
            x: r.x + 1.5 + Math.random() * Math.max(1, r.w - 3),
            y: horizonY - 2 - Math.random() * (r.h - 3),
            phase: Math.random() * 6.28,
            speed: 0.7 + Math.random() * 1.7,
            warm: Math.random() < 0.62,
          });
        }
      });
    }

    function ridge(pts, baseX, baseW, peakH){
      const path = new Path2D();
      pts.forEach(([x, hh], i) => {
        const px = baseX + x * baseW;
        const py = horizonY - hh * peakH;
        i ? path.lineTo(px, py) : path.moveTo(px, py);
      });
      return path;
    }

    function fillLand(pts, baseX, baseW, peakH){
      const path = ridge(pts, baseX, baseW, peakH);
      const last = pts[pts.length - 1], first = pts[0];
      path.lineTo(baseX + last[0] * baseW, horizonY + 2);
      path.lineTo(baseX + first[0] * baseW, horizonY + 2);
      path.closePath();
      ctx.fillStyle = '#05050B';
      ctx.fill(path);

      // one lit rim along the skyline only, never the full outline
      const lit = ctx.createLinearGradient(baseX, 0, baseX + baseW, 0);
      lit.addColorStop(0, 'rgba(109,40,217,.75)');
      lit.addColorStop(1, 'rgba(52,230,236,.75)');
      ctx.strokeStyle = lit;
      ctx.lineWidth = 1.1;
      ctx.stroke(ridge(pts, baseX, baseW, peakH));
    }

    function draw(){
      ctx.clearRect(0, 0, w, h);
      t += 0.008;

      // sky: near-black at the top, easing toward the horizon glow
      const sky = ctx.createLinearGradient(0, 0, 0, horizonY);
      sky.addColorStop(0, '#07070F');
      sky.addColorStop(1, '#0B0A17');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, horizonY);

      // horizon glow: the brand duality read as a light source, not a moon disc
      const hg = ctx.createRadialGradient(glowX, horizonY, 0, glowX, horizonY, w * 0.42);
      hg.addColorStop(0, 'rgba(52,230,236,.16)');
      hg.addColorStop(0.5, 'rgba(109,40,217,.08)');
      hg.addColorStop(1, 'rgba(7,7,15,0)');
      ctx.fillStyle = hg;
      ctx.fillRect(0, 0, w, horizonY);

      // sea
      const sea = ctx.createLinearGradient(0, horizonY, 0, h);
      sea.addColorStop(0, '#0A0B16');
      sea.addColorStop(1, '#05050B');
      ctx.fillStyle = sea;
      ctx.fillRect(0, horizonY, w, h - horizonY);

      // moonlight column on the water, tying to the pin's glow above it
      const col = ctx.createRadialGradient(glowX, horizonY, 0, glowX, h, h * 0.6);
      col.addColorStop(0, 'rgba(52,230,236,.10)');
      col.addColorStop(1, 'rgba(52,230,236,0)');
      ctx.fillStyle = col;
      ctx.fillRect(0, horizonY, w, h - horizonY);

      // shimmer dashes
      shimmer.forEach((s, i) => {
        const drift = Math.sin(t * s.speed + s.phase) * 5;
        const alpha = 0.5 * (0.5 + 0.5 * Math.sin(t * s.speed * 1.4 + s.phase));
        ctx.strokeStyle = `rgba(212,238,240,${alpha.toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(s.baseX + drift - s.len / 2, s.y);
        ctx.lineTo(s.baseX + drift + s.len / 2, s.y);
        ctx.stroke();
      });

      // Tobago: smaller, further right, set slightly back
      fillLand(TOBAGO_RIDGE, w * 0.74, w * 0.24, h * 0.05);
      // Trinidad: the main ridge, spanning most of the frame
      fillLand(TRINIDAD_RIDGE, w * -0.04, w * 0.86, h * 0.095);

      // village lights nested in the Trinidad ridge, twinkling
      TRINIDAD_RIDGE.forEach(([x, hh], i) => {
        if (hh < 0.22 || i % 2) return;
        const px = w * -0.04 + x * (w * 0.86);
        const py = horizonY - hh * (h * 0.095) * 0.55;
        const pulse = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 1.7 + i * 2.1));
        const halo = ctx.createRadialGradient(px, py, 0, px, py, 9 * pulse + 4);
        halo.addColorStop(0, `rgba(234,243,246,${0.5 * pulse})`);
        halo.addColorStop(1, 'rgba(234,243,246,0)');
        ctx.fillStyle = halo;
        ctx.beginPath(); ctx.arc(px, py, 9 * pulse + 4, 0, 6.284); ctx.fill();
        ctx.fillStyle = `rgba(255,255,255,${0.6 + 0.4 * pulse})`;
        ctx.beginPath(); ctx.arc(px, py, 1.1, 0, 6.284); ctx.fill();
      });

      // Port of Spain, foreground and darker than the hills behind it
      // so the two silhouettes separate at a glance
      cityRects.forEach(r => { ctx.fillStyle = '#030307'; ctx.fillRect(r.x, horizonY - r.h, r.w, r.h + 2); });

      // window lights: a stepped on/off blink, not a soft pulse, so the
      // city reads as switching rather than breathing like the hills do
      cityLights.forEach(L => {
        const s = Math.sin(t * L.speed + L.phase);
        const on = s > 0.35;
        const a = on ? 0.55 + 0.35 * s : 0.05;
        ctx.fillStyle = L.warm
          ? `rgba(255,214,170,${a.toFixed(3)})`
          : `rgba(198,240,244,${a.toFixed(3)})`;
        ctx.fillRect(L.x, L.y, 1.3, 1.3);
      });

      // one slow aviation beacon on the tallest slab
      const tall = cityRects[tallestIdx];
      if (tall){
        const bx = tall.x + tall.w / 2, by = horizonY - tall.h - 3;
        const on = (Math.sin(t * 1.05) + 1) / 2 > 0.86;
        if (on){
          const halo = ctx.createRadialGradient(bx, by, 0, bx, by, 7);
          halo.addColorStop(0, 'rgba(255,96,96,.55)');
          halo.addColorStop(1, 'rgba(255,96,96,0)');
          ctx.fillStyle = halo;
          ctx.beginPath(); ctx.arc(bx, by, 7, 0, 6.284); ctx.fill();
          ctx.fillStyle = 'rgba(255,120,120,.95)';
          ctx.beginPath(); ctx.arc(bx, by, 1.5, 0, 6.284); ctx.fill();
        }
      }

      // a single point of light drifting the coast road, fading in
      // and out at each end of its pass rather than popping on loop
      const cycle = ((t * 0.045 + traffic.start) % 1 + 1) % 1;
      const carX = cityBaseX - 14 + cycle * (cityBaseW + 28);
      const carA = Math.sin(cycle * Math.PI) * 0.55;
      if (carA > 0.02){
        const carY = horizonY - 1;
        const glow = ctx.createRadialGradient(carX, carY, 0, carX, carY, 5);
        glow.addColorStop(0, `rgba(214,246,248,${carA.toFixed(3)})`);
        glow.addColorStop(1, 'rgba(214,246,248,0)');
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(carX, carY, 5, 0, 6.284); ctx.fill();
        ctx.fillStyle = `rgba(255,255,255,${Math.min(1, carA + .25).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(carX, carY, 1, 0, 6.284); ctx.fill();
      }

      if (live && !REDUCED) raf = requestAnimationFrame(draw);
    }

    layout();
    draw();
    addEventListener('resize', () => { layout(); if (REDUCED || !live) draw(); }, {passive:true});

    // only animate while actually on screen
    new IntersectionObserver(es => {
      es.forEach(e => {
        live = e.isIntersecting;
        cancelAnimationFrame(raf);
        if (live && !REDUCED) raf = requestAnimationFrame(draw);
      });
    }, {threshold:0}).observe(canvas);
  }

  island(document.getElementById('island'));
  island(document.getElementById('island2'));

  /* ============================================================
     2. Reveals
     ============================================================ */
  const io = new IntersectionObserver(es => {
    es.forEach(e => { if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); } });
  }, {threshold:.16, rootMargin:'0px 0px -8% 0px'});
  document.querySelectorAll('[data-reveal]').forEach(el => io.observe(el));

  // deck + ride get their own trigger so the stagger reads properly
  ['deck','ride'].forEach(id => {
    const el = document.getElementById(id);
    if(!el) return;
    new IntersectionObserver((es, o) => {
      es.forEach(e => { if(e.isIntersecting){ el.classList.add('in'); o.disconnect(); } });
    }, {threshold:.25}).observe(el);
  });

  /* ============================================================
     3. Pin: cursor-reactive tilt. A few degrees, no more.
     ============================================================ */
  const pin = document.getElementById('pin');
  const hero = document.getElementById('hero');
  if(pin && hero && !REDUCED && matchMedia('(pointer:fine)').matches){
    const stage = pin.querySelector('.pin__stage');
    hero.addEventListener('pointermove', e => {
      const r = hero.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - .5;
      const py = (e.clientY - r.top) / r.height - .5;
      stage.style.setProperty('--ry', (px * 13).toFixed(2) + 'deg');
      stage.style.setProperty('--rx', (-py * 9).toFixed(2) + 'deg');
    }, {passive:true});
    hero.addEventListener('pointerleave', () => {
      stage.style.setProperty('--ry','0deg');
      stage.style.setProperty('--rx','0deg');
    }, {passive:true});
  }

  /* ============================================================
     4. Magnetic buttons (quickTo-style lerp, no dependency)
     ============================================================ */
  if(!REDUCED && matchMedia('(hover:hover) and (pointer:fine)').matches){
    document.querySelectorAll('.magnetic').forEach(el => {
      let tx=0, ty=0, cx=0, cy=0, raf=0, on=false;
      const loop = () => {
        cx += (tx - cx) * .16; cy += (ty - cy) * .16;
        // `translate`, not `transform`: an inline `transform` outranks the
        // :active rule and silently removes the press feedback. These are
        // independent properties, so scale-on-press still composes.
        el.style.translate = `${cx.toFixed(2)}px ${cy.toFixed(2)}px`;
        if(on || Math.abs(tx-cx) > .1 || Math.abs(ty-cy) > .1){
          raf = requestAnimationFrame(loop);
        }else{
          el.style.translate = '';
          el.style.willChange = '';   // only a layer while it is actually moving
        }
      };
      el.addEventListener('pointerenter', () => {
        on = true;
        el.style.willChange = 'translate';
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(loop);
      });
      el.addEventListener('pointermove', e => {
        const r = el.getBoundingClientRect();
        tx = (e.clientX - r.left - r.width/2) * .22;
        ty = (e.clientY - r.top - r.height/2) * .32;
      }, {passive:true});
      el.addEventListener('pointerleave', () => { on = false; tx = 0; ty = 0; });
    });
  }

  /* ============================================================
     5. Nav state, without a scroll listener
     ============================================================ */
  const nav = document.getElementById('nav');
  const sentinel = document.createElement('div');
  sentinel.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:90px;pointer-events:none';
  document.body.prepend(sentinel);
  new IntersectionObserver(es => {
    nav.classList.toggle('is-stuck', !es[0].isIntersecting);
  }, {threshold:0}).observe(sentinel);

  /* ============================================================
     6. Waitlist
     ============================================================ */
  const form   = document.getElementById('wl');
  const done   = document.getElementById('done');
  const btn    = document.getElementById('submit');
  const fErr   = document.getElementById('formErr');
  const params = new URLSearchParams(location.search);
  const REF    = params.get('ref') || null;

  const setErr = (id, msg) => {
    const p = document.querySelector(`[data-err="${id}"]`);
    const input = document.getElementById(id);
    if(p) p.textContent = msg || '';
    if(input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  };

  const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  const digits  = v => v.replace(/[^\d]/g, '');

  form?.addEventListener('submit', async e => {
    e.preventDefault();
    fErr.textContent = '';

    const name    = document.getElementById('f-name').value.trim();
    const contact = document.getElementById('f-contact').value.trim();
    const area    = document.getElementById('f-area').value.trim();
    const role    = form.querySelector('input[name=role]:checked').value;

    let ok = true;
    if(name.length < 2){ setErr('f-name','Please add your name.'); ok = false; } else setErr('f-name','');

    const email = isEmail(contact) ? contact.toLowerCase() : null;
    const phone = !email && digits(contact).length >= 7 ? contact : null;
    if(!email && !phone){
      setErr('f-contact','Enter a valid email address or WhatsApp number.'); ok = false;
    } else setErr('f-contact','');

    if(!ok){ form.querySelector('[aria-invalid=true]')?.focus(); return; }

    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = 'Claiming...';

    try{
      const res = await fetch(`${SUPABASE_URL}/rest/v1/waitlist`, {
        method:'POST',
        headers:{
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type':'application/json',
          Prefer:'return=minimal'
        },
        body: JSON.stringify({
          full_name: name,
          email,
          phone,
          community: area || null,
          user_type: role,          // rider | driver | merchant | commander
          source: 'g868',
          referred_by: REF
        })
      });

      if(!res.ok){
        const body = await res.text();
        // 23505 = unique violation. Today only email is unique; phone uniqueness
        // arrives with the planned migration.
        if(res.status === 409 || body.includes('23505')){
          setErr('f-contact', "You're already on the list with that contact.");
          btn.disabled = false; btn.textContent = label;
          return;
        }
        throw new Error(body || 'save failed');
      }

      form.hidden = true;
      done.hidden = false;
      done.querySelector('h3').focus?.();
      done.scrollIntoView({behavior: REDUCED ? 'auto' : 'smooth', block:'center'});
    }catch(err){
      fErr.textContent = 'Could not save that. Check your connection and try again.';
      btn.disabled = false;
      btn.textContent = label;
    }
  });

  /* ---------- share ---------- */
  const shareUrl = () => {
    const u = new URL(location.href);
    u.search = '';
    u.hash = '';
    if(REF) u.searchParams.set('ref', REF);
    return u.toString();
  };
  const SHARE_TEXT = 'G 868 is coming to Trinidad and Tobago. Add your area so we land there sooner: ';

  document.getElementById('copyLink')?.addEventListener('click', async e => {
    const b = e.currentTarget;
    try{
      await navigator.clipboard.writeText(shareUrl());
      const t = b.textContent; b.textContent = 'Copied';
      setTimeout(() => { b.textContent = t; }, 1800);
    }catch{
      b.textContent = shareUrl();
    }
  });

  const wa = document.getElementById('waLink');
  if(wa) wa.href = `https://wa.me/?text=${encodeURIComponent(SHARE_TEXT + shareUrl())}`;
})();
