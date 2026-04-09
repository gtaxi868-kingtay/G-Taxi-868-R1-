# Design System Document: THE LUMINESCENT EDITORIAL

## 1. Overview & Creative North Star
**The Creative North Star: "Hyper-Velocity Elegance"**

This design system moves beyond the utility of transport apps and into the realm of high-end editorial digital experiences. We are not just moving people and goods; we are providing a premium service that feels as light as air yet as solid as a glass sculpture. 

The architecture rejects the "boxy" grid of 2010s SaaS design. Instead, we utilize **intentional asymmetry**, overlapping glass layers, and extreme typographic contrast. We treat the screen as a 3D space where light refracts through surfaces, and "negative space" is treated as a premium luxury. By using a "Glassmorphism-first" approach, we ensure that even the most data-heavy Admin or Merchant interfaces feel breathable and sophisticated.

---

## 2. Colors & Surface Philosophy

### The Palettes
Our color system is rooted in high-contrast "Cyber-Luxury."

- **Brand Core:** `primary` (#d2bbff), `secondary` (#ffffff), and `tertiary` (#cbbeff).
- **The Voice Profiles:**
    - **Rider:** Lavender Premium (`primary_fixed` #eaddff)
    - **Driver:** Cyan Performance (`secondary_container` #00fbfb)
    - **Admin:** Warm Slate (`surface_bright` #3b374a)
    - **Merchant:** Forest Green (`on_secondary_container` #007070)

### The "No-Line" Rule
**Explicit Instruction:** Prohibit the use of 1px solid borders for sectioning. 
Boundaries must be defined solely through background color shifts or tonal transitions. Use `surface_container_low` against `surface` to create a section. If a visual break is needed, use a 32px or 48px vertical margin, never a horizontal rule.

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers of frosted glass.
- **Base Level:** `surface` (#141122) - The dark, infinite void.
- **Layout Sections:** `surface_container_low` (#1c192b).
- **Interactive Cards:** `surface_container_high` (#2b273a).
- **Floating Modals/Popovers:** `surface_container_highest` (#363245).

### The "Glass & Gradient" Rule
Every primary CTA and Hero element must utilize the **Signature Texture**: A diagonal gradient transitioning from `primary_container` (#7C3AED) to `secondary_fixed` (#00FFFF). For floating glass elements, apply `backdrop-filter: blur(20px to 40px)` with a background color of `surface_variant` at 40% opacity.

---

## 3. Typography
We employ a "High-Contrast Editorial" scale to create a sense of authority and precision.

| Role | Font Family | Weight | Size | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **Display-LG** | Space Grotesk | 800 | 3.5rem | Hero Value Props |
| **Headline-MD** | Space Grotesk | 700 | 1.75rem | Section Headers |
| **Title-LG** | Manrope | 600 | 1.375rem | Card Titles |
| **Body-LG** | Manrope | 400 | 1.0rem | Standard Reading |
| **Label-MD** | Manrope | 300 | 0.75rem | Secondary Metadata |

**Typographic Identity:**
- **Values vs. Labels:** Always pair a `Label-SM` (Weight 300) with a `Display-SM` (Weight 800) for data points (e.g., "ETA" in 300wt, "4 MIN" in 800wt).
- **Tracking:** Set `letter-spacing: -0.02em` for headlines to create a tighter, custom-font feel.

---

## 4. Elevation & Depth

### The Layering Principle
Depth is achieved through **Tonal Layering**, not shadows.
1. Place a `surface_container_lowest` card on a `surface_container_low` section. 
2. The contrast between these two deep violets creates a natural, soft lift that mimics high-end photography.

### Ambient Shadows
Shadows are a last resort. When used (e.g., a floating Action Button), they must be:
- **Color:** `on_surface` (#e6dff8) at 6% opacity.
- **Blur:** 60px.
- **Spread:** -10px.
This creates a "glow" rather than a "drop shadow."

### The "Ghost Border" Fallback
If a border is required for accessibility, use the **Ghost Border**: `outline_variant` (#4a4455) at 15% opacity. This provides a hint of structure without interrupting the "GlassCard" aesthetic.

---

## 5. Components

### Buttons
- **Primary:** Diagonal Gradient (`primary_container` to `secondary_fixed`). Text: `on_primary_fixed` (White/Deep Violet), Weight 800. Radius: 28px.
- **Secondary:** Glass Background (`surface_bright` at 20% opacity). Ghost Border (15% opacity).
- **States:** On hover, increase `backdrop-filter` blur by 10px; do not change color brightness.

### GlassCards
- **Construction:** `surface_variant` at 40% opacity + `backdrop-blur: 30px`.
- **Corner Radius:** Always `lg` (2rem / 32px) or `xl` (3rem / 48px).
- **Content:** Forbid divider lines. Use `body-sm` (300wt) labels to separate data clusters.

### Input Fields
- **Architecture:** Soft, filled containers using `surface_container_highest`. 
- **Active State:** The bottom edge glows with a 2px `secondary` (#00FFFF) underline—no full-box border.

### Lucide Icons
- **Usage:** Icons must be `stroke-width: 1.5`. 
- **Coloring:** Always use `primary` (#d2bbff) for functional icons. Never use multi-colored icons; maintain a monochromatic, high-end look.

### Platform-Specific Components
- **Rider "Pulse":** A background radial gradient of `primary` (#7C3AED) at 5% opacity that slowly expands and contracts.
- **Driver "Performance Bar":** A sleek, 4px thick horizontal bar using the `secondary_fixed` (#00FFFF) color to show earnings progress.

---

## 6. Do's and Don'ts

### Do
- **Do** use asymmetrical layouts (e.g., a large headline on the left, a small glass card overlapping it on the right).
- **Do** lean heavily into `Space Grotesk` for numbers—it is our "Performance" font.
- **Do** use `Lucide` icons exclusively; ensure they have ample padding.

### Don't
- **Don't** use 1px solid dividers or borders.
- **Don't** use pure black (#000000). Our darkest dark is `surface_container_lowest` (#0f0c1d).
- **Don't** use emojis. They break the premium editorial tone.
- **Don't** use standard "Drop Shadows." If it doesn't look like light passing through glass, refine the blur.

### Accessibility Note
While glassmorphism is aesthetic, ensure all `on_surface` text maintains at least a 4.5:1 contrast ratio against the blurred background. If a background is too complex, increase the opacity of the glass layer to `surface_container_high`.