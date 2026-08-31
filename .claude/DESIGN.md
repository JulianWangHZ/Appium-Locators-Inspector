# UI Style Reference

> Quiet analyst's desk on warm paper

**Theme:** light

The interface sits on a warm-stone canvas (#fafaf9) with a single vivid cyan as its only chromatic accent — every other color is a neutral pulled from the stone scale. Headlines use a geometric sans at weight 400 with tight negative tracking, giving display copy an unhurried, almost whispered authority that contrasts with the usual SaaS shout. UI surfaces are flat white cards floating over the warm background via a single soft 16px-blur shadow; borders are 1px stone hairlines used generously as the primary structural device instead of heavy dividers or panels. The layout breathes: content centered on generous vertical rhythm, with pill-shaped interactive controls. The overall feel is editorial analytics — calm, monochrome, confident — where the blue action is the loudest thing on the page by deliberate restraint of everything else.

## Tokens — Colors

| Name | Value | Token | Role |
|------|-------|-------|------|
| Stone Canvas | `#fafaf9` | `--color-stone-canvas` | Page background — warm off-white that reads as paper, not screen-white |
| Pure White | `#ffffff` | `--color-pure-white` | Card surfaces, elevated panels, input fills — flat and shadowless by default |
| Stone Border | `#e8e6e5` | `--color-stone-border` | Hairline borders on cards, nav, inputs — the primary structural device, not dividers |
| Stone Muted | `#d6d3d1` | `--color-stone-muted` | Secondary borders, subtle background tints, decorative separators |
| Ash Gray | `#a8a29e` | `--color-ash-gray` | Muted helper text, icon strokes, disabled states — readable but recessive |
| Warm Gray | `#78716c` | `--color-warm-gray` | Body text, nav links, secondary copy — warm-tinted neutral that softens body type |
| Ink Black | `#0c0a09` | `--color-ink-black` | Primary headings, emphasized body, strong icons — near-black with a warm cast |
| Soot | `#1c1917` | `--color-soot` | Dark surface backgrounds for inverted sections, dark tabs |
| Sky Wash | `#c1e1f7` | `--color-sky-wash` | Soft highlight wash behind highlighted text spans, decorative blue tint |
| Cyan Signal | `#3ba6f1` | `--color-cyan-signal` | Primary action fill, active links, brand icon strokes — the only chromatic voice on the page, used sparingly to make actions feel switched on |
| Cyan Edge | `#3398e1` | `--color-cyan-edge` | Blue accent for outlined action borders, linked labels, and lightweight interactive emphasis. Do not promote it to the primary action color |

## Tokens — Typography

### Display / heading typeface — geometric sans with tight negative tracking (-0.025em at 32px, -0.021em at 52px). Weight 400 at large sizes is the signature: anti-convention whisper-weight that creates authority through restraint. Headlines occupy their space without shouting. · `--font-display`
- **Substitute:** Inter Tight or Satoshi
- **Weights:** 400, 500
- **Sizes:** 18px, 20px, 32px, 52px
- **Line height:** 1.12, 1.22, 1.25, 1.69
- **Letter spacing:** -0.025em at 32px, -0.021em at 52px, -0.017em at 18px
- **Role:** Display and heading typeface — geometric sans with tight negative tracking. Weight 400 at large sizes is the signature: anti-convention whisper-weight that creates authority through restraint.

### Body / UI typeface — neutral workhorse for all non-display copy. 14px weight 400 at 1.64 line-height is the dominant body size. Positive tracking (0.004em) at small sizes keeps dense UI legible. · `--font-body`
- **Substitute:** Inter
- **Weights:** 400, 500, 600
- **Sizes:** 10px, 12px, 13px, 14px, 15px, 16px, 18px
- **Line height:** 1.33, 1.53, 1.64, 1.69, 2.3
- **Letter spacing:** 0.0030em, 0.0040em, 0.0250em
- **Role:** Body, nav, UI, and caption typeface — neutral workhorse for all non-display copy. 14px weight 400 at 1.64 line-height is the dominant body size. Positive tracking at small sizes keeps dense UI legible.

### Type Scale

| Role | Size | Line Height | Letter Spacing | Token |
|------|------|-------------|----------------|-------|
| caption | 10px | 2.3 | — | `--text-caption` |
| body-lg | 16px | 1.69 | 0.048px | `--text-body-lg` |
| subheading | 20px | 1.2 | -0.1px | `--text-subheading` |
| heading-sm | 32px | 1.25 | -0.8px | `--text-heading-sm` |
| display | 52px | 1.12 | -1.092px | `--text-display` |

## Tokens — Spacing & Shapes

**Base unit:** 4px

**Density:** compact

### Spacing Scale

| Name | Value | Token |
|------|-------|-------|
| 4 | 4px | `--spacing-4` |
| 8 | 8px | `--spacing-8` |
| 12 | 12px | `--spacing-12` |
| 16 | 16px | `--spacing-16` |
| 24 | 24px | `--spacing-24` |
| 32 | 32px | `--spacing-32` |
| 40 | 40px | `--spacing-40` |
| 48 | 48px | `--spacing-48` |
| 64 | 64px | `--spacing-64` |
| 80 | 80px | `--spacing-80` |
| 96 | 96px | `--spacing-96` |
| 160 | 160px | `--spacing-160` |

### Border Radius

| Element | Value |
|---------|-------|
| tags | 9999px |
| cards | 10px |
| icons | 4px |
| inputs | 6px |
| buttons | 9999px |
| feature-card | 16px |

### Shadows

| Name | Value | Token |
|------|-------|-------|
| md | `rgba(0, 0, 0, 0.05) 0px 4px 16px 0px` | `--shadow-md` |
| sm | `rgba(0, 0, 0, 0.1) 0px 4px 6px -1px, rgba(0, 0, 0, 0.1) 0px 2px 4px -2px` | `--shadow-sm` |
| subtle | `rgba(0, 0, 0, 0.05) 0px 1px 2px 0px` | `--shadow-subtle` |
| xl | `rgba(17, 12, 46, 0.12) 0px 12px 45px 0px` | `--shadow-xl` |

### Layout

- **Page max-width:** 1200px
- **Section gap:** 96px
- **Card padding:** 24px
- **Element gap:** 8px

## Components

### Primary Action Button (filled cyan)
**Role:** Highest-priority action

Pill shape (9999px radius), fill #3ba6f1, 1px border #3398e1, white text (#ffffff) weight 500, padding 8px 16px. The only chromatic filled element on the page — use once per viewport maximum.

### Secondary Ghost Button
**Role:** Lower-priority action beside primary

Pill shape (9999px radius), transparent fill, 1px border #e8e6e5, text #0c0a09 weight 400, padding 8px 16px. Quiet companion to the cyan action.

### Navigation Link
**Role:** Top-nav menu items

No fill, no border, 14px body weight 400, color #78716c, padding 0 12px, height 32px. Hovers to #0c0a09.

### Flat Content Card
**Role:** Feature blocks, previews, list cards

White (#ffffff) fill, 10px radius, 1px border #e8e6e5 (not shadow-dependent), 24px padding. Subtle shadow rgba(0,0,0,0.05) 0px 4px 16px 0px adds lift without weight. The border IS the structure.

### Floating Preview
**Role:** Elevated hero surface

16px radius, white fill, shadow rgba(17,12,46,0.12) 0px 12px 45px 0px — the one card allowed to feel elevated/3D. 8px padding internally so content sits within a frame.

### Highlighted Text Span
**Role:** Inline emphasis within headlines

Text in #3398e1 with a soft #c1e1f7 background highlight (pill-shaped background behind the word). Weight 400. The only inline color treatment — every headline gets one.

### Text Input
**Role:** Form fields, search

White fill, 6px radius, 1px border #d6d3d1, placeholder #78716c, padding 4px 12px. Focus ring: 2px #3ba6f1. Minimal, inline with label.

### Logo Wordmark
**Role:** Top-left brand identifier

Small monochrome glyph + wordmark in body weight 500, 14px, #0c0a09. Compact, sits left of nav.

### Tab Pill Group
**Role:** View navigation

Horizontal row of pill-shaped tabs. Active tab: #1c1917 fill, white text, 9999px radius. Inactive: transparent, #0c0a09 text, 1px #e8e6e5 border.

## Do's and Don'ts

### Do
- Use the display typeface at weight 400 for all display and heading sizes — never bump to 600/700 for emphasis, rely on size and the cyan highlight span instead
- Use #fafaf9 as the page background and #ffffff only for card surfaces — never invert this (white on canvas, not the other way around)
- Apply exactly one cyan highlight span (#3398e1 text + #c1e1f7 pill background) per headline to mark the key phrase
- Use 1px #e8e6e5 borders as the primary structural separator inside cards — reserve shadows for preview cards only
- Keep buttons pill-shaped (9999px radius) with 8px 16px padding — the cyan filled action must be the only chromatic filled element on any screen
- Set body copy at 14px body font weight 400 with 1.64 line-height — this is the dominant UI rhythm, do not break it

### Don't
- Do not introduce new accent colors — the entire palette is stone neutrals plus one cyan; adding green, purple, or red breaks the editorial restraint
- Do not use heavy drop shadows on content cards — the 16px-blur floating preview shadow is reserved for exactly one element per page
- Do not set headlines in the body font — the display face at 32px/52px is the brand voice; mixing fonts breaks hierarchy
- Do not use #ffffff as the page background — always #fafaf9; pure white belongs only on elevated card surfaces
- Do not fill buttons with dark/neutral colors for primary actions — the cyan #3ba6f1 is the only correct filled-button color
- Do not add gradients, glassmorphism, or decorative color washes — the design is deliberately flat and paper-textured
- Do not stack multiple cyan highlight spans in one headline — one per headline maximum, the restraint is the point

## Surfaces

| Level | Name | Value | Purpose |
|-------|------|-------|---------|
| 0 | Canvas | `#fafaf9` | Full-page warm-stone background |
| 1 | Card | `#ffffff` | Flat content cards, nav, input fills — sits one elevation step above canvas |
| 2 | Floating Preview | `#ffffff` | Hero surface — only surface allowed the deep 45px-blur shadow |
| 3 | Inverted Section | `#1c1917` | Dark accent surfaces for tab pills or inverted panels (sparingly used) |

## Elevation

- **Content card:** `rgba(0, 0, 0, 0.05) 0px 4px 16px 0px`
- **Floating preview:** `rgba(17, 12, 46, 0.12) 0px 12px 45px 0px`
- **Small icon / decorative chip:** `rgba(0, 0, 0, 0.1) 0px 4px 6px -1px, rgba(0, 0, 0, 0.1) 0px 2px 4px -2px`
- **Nav / button hairline:** `rgba(0, 0, 0, 0.05) 0px 1px 2px 0px`

## Imagery

All decorative icons are 1px-stroke outline style in either #0c0a09 or #3ba6f1, never filled. Keep chrome minimal — the content is the hero. No gradients, no lifestyle imagery, no heavy fills.

## Layout

Content is centered with generous vertical breathing room. Interactive controls are pill-shaped. Structure comes from 1px hairline borders and generous spacing rather than heavy panels or dividers. Restraint everywhere except the single cyan action.

## Agent Prompt Guide

Quick Color Reference:
- page background: #fafaf9
- card surface: #ffffff
- primary text: #0c0a09
- secondary text: #78716c
- border / hairline: #e8e6e5
- accent (text highlight + icons): #3ba6f1
- primary action: #3ba6f1 (filled action)
- highlight wash: #c1e1f7

## Highlight Span Pattern

The signature typographic move is the inline highlight: one phrase per headline receives #3398e1 text color with a #c1e1f7 pill-shaped background behind it (padding ~2px 8px, radius 4px). It always lands on the key phrase. Rules: exactly one per headline, never inside body paragraphs, never on nav items. The highlight carries the entire chromatic budget of the headline; everything else stays #0c0a09.

## Quick Start

### CSS Custom Properties

```css
:root {
  /* Colors */
  --color-stone-canvas: #fafaf9;
  --color-pure-white: #ffffff;
  --color-stone-border: #e8e6e5;
  --color-stone-muted: #d6d3d1;
  --color-ash-gray: #a8a29e;
  --color-warm-gray: #78716c;
  --color-ink-black: #0c0a09;
  --color-soot: #1c1917;
  --color-sky-wash: #c1e1f7;
  --color-cyan-signal: #3ba6f1;
  --color-cyan-edge: #3398e1;

  /* Typography — Font Families */
  --font-display: 'Inter Tight', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-body: 'Inter', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;

  /* Typography — Scale */
  --text-caption: 10px;
  --leading-caption: 2.3;
  --text-body-lg: 16px;
  --leading-body-lg: 1.69;
  --tracking-body-lg: 0.048px;
  --text-subheading: 20px;
  --leading-subheading: 1.2;
  --tracking-subheading: -0.1px;
  --text-heading-sm: 32px;
  --leading-heading-sm: 1.25;
  --tracking-heading-sm: -0.8px;
  --text-display: 52px;
  --leading-display: 1.12;
  --tracking-display: -1.092px;

  /* Typography — Weights */
  --font-weight-regular: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;

  /* Spacing */
  --spacing-unit: 4px;
  --spacing-4: 4px;
  --spacing-8: 8px;
  --spacing-12: 12px;
  --spacing-16: 16px;
  --spacing-24: 24px;
  --spacing-32: 32px;
  --spacing-40: 40px;
  --spacing-48: 48px;
  --spacing-64: 64px;
  --spacing-80: 80px;
  --spacing-96: 96px;
  --spacing-160: 160px;

  /* Layout */
  --page-max-width: 1200px;
  --section-gap: 96px;
  --card-padding: 24px;
  --element-gap: 8px;

  /* Border Radius */
  --radius-md: 4px;
  --radius-lg: 10px;
  --radius-2xl: 16px;
  --radius-full: 9999px;

  /* Named Radii */
  --radius-tags: 9999px;
  --radius-cards: 10px;
  --radius-icons: 4px;
  --radius-inputs: 6px;
  --radius-buttons: 9999px;
  --radius-feature-card: 16px;

  /* Shadows */
  --shadow-md: rgba(0, 0, 0, 0.05) 0px 4px 16px 0px;
  --shadow-sm: rgba(0, 0, 0, 0.1) 0px 4px 6px -1px, rgba(0, 0, 0, 0.1) 0px 2px 4px -2px;
  --shadow-subtle: rgba(0, 0, 0, 0.05) 0px 1px 2px 0px;
  --shadow-xl: rgba(17, 12, 46, 0.12) 0px 12px 45px 0px;

  /* Surfaces */
  --surface-canvas: #fafaf9;
  --surface-card: #ffffff;
  --surface-floating-preview: #ffffff;
  --surface-inverted-section: #1c1917;
}
```
