/* ============================================================
   G 868 — "Tap in. Own it."
   No build step, no dependencies. No scroll listeners: panels are
   overlays, not sections, so the only motion budget is the hero's
   CSS-driven orbs/rings (never per-frame JS) and the panel's own
   open/close transition.
   ============================================================ */
(() => {
  'use strict';

  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Supabase (anon key is public by design) ---------- */
  const SUPABASE_URL = 'https://ffbbuafgeypvkpcuvdnv.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmYmJ1YWZnZXlwdmtwY3V2ZG52Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5Mzc5ODAsImV4cCI6MjA4NjUxMzk4MH0.0bvE6YskOdVROtbto3RrJA9Vj--9M2hKg76oZkOxia8';

  /* ============================================================
     0. helpers
     ============================================================ */
  const esc = s => String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));

  /* ============================================================
     1. Floating glass orbs — a static set, instantiated once (never
     a per-frame loop). CSS keyframes do the drifting. ~13 orbs is
     enough to read as "a lot" without becoming a rendering cost.
     ============================================================ */
  // Positions deliberately avoid the two text columns (hero__left: roughly
  // x 0-40%, y 12-72% -- eyebrow through the CTA/badge; hero__right:
  // roughly x 58-100%, y 8-88% -- the role carousel through "Owned here.")
  // so a bright orb never glows directly behind copy or a button. Found
  // live: the original placements put a 96px "868" orb right behind the
  // primary CTA and a 110px one behind the role carousel, both reading as
  // overlap against the translucent button/card backgrounds.
  const ORB_CONFIGS = [
    {top:'6%',  left:'1%',  size:50,  tint:'rgba(124,58,237,.4)', glow:'rgba(124,58,237,.5)', dur:15, delay:0,    num:false},
    {top:'80%', left:'50%', size:70,  tint:'rgba(34,211,238,.35)',glow:'rgba(34,211,238,.5)', dur:18, delay:1.2,  num:'868', numSize:'1.5rem'},
    {top:'92%', left:'20%', size:36,  tint:'rgba(240,171,252,.4)',glow:'rgba(240,171,252,.5)',dur:13, delay:2.4,  num:false},
    {top:'3%',  left:'34%', size:34,  tint:'rgba(94,234,212,.4)', glow:'rgba(94,234,212,.5)', dur:12, delay:.6,   num:false},
    {top:'18%', left:'47%', size:56,  tint:'rgba(124,58,237,.35)',glow:'rgba(124,58,237,.45)',dur:17, delay:3.1,  num:false},
    {top:'92%', left:'62%', size:64,  tint:'rgba(34,211,238,.3)', glow:'rgba(34,211,238,.45)',dur:16, delay:1.8,  num:'868', numSize:'1.2rem'},
    {top:'3%',  left:'88%', size:60,  tint:'rgba(240,171,252,.35)',glow:'rgba(240,171,252,.45)',dur:14,delay:.2,  num:false},
    {top:'62%', left:'97%', size:80,  tint:'rgba(124,58,237,.4)', glow:'rgba(124,58,237,.5)', dur:19, delay:2.6,  num:'868', numSize:'1.7rem'},
    {top:'92%', left:'90%', size:40,  tint:'rgba(94,234,212,.35)',glow:'rgba(94,234,212,.45)',dur:11, delay:1.4,  num:false},
    {top:'56%', left:'50%', size:40,  tint:'rgba(34,211,238,.3)', glow:'rgba(34,211,238,.4)', dur:15, delay:3.4,  num:false},
    {top:'2%',  left:'62%', size:30,  tint:'rgba(240,171,252,.4)',glow:'rgba(240,171,252,.5)', dur:10, delay:.9,  num:false},
    {top:'70%', left:'2%',  size:24,  tint:'rgba(124,58,237,.35)',glow:'rgba(124,58,237,.45)', dur:12, delay:2.1, num:false},
    {top:'46%', left:'99%', size:22,  tint:'rgba(94,234,212,.4)', glow:'rgba(94,234,212,.5)', dur:9,  delay:.4,   num:false},
  ];

  function buildOrbs(){
    const host = document.getElementById('orbs');
    if(!host) return;
    const frag = document.createDocumentFragment();
    ORB_CONFIGS.forEach(o => {
      const el = document.createElement('span');
      el.className = 'orb';
      el.style.top = o.top;
      el.style.left = o.left;
      el.style.width = o.size + 'px';
      el.style.height = o.size + 'px';
      el.style.setProperty('--orb-tint', o.tint);
      el.style.setProperty('--orb-glow', o.glow);
      el.style.setProperty('--orb-dur', o.dur + 's');
      el.style.setProperty('--orb-delay', o.delay + 's');
      if(o.num){
        el.style.setProperty('--orb-num-size', o.numSize || '1.2rem');
        const num = document.createElement('span');
        num.className = 'orb__num';
        num.textContent = o.num;
        el.appendChild(num);
      }
      frag.appendChild(el);
    });
    host.appendChild(frag);
  }
  buildOrbs();

  /* ============================================================
     2. Role data — hero carousel + role detail panels share this.
     ============================================================ */
  const ROLES = {
    rider: {
      label: 'Rider', accent: '#c084fc',
      heroLine: 'Tap a stand or a shop counter and the car comes to you. No address to spell out — and more of G opens up the more you ride.',
      ctaLabel: 'See what a Rider gets',
      eyebrow: 'For riders',
      heading: 'One tap gets you moving.',
      lede: 'Tap the puck at a stand or a shop counter and a car comes to where you’re standing. No address to spell out, no explaining the corner you’re on. Then the rest of G opens up as you go.',
      perks: [
        {title:'Rides that know where you are', body:'Tap a G point and the pickup is set. It’s the easiest booking on the island — and it works even before you download anything.'},
        {title:'More unlocks as you ride', body:'Five rides brings Market. Two Market orders bring Laundry. Nothing is dumped on you at once — you grow into it.'},
        {title:'Better rates the longer you stay', body:'Regular, Loyal, Elite, G-Member — up to 12% back on what you spend, plus priority when the island is busy.'},
      ],
      ladderTitle: 'What opens up, and when',
      steps: [
        {when:'Day one', what:'Ride (tap any stand or counter)'},
        {when:'5 rides', what:'Market (groceries brought to you)'},
        {when:'2 Market orders', what:'Laundry, and Tap to pay in shops'},
        {when:'1 Laundry order', what:'Wallet bonus (top up TTD 200, get 220)'},
        {when:'Wallet funded', what:'G-Escape (regional trips, when it opens)'},
      ],
      tiers: ['New Rider','Regular · 5%','Loyal · 8%','Elite · 10%','G-Member · 12% + priority'],
    },
    driver: {
      label: 'Driver', accent: '#22d3ee',
      heroLine: 'Every fare pays 80% straight to your wallet — 78% where a G-Lead runs the territory — and both are paid before anything else.',
      ctaLabel: 'See what a Driver gets',
      eyebrow: 'For drivers',
      heading: 'Keep 80% of every fare.',
      lede: 'You already do the work. This is about how much of it you keep — and what you can build on top of it once you have been driving a while.',
      perks: [
        {title:'80% of the fare, plainly stated', body:'No shifting commission, no surprise deductions. 78% in territories with an active G-Lead, and you will always be told which one you are in.'},
        {title:'Earn from who you bring in', body:'1% on every driver you introduce, and TTD 500 for every hotel that comes on through you.'},
        {title:'A territory of your own', body:'At 500 rides you qualify to run one: recruit your own drivers and shops, and earn on the area you built.'},
      ],
      ladderTitle: 'How a driver moves up',
      steps: [
        {when:'Day one', what:'80% of every fare, paid to your wallet'},
        {when:'First referral', what:'1% of what every driver you bring in earns'},
        {when:'First hotel', what:'TTD 500 for each hotel introduced'},
        {when:'500 rides', what:'You qualify to run a territory'},
        {when:'As G-Lead', what:'2% override on the whole area you build'},
      ],
      tiers: ['New Driver','Verified','Trusted · priority dispatch','Territory-eligible · 500 rides'],
    },
    partner: {
      label: 'G-Partner', accent: '#f0abfc',
      heroLine: 'A tap at your counter is a booked ride. You earn on the traffic you already have — no card machine, no terminal fee.',
      ctaLabel: 'See what a G-Partner gets',
      eyebrow: 'For shops & counters',
      heading: 'Your counter starts earning.',
      lede: 'A puck on your counter turns your shop into a taxi stand and a storefront at the same time — and you get paid for the traffic you already have.',
      perks: [
        {title:'A share of every ride that starts with you', body:'Customers tap at your counter to get a car. You earn on it, whether or not they buy a thing that day.'},
        {title:'Sell and take payment by tap', body:'List what you stock and take wallet payments on the spot — no card machine to rent, no terminal fees, no percentage skimmed off your own sales.'},
        {title:'You are the trusted face', body:'People sign up because you vouch for it. That trust is the product — and it is credited to you.'},
        {title:'90 days pinned on the map, free', body:'Every G-Partner opens with their shop pinned for riders to find. Keep it after that for TTD 150 a month — and only if the traffic has earned it.'},
      ],
      ladderTitle: 'How a counter grows',
      steps: [
        {when:'Day one', what:'A G-Touch puck on your counter, free'},
        {when:'First taps', what:'You earn on every ride that starts with you'},
        {when:'Catalog live', what:'Sell your stock and take wallet payments'},
        {when:'Steady traffic', what:'Your shop is listed as a pickup point island-wide'},
        {when:'First 90 days', what:'Pinned on the G map, free — no card, no catch'},
        {when:'After 90 days', what:'Stay pinned for TTD 150 a month, or step back to the free listing'},
      ],
      tiers: ['Listed','Active counter','Pickup point','Anchor · higher share'],
    },
    lead: {
      label: 'G-Lead', accent: '#5eead4',
      heroLine: 'Recruit the drivers and counters in your area, and its 2% override keeps paying as long as you’re the one running it.',
      ctaLabel: 'See what a G-Lead gets',
      eyebrow: 'For area builders',
      heading: 'Build your area. Earn on it.',
      lede: 'A G-Lead opens a community: signing up the drivers, the shops and the stands that make it work, then earning from it for as long as it runs.',
      perks: [
        {title:'2% override on your territory', body:'Every ride in the area you built pays you — not once, but for as long as you’re running it.'},
        {title:'Recruit your own network', body:'Your drivers, your merchants, your stands. You decide who represents the area.'},
        {title:'Name your successor', body:'What you build stays with someone you choose. The territory is yours to hand on.'},
      ],
      ladderTitle: 'How a territory is built',
      steps: [
        {when:'Qualify', what:'500 rides as a driver, or invitation'},
        {when:'Sign the stands', what:'Recruit drivers and G-Partner counters'},
        {when:'Area switches on', what:'Your community goes live for riders'},
        {when:'Running', what:'2% override on every ride in the area'},
        {when:'Hand on', what:'Name the successor who takes it forward'},
      ],
      tiers: ['Candidate','Building','Live territory · 2%','Succession named'],
    },
  };

  // maps a hero-carousel role key to the short code the DB expects
  const ROLE_DB_CODE = { rider:'rider', driver:'driver', partner:'merchant', lead:'commander' };
  // maps a <select> label back to a role key (used by the waitlist form)
  const ROLE_SELECT_TO_KEY = {
    'Rider':'rider', 'Driver':'driver',
    'G-Partner (merchant)':'partner', 'G-Lead (territory)':'lead',
  };

  /* ============================================================
     3. Panel content builders
     ============================================================ */
  function ladderRows(steps, hiLast){
    return steps.map((s,i) => `
      <div class="p-ladder__row${hiLast && i === steps.length-1 ? ' p-ladder__row--hi' : ''}">
        <span class="p-ladder__label">${esc(s.when)}</span>
        <span class="p-ladder__value">${esc(s.what)}</span>
      </div>`).join('');
  }

  function tierPills(tiers){
    return tiers.map((t,i) => `<span class="p-pill${i === tiers.length-1 ? ' p-pill--hi' : ''}">${esc(t)}</span>`).join('');
  }

  const PANEL_BUILDERS = {
    tap(){
      return `
        <p class="p-eyebrow">01 — The Tap</p>
        <h2 class="p-heading" id="panelHeading">No app needed<br>to get moving.</h2>
        <p class="p-body">G-Touch Points are small NFC pucks sitting on shop counters and taxi stands across the island. Anyone can build an app in a weekend — but trust is built one counter at a time, and that’s what these are.</p>
        <div class="p-cards">
          <div class="p-card" style="--card-accent:#22d3ee">
            <h3 class="p-card__title">Tap at a stand</h3>
            <p class="p-card__body">Books a ride from exactly where you’re standing — no address to type, nothing to explain.</p>
          </div>
          <div class="p-card" style="--card-accent:#c084fc">
            <h3 class="p-card__title">Tap at a shop</h3>
            <p class="p-card__body">Opens that shop’s services, or pays straight from your wallet. People trust their shopkeeper — so the shopkeeper is the welcome.</p>
          </div>
          <div class="p-card p-card--tint">
            <h3 class="p-card__title">The counter earns</h3>
            <p class="p-card__body">A G-Partner earns a share of every ride that starts at their shop. The counter they already stand behind becomes a taxi stand too.</p>
          </div>
        </div>`;
    },
    ladder(){
      return `
        <p class="p-eyebrow">02 — Progression</p>
        <h2 class="p-heading" id="panelHeading">You earn the island.</h2>
        <p class="p-body">Most apps hand you eleven services on day one and you end up using one. G starts with a ride, and opens up as you go — so it grows at your pace, and every step is one you’ve already earned.</p>
        <div class="p-ladder">
          ${ladderRows([
            {when:'Start', what:'Ride'},
            {when:'5 rides', what:'Market — groceries delivered'},
            {when:'2 Market orders', what:'Laundry + Tap'},
            {when:'1 Laundry order', what:'Wallet bonus — top up TTD 200, get 220'},
            {when:'Fund your wallet', what:'G-Escape'},
          ], true)}
        </div>
        <div class="p-tiers">
          <p class="p-tiers__label">And you climb</p>
          <div class="p-tiers__row">${tierPills(['New Rider','Regular · 5%','Loyal · 8%','Elite · 10%','G-Member · 12% + priority'])}</div>
        </div>`;
    },
    split(){
      const bar = (label, value, width, gradA, gradB, caption) => `
        <div>
          <div class="p-bar__row"><span class="p-bar__label">${esc(label)}</span><span class="p-bar__value" style="color:${gradB}">${esc(value)}</span></div>
          <div class="p-bar__track"><div class="p-bar__fill" style="width:${width};background:linear-gradient(90deg,${gradA},${gradB})"></div></div>
          ${caption ? `<p class="p-bar__caption">${esc(caption)}</p>` : ''}
        </div>`;
      return `
        <p class="p-eyebrow">03 — The Split</p>
        <h2 class="p-heading" id="panelHeading">Where the money goes<br>is the whole point.</h2>
        <p class="p-body">Every G ride pays a Trinidadian driver, a Trinidadian shopkeeper and a Trinidadian territory operator — and sets a slice aside to help open the next community. Here’s exactly how it splits.</p>
        <div class="p-bars">
          ${bar('Driver', '80%', '80%', '#22d3ee', '#7c3aed', '78% where a territory has an active G-Lead')}
          ${bar('G-Lead override', '2%', '14%', '#f0abfc', '#c084fc', '')}
          ${bar('Capital reserve', '1.5%', '11%', '#5eead4', '#22d3ee', '')}
          <div class="p-plain-row">
            <span class="p-plain-row__label">G-Partner counter share</span>
            <span class="p-plain-row__value">a share of the platform’s own take</span>
          </div>
        </div>
        <p class="p-callout">The reserve is what pays for referrals — so growth never comes quietly out of a driver’s earnings. If the reserve is empty, the payout waits. We’d rather be honest about the limit than invent money we don’t have.</p>`;
    },
    escape(){
      return `
        <p class="p-eyebrow">05 — G-Escape</p>
        <h2 class="p-heading" id="panelHeading">The Caribbean deserves<br>better ways home.</h2>
        <p class="p-body">Routes get cut because no airline can see enough demand to justify them — then nobody flies them, which proves the airline right. G-Escape aggregates the demand instead: groups pool into flight-plus-lodging packages with a tipping point, and riders can <b>open a lane</b> — pick a destination and a month, and if enough hands go up it becomes a real demand case with real names attached.</p>
        <p class="p-body p-body--big">Not "we think people want to fly Port of Spain to St. Vincent." <b style="color:var(--cyan)">Here are 180 people who put their hands up for March.</b></p>
        <p class="p-note">Rides fund the network. Escape is what makes it regional. Currently switched off.</p>`;
    },
  };

  function buildRolePanel(key){
    const r = ROLES[key];
    return `
      <p class="p-eyebrow">${esc(r.eyebrow)}</p>
      <h2 class="p-heading" id="panelHeading">${esc(r.heading)}</h2>
      <p class="p-body">${esc(r.lede)}</p>
      <div class="p-cards${r.perks.length > 3 ? ' p-cards--2col' : ''}">
        ${r.perks.map((p,i) => `
          <div class="p-card${i === 0 || i >= 3 ? ' p-card--tint' : ''}">
            <h3 class="p-card__title" style="--card-accent:${r.accent}">${esc(p.title)}</h3>
            <p class="p-card__body">${esc(p.body)}</p>
          </div>`).join('')}
      </div>
      <h3 class="p-sub">${esc(r.ladderTitle)}</h3>
      <div class="p-ladder">${ladderRows(r.steps)}</div>
      <div class="p-tiers">
        <p class="p-tiers__label">Tiers</p>
        <div class="p-tiers__row">${tierPills(r.tiers)}</div>
      </div>
      ${waitlistFormMarkup(key)}`;
  }

  function waitlistFormMarkup(roleKey){
    const r = roleKey ? ROLES[roleKey] : null;
    const heading = r ? `Join as a ${esc(r.label)}.` : 'Help us open<br>your area first.';
    const eyebrow = 'Put your hand up';
    const submitLabel = r ? `Join as ${esc(r.label)}` : 'Count me in';
    const areaOptions = [
      'Port of Spain','San Fernando','Chaguanas','Arima',
      'Diego Martin / Westmoorings','Tunapuna / St. Augustine',
      'Couva / Point Lisas','Sangre Grande','Princes Town / Debe','Tobago',
    ];
    const roleOptions = ['Rider','Driver','G-Partner (merchant)','G-Lead (territory)'];
    const preselectLabel = r ? Object.keys(ROLE_SELECT_TO_KEY).find(k => ROLE_SELECT_TO_KEY[k] === roleKey) : null;

    return `
      <div class="waitlist-block" style="margin-top:${r ? '3em' : '0'};padding-top:${r ? '2em' : '0'};${r ? 'border-top:1px solid var(--hair)' : ''}">
        <p class="p-eyebrow">${eyebrow}</p>
        <h2 class="p-heading" ${r ? '' : 'id="panelHeading"'}>${heading}</h2>
        <p class="p-body">A community comes alive when there are enough drivers to answer and enough shops worth opening. Tell us where you are and how you’d like to join — every hand counts toward switching your area on.</p>

        <form class="form" id="wl" novalidate data-submit-label="${esc(submitLabel)}">
          <div class="field">
            <label for="f-name">Full name</label>
            <input id="f-name" name="name" type="text" autocomplete="name" required>
            <p class="err" data-err="f-name"></p>
          </div>

          <div class="field">
            <label for="f-email">Email</label>
            <input id="f-email" name="email" type="email" placeholder="you@email.tt" autocomplete="email" required>
            <p class="err" data-err="f-email"></p>
          </div>

          <div class="field">
            <label for="f-area">Your area</label>
            <select id="f-area" name="area" autocomplete="address-level2">
              <option value="" disabled selected>Choose your area</option>
              ${areaOptions.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('')}
            </select>
          </div>

          <div class="field">
            <label for="f-role">I want to join as</label>
            <select id="f-role" name="role" required>
              <option value="" disabled ${preselectLabel ? '' : 'selected'}>Choose one</option>
              ${roleOptions.map(o => `<option value="${esc(o)}" ${o === preselectLabel ? 'selected' : ''}>${esc(o)}</option>`).join('')}
            </select>
          </div>

          <button class="btn btn--submit btn--full magnetic" type="submit" id="submit">
            <span id="submitLabel">${esc(submitLabel)}</span>
            <span class="btn__arrow" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
            </span>
          </button>
          <p class="err err--form" id="formErr" role="alert"></p>
          <p class="form__fine">Nothing to pay and nothing to install yet — we’re simply counting who’s ready, area by area. Your details stay with us.</p>
        </form>

        <div class="done" id="done" hidden>
          <span class="done__tick" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4.5 4.5L19 7"/></svg>
          </span>
          <h3 class="p-sub" style="margin-top:0">You’re on the map.</h3>
          <p class="p-body" style="margin-bottom:0">Your area moves up every time someone else from it joins. Send them this link.</p>
          <div class="done__actions">
            <button class="btn btn--ghost" id="copyLink" type="button">Copy your link</button>
            <a class="btn" id="waLink" href="#" target="_blank" rel="noopener">Share on WhatsApp</a>
          </div>
        </div>
      </div>`;
  }

  PANEL_BUILDERS.waitlist = () => waitlistFormMarkup(null);
  ['rider','driver','partner','lead'].forEach(k => { PANEL_BUILDERS['role:' + k] = () => buildRolePanel(k); });

  /* ============================================================
     4. Panel overlay controller — focus trap, Escape, backdrop click,
     return focus.
     ============================================================ */
  const overlay = document.getElementById('overlay');
  const scrim = document.getElementById('scrim');
  const panelEl = document.getElementById('panel');
  const panelBody = document.getElementById('panelBody');
  const panelClose = document.getElementById('panelClose');
  let lastFocused = null;

  function focusablesIn(el){
    return Array.from(el.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(n => n.offsetParent !== null);
  }

  function trapKeydown(e){
    if(e.key === 'Escape'){ e.preventDefault(); closePanel(); return; }
    if(e.key !== 'Tab') return;
    const items = focusablesIn(overlay);
    if(!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
  }

  function openPanel(key, opener){
    const build = PANEL_BUILDERS[key];
    if(!build) return;
    lastFocused = opener || document.activeElement;
    panelBody.innerHTML = build();
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    panelEl.scrollTop = 0;
    wireFormIn(panelBody);
    document.addEventListener('keydown', trapKeydown, true);
    // move focus into the panel
    requestAnimationFrame(() => {
      const heading = document.getElementById('panelHeading');
      (heading || panelEl).setAttribute('tabindex', heading ? (heading.getAttribute('tabindex') || '-1') : '-1');
      (heading || panelEl).focus();
    });
  }

  function closePanel(){
    if(overlay.hidden) return;
    overlay.hidden = true;
    document.body.style.overflow = '';
    document.removeEventListener('keydown', trapKeydown, true);
    if(lastFocused && document.contains(lastFocused)) lastFocused.focus();
    lastFocused = null;
  }

  document.querySelectorAll('[data-panel]').forEach(el => {
    el.addEventListener('click', e => openPanel(el.getAttribute('data-panel'), el));
  });
  document.querySelectorAll('[data-nav-home]').forEach(el => {
    el.addEventListener('click', e => { e.preventDefault(); closePanel(); });
  });
  panelClose.addEventListener('click', closePanel);
  scrim.addEventListener('click', closePanel);

  /* ============================================================
     5. Hero role carousel
     ============================================================ */
  const roleCards = Array.from(document.querySelectorAll('.role-card'));
  const roleDesc = document.getElementById('roleDesc');
  const roleCta = document.getElementById('roleCta');
  let activeRole = 'rider';

  function setActiveRole(key){
    if(!ROLES[key]) return;
    activeRole = key;
    roleCards.forEach(c => {
      const on = c.getAttribute('data-role') === key;
      c.classList.toggle('is-active', on);
      c.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    roleDesc.textContent = ROLES[key].heroLine;
    roleCta.textContent = ROLES[key].ctaLabel + ' →';
  }
  setActiveRole('rider');

  roleCards.forEach(card => {
    const key = card.getAttribute('data-role');
    card.addEventListener('click', () => setActiveRole(key));
    card.addEventListener('focus', () => setActiveRole(key));
    if(!REDUCED && matchMedia('(hover:hover) and (pointer:fine)').matches){
      card.addEventListener('pointerenter', () => setActiveRole(key));
    }
  });
  roleCta.addEventListener('click', () => openPanel('role:' + activeRole, roleCta));

  /* ============================================================
     6. Waitlist submit — wired fresh each time the form is (re)built
     inside the panel body, since the panel content is swapped in.
     ============================================================ */
  const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  function wireFormIn(root){
    const form = root.querySelector('#wl');
    if(!form) return;
    const done = root.querySelector('#done');
    const btn = root.querySelector('#submit');
    const submitLabelEl = root.querySelector('#submitLabel');
    const fErr = root.querySelector('#formErr');
    const params = new URLSearchParams(location.search);
    const REF = params.get('ref') || null;

    const setErr = (id, msg) => {
      const p = root.querySelector(`[data-err="${id}"]`);
      const el = root.querySelector(`#${id}`);
      if(p) p.textContent = msg || '';
      if(el) el.setAttribute('aria-invalid', msg ? 'true' : 'false');
    };

    form.addEventListener('submit', async e => {
      e.preventDefault();
      if(fErr) fErr.textContent = '';

      const name = form.querySelector('#f-name').value.trim();
      const email = form.querySelector('#f-email').value.trim().toLowerCase();
      const area = form.querySelector('#f-area').value.trim();
      const roleLabel = form.querySelector('#f-role').value;

      let ok = true;
      if(name.length < 2){ setErr('f-name', 'Please add your name.'); ok = false; } else setErr('f-name', '');
      if(!isEmail(email)){ setErr('f-email', 'Enter a valid email address.'); ok = false; } else setErr('f-email', '');
      if(!roleLabel){ ok = false; }

      if(!ok){ form.querySelector('[aria-invalid=true]')?.focus(); return; }

      const roleKey = ROLE_SELECT_TO_KEY[roleLabel];
      const dbRole = ROLE_DB_CODE[roleKey] || 'rider';

      btn.disabled = true;
      const label = submitLabelEl.textContent;
      submitLabelEl.textContent = 'Claiming...';

      try{
        const res = await fetch(`${SUPABASE_URL}/rest/v1/waitlist`, {
          method: 'POST',
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({
            full_name: name,
            email,
            phone: null,
            community: area || null,
            user_type: dbRole, // rider | driver | merchant | commander
            source: 'g868',
            referred_by: REF,
          }),
        });

        if(!res.ok){
          const body = await res.text();
          if(res.status === 409 || body.includes('23505')){
            setErr('f-email', "You're already on the list with that email.");
            btn.disabled = false; submitLabelEl.textContent = label;
            return;
          }
          throw new Error(body || 'save failed');
        }

        form.hidden = true;
        done.hidden = false;
        done.querySelector('h3')?.focus?.();
        wireShareIn(root, REF);
      }catch(err){
        if(fErr) fErr.textContent = 'Could not save that. Check your connection and try again.';
        btn.disabled = false;
        submitLabelEl.textContent = label;
      }
    });
  }

  /* ---------- share (copy link + WhatsApp) ---------- */
  function wireShareIn(root, REF){
    const shareUrl = () => {
      const u = new URL(location.href);
      u.search = '';
      u.hash = '';
      if(REF) u.searchParams.set('ref', REF);
      return u.toString();
    };
    const SHARE_TEXT = 'G 868 is coming to Trinidad and Tobago. Put your hand up so it lands sooner: ';

    root.querySelector('#copyLink')?.addEventListener('click', async e => {
      const b = e.currentTarget;
      try{
        await navigator.clipboard.writeText(shareUrl());
        const t = b.textContent; b.textContent = 'Copied';
        setTimeout(() => { b.textContent = t; }, 1800);
      }catch{
        b.textContent = shareUrl();
      }
    });

    const wa = root.querySelector('#waLink');
    if(wa) wa.href = `https://wa.me/?text=${encodeURIComponent(SHARE_TEXT + shareUrl())}`;
  }

  /* ============================================================
     7. Magnetic buttons (quickTo-style lerp, no dependency)
     ============================================================ */
  if(!REDUCED && matchMedia('(hover:hover) and (pointer:fine)').matches){
    document.addEventListener('pointerenter', e => {
      const el = e.target.closest && e.target.closest('.magnetic');
      if(!el || el.__magnetic) return;
      el.__magnetic = true;
      let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0, on = true;
      const loop = () => {
        cx += (tx - cx) * .16; cy += (ty - cy) * .16;
        el.style.translate = `${cx.toFixed(2)}px ${cy.toFixed(2)}px`;
        if(on || Math.abs(tx - cx) > .1 || Math.abs(ty - cy) > .1){
          raf = requestAnimationFrame(loop);
        }else{
          el.style.translate = '';
          el.style.willChange = '';
          el.__magnetic = false;
        }
      };
      el.style.willChange = 'translate';
      raf = requestAnimationFrame(loop);
      const move = ev => {
        const r = el.getBoundingClientRect();
        tx = (ev.clientX - r.left - r.width / 2) * .18;
        ty = (ev.clientY - r.top - r.height / 2) * .26;
      };
      const leave = () => {
        on = false; tx = 0; ty = 0;
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerleave', leave);
      };
      el.addEventListener('pointermove', move, {passive: true});
      el.addEventListener('pointerleave', leave, {passive: true});
    }, true);
  }
})();
