# G 868 Manus brief

Paste everything below the line into Manus. Attach both logo files first:

1. `g-logo-full.png` (the glass G pin ringed by service icons)
2. `g-logo-pin.png` (the same pin with the satellites stripped away)

Grounded against the live database and the app source on 2026-08-09. Every number in
this brief is real. See `.claude/plans/wobbly-mapping-bentley.md` for how each one was
verified and what happens after Manus delivers.

---

Build a single-page immersive 3D scroll site called G 868. Treat this as an
advertising campaign with a landing page attached, not a feature tour.

## THE BUSINESS

G-Taxi is a multi-service platform in Trinidad and Tobago built on ride-hailing.
868 is T&T's area code. The apps are not in the stores yet. This site exists to make
people pre-register, by role. When the apps launch they sign in with the same email
or phone they gave here and set a password.

Four audiences: riders, drivers, merchants (G-Partners), territory operators (G-Leads).

## THE CAMPAIGN IDEA, THIS IS THE SPINE OF THE WHOLE SITE

G-Taxi goes live community by community, not all at once. So the waitlist is not a
queue. It is a vote. Your area goes live when enough of your area signs up.

Everything serves that: the call to action is "Claim your area", not "Join the
waitlist". The hero is the island at night, mostly dark, with a few points of light
where people have already signed up. Signing up lights your area. Sharing lights it
faster. The referral link is the campaign, not a footnote.

CRITICAL: do not display percentages, member counts, progress bars or "your area is
62% there" style numbers anywhere. That data does not exist yet and inventing it would
be a lie. Show light, not statistics.

## THE VISUAL IDEA

I am attaching two logo files. One is a glass G-shaped map pin ringed by small service
icons (storefront, calendar, cutlery, shopping bag, salon, circuit tile) joined by
circuit traces. The other is the same pin with the satellites stripped away.

They are the first and last frames of this website.

The hero shows the BARE PIN. As the visitor scrolls and each service is introduced,
that service's satellite ignites and locks into place. By the bottom, the visitor has
assembled the logo. Some satellites never light. Leave them dark. Do not delete them
and do not invent services to fill them. The unlit nodes honestly say the grid is
still being built.

## 3D DIRECTION: 2026, NOT 2021

The failure mode I am trying to avoid is 2021 WebGL: floating spheres, blurry
glassmorphism cards, purple gradient blobs, everything drifting on a sine wave.
Current work is more restrained and more physical. Reference points: Igloo Inc,
Basement Studio, Locomotive, Apple product pages, Vercel's launch microsites.

What that means concretely:

- ONE hero 3D moment. Everything below is composed, still, and confident. Restraint
  reads as expensive. Constant motion reads as a template.
- Real refractive glass on the pin: transmission, index of refraction around 1.5,
  chromatic dispersion so the edges split light into faint colour fringing. Not
  backdrop-blur pretending to be glass.
- Thin-film iridescence on the pin's chamfered edges, so grazing angles shift violet
  to cyan on their own. The gradient should be earned by the material and the lighting,
  not painted on.
- ACES filmic tonemapping. Restrained bloom, threshold high, only the trace lines and
  the brightest edges should bloom. No screen-wide haze.
- Volumetric depth: thin atmospheric fog so distant parts of the island fall away.
  Suggest light shafts, do not blast god rays.
- Mesh gradients are LIGHTING in the scene, never a background fill behind text.
- Type lives in the space. Headlines should be occluded by geometry where they pass
  behind it, not float in a separate flat layer above everything.
- Camera choreography, not element fade-ins. The scroll drives one continuous camera
  path. Content arrives because the camera arrived, not because a div hit 50% viewport.
- Variable font weight and letter-spacing interpolated on scroll for the hero line only.
- Grain: a single fixed, pointer-events-none full-screen overlay. Never on a scrolling
  container.
- Desktop: subtle cursor parallax on the hero, maximum a few degrees. No custom cursor.

## PERFORMANCE, HARD REQUIREMENT

Audience is mid-range Android on metered mobile data in Trinidad. This overrides
ambition every time.

- ONE real WebGL scene: the hero. Under 300KB gzipped including the model.
- Everything below the hero is pre-rendered image sequences scrubbed by scroll plus
  CSS transforms. No second 3D scene.
- Static poster fallback if WebGL is unavailable or the GPU is blocklisted. Never a
  blank frame, never a spinner that outlives 2 seconds.
- prefers-reduced-motion collapses every sequence to its final frame and kills all
  scroll scrubbing. Fully readable in that state.
- Animate transform and opacity only. Never window.addEventListener('scroll'); use
  ScrollTrigger, IntersectionObserver, or CSS scroll-driven animations.
- Lazy-load every sequence below the fold. Serve AVIF with WebP fallback.
- LCP under 2.5s on a throttled 4G profile.

## COLOR, EXACT VALUES

```
base       #07070F   violet-black, the page background
ink        #05060B   deeper well behind glass
ice        #EAF3F6   text. Never pure #FFFFFF
platinum   #CBD6DE   numbers, prices, percentages ONLY
violet     #6D28D9
cyan       #34E6EC
glass fill    rgba(255,255,255,0.045)
glass border  rgba(255,255,255,0.10)
hairline      rgba(255,255,255,0.06)
```

THE SINGLE MOST IMPORTANT RULE ON THIS PAGE:
The violet-to-cyan gradient is a LIT EDGE. Once per screen, as a hairline, a route, a
circuit trace, or a selected border. Never a fill. Never a glow blob. Never a
background wash. Never behind text. A page of purple gradient fills is the exact
outcome I am paying to avoid.

Dark theme locked for the whole page. No section inverts to light.

## TYPE

Display: Cormorant Garamond, 500 and 600.
Body and numerals: a clean geometric grotesk.
Numbers, fares and percentages in platinum #CBD6DE.

## THE CAR

Several beats feature a car running along a circuit trace. Not photorealistic, not
stock. Match the logo's material exactly: translucent tinted glass, chamfered edges,
circuit-board texture on the interior panels, violet light on one flank and cyan on
the other, lit exactly as the pin is lit. It reads as a vehicle moving along a route
on a circuit board.

## STRUCTURE: SEVEN BEATS, EACH A DIFFERENT SHAPE

### 1. HERO. The island at night.

Trinidad and Tobago from above, dark, coastline barely traced. A handful of scattered
points of light. The bare glass pin hangs in the foreground, slowly turning, catching
a light sweep.

```
Headline:  The island moves on a tap.
Sub:       Rides, groceries and laundry, going live one community at a time.
Button:    Claim your area
```

Must fit the viewport. Headline maximum 2 lines. Nothing else in this section: no
logo wall, no small print under the button, no scroll cue.

### 2. RIDE. Full-bleed, horizontal trace.

The pin lands on the island. A cyan trace ignites and runs across the screen. The
glass car travels it.

```
Headline:  It starts with a ride.
Body:      Book from anywhere in Trinidad and Tobago. Pay cash, or from your G-Wallet.
```

Four short items: Live driver chat. Add a stop mid-trip. Emergency SOS. Cash or wallet.

### 3. THE UNLOCK. Scroll-pinned. The centrepiece.

Camera pulls back. Satellites ignite one at a time, in this order. Each shows name,
condition, one line. These conditions are real. Do not change the numbers.

```
Headline:  Ride more. The island opens up.
Body:      Every service you unlock stays unlocked.
```

| Service | Condition | Line |
|---|---|---|
| Ride | Available now | Get a taxi anywhere in Trinidad and Tobago. |
| Market | 5 rides | Groceries from shops near you, delivered. |
| Laundry | 2 Market orders | Washed, folded, brought back. |
| Tap | Unlocks with Laundry | Tap a G-Touch Point to ride, book or pay. |
| Food | Available with Market | Delivery from local spots. |
| Wallet bonus | 1 Laundry order | Top up TTD 200, get TTD 220. |

A quiet vertical rail of the five rider levels alongside:

New Rider, no discount. Regular, 5% off, 5 minutes free wait. Loyal, 8% off, priority
matching, 8 minutes. Elite, 10% off, priority matching, 10 minutes. G-Member, 12% off,
priority matching, 12 minutes.

The logo finishes assembling here, minus the satellites that stay dark.

### 4. TAP. Horizontal pan.

Close on a physical puck on a shop counter. A phone taps it. A trace runs out of the
puck into the grid.

```
Headline:  Tap the puck.
Body:      G-Touch Points sit on counters and at taxi stands across the island. Tap one
           with your phone. At a stand it books a ride from exactly where you stand. At
           a shop it opens their services, or pays them straight from your wallet.
```

### 5. THE OTHER SIDE. Asymmetric: one large panel plus two stacked.

Never three equal cards in a row.

```
Headline: The island does not move itself.
```

**DRIVE**, the large panel

```
Eighty percent is yours.

Go online when you want. Rides and deliveries, payouts from your wallet, and access
to G-Garage when you are ready for a vehicle.

Figures: 80% of the fare. 1% on every driver you refer. TTD 500 for every hotel or
villa you introduce.
```

**SELL**

```
Your counter becomes a taxi stand.

Take orders, run your catalog, accept payment with a tap. A G-Touch Point at your
counter earns you a share of the platform's take on every ride that starts there.
Payouts on the 1st and the 15th.
```

**LEAD**

```
Run the grid in your district.

G-Leads recruit drivers and partners in their area and earn a 2% network override.
It opens at 500 completed rides, so it starts in the driver seat.
```

### 6. G. Editorial, near-still. Almost no motion here on purpose.

```
Headline:  G watches the business.
Body:      G is the chief of staff behind the platform. It reads the numbers, spots what
           needs attention, and proposes what to do. Every proposal waits for a human to
           approve it. G never moves money on its own.
```

### 7. CLAIM. Split layout, the payoff.

The island returns, and the visitor's area lights as they submit.

```
Headline:  Put your area on the map.
Body:      We go live community by community. Tell us where you are and we will come to
           you sooner. When the app lands you sign in with the same email or number and
           set your password.
```

Fields, labels ABOVE inputs, never placeholder-as-label:

```
Full name
Email or WhatsApp number
Your area (for example, Sangre Grande)
I want to:  Ride / Drive / Sell / Lead   (single select, four options, default Ride)

Button: Claim your area
Under it: We reach out when G-Taxi lands in your community. No spam.
```

Success state, and make this share-forward, it is the growth loop:

```
You're on the map.
Your area moves up every time someone else from it joins. Send them this link.

[ Copy your link ]   [ Share on WhatsApp ]
```

Every input, placeholder, focus ring and label must pass WCAG AA contrast on the dark
background.

### FOOTER

G 868. Trinidad and Tobago.

## COPY RULES

Use "Claim your area" for every button that opens or submits the form, including any
sticky header button. One label, one intent, sitewide.

NEVER write any of the following. Every one is factually false:

- App Store, Google Play, Download the app, or any store badge. The apps are not
  released. The waitlist is the only door.
- Scheduled rides, pre-book, book in advance.
- Tickets or ticketing of any kind.
- Credit card, Visa, Mastercard, card payment. Say cash and wallet.
- "3% commission" for merchants. It is a share of the platform's take.
- Any 82/15/3 split. Driver keeps 80%, or 78% in a territory with an active G-Lead.
- G-Escape, Caribbean Escapes, Carnival, Events, Business Logistics. All switched off.
- Weekly cash payouts for G-Leads.
- Any suggestion that G acts, decides or pays on its own.
- Em-dash characters. Zero, anywhere. Hyphens and periods only.

Invent nothing: no statistics, member counts, ratings, testimonials or partner logos.
There are none yet. A page with no social proof is the correct page.

Do not add: version or beta badges, section-number eyebrows (01, 02), scroll cues,
decorative status dots, weather or clock strips. Across the entire page use at most
two small uppercase label-above-heading eyebrows.

## OUTPUT

Self-contained static site: HTML, CSS, JS, one WebGL hero, scroll sequences as
compressed AVIF/WebP sets. No external CDN dependencies, everything bundled. Ship the
form as markup plus client validation only, and leave the submit as a clearly marked
stub function `submitWaitlist(payload)`. I am wiring it to my own backend.
