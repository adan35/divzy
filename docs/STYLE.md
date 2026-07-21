# Divzy Design System

Divzy's personality: **managed, fair, trustworthy** ("private-banking slate", WI-068).
Cool slate neutrals, deep trust-blue actions, a restrained gold accent, generous
whitespace, zero clutter. Everything works in light AND dark mode; the user should feel
like their digits are being managed.

## Tokens

Token names are the stable contract; WI-068 retuned the values and added the premium
tiers (elevation, accent, motion, chart). Web source of truth:
`apps/web/src/app/globals.css` (`:root` light / `.dark`), mapped in
`tailwind.config.ts`. Mobile mirrors the same values in `apps/mobile/src/theme/index.ts`.

| Role (token) | Light | Dark |
|---|---|---|
| Page background (`page`) | `#f4f6f9` | `#0a0e14` (never pure #000) |
| Surface — cards/sheets/nav (`surface`) | `#ffffff` | `#11161e` |
| Raised / hover / pressed (`surface-2`) | `#eef1f6` | `#1a212b` |
| Popovers/dialogs/dropdowns (`elevated`) | `#ffffff` | `#18202b` |
| Border (`hairline`) | `rgba(15,23,42,0.10)` | `rgba(255,255,255,0.09)` |
| Input borders (`hairline-strong`) | `rgba(15,23,42,0.16)` | `rgba(255,255,255,0.16)` |
| Text primary (`ink`) | `#0f172a` | `#f4f7fb` |
| Text secondary (`ink-2`) | `#475569` | `#a9b4c4` |
| Text muted / labels / axes (`ink-3`) | `#5d6b7d` | `#7e8a9c` |
| Interactive text/icons/links (`brand`) | `#1d4ed8` | `#60a5fa` |
| Hover of interactive text (`brand-hover`) | `#1e40af` | `#93c5fd` |
| Button/FAB fills (`brand-fill`) | `#1d4ed8` | `#2563eb` |
| Fill hover/pressed (`brand-fill-hover`) | `#1e40af` | `#1d4ed8` |
| Text/icon on fills (`on-brand`) | `#ffffff` | `#ffffff` |
| **Money positive** — owed to you (`pos`) | `#047857` | `#34d399` |
| **Money negative** — you owe (`neg`) | `#c02626` | `#f87171` |
| Danger (`danger`) | `#c02626` | `#f87171` |
| Warning (`warn`, always icon-paired) | `#b45309` | `#fbbf24` |
| Premium gold accent (`accent`) | `#a16207` | `#e3b341` |
| Focus ring (`ring`) | `#1d4ed8` | `#60a5fa` |
| Chart single-series mark (`chart-1`) | `#2a78d6` | `#3987e5` |
| Chart gridlines (`chart-grid`) | `#e6eaf1` | `#232b36` |

Soft washes (`brand-soft`, `pos-soft`, `neg-soft`, `warn-soft`, `accent-soft`) are
precomputed rgba tints of the above; `overlay` is the modal scrim (45% light / 60%
dark — the 40–60% band); `page-veil` is the topbar glass veil.

Rules:

- Components use the mapped Tailwind utilities / mobile theme keys only — **never raw
  hex** (enforced by `wi068-no-raw-hex.test.ts`; allowlist: the chart palette module,
  test files, `globals.css`).
- **`brand` vs `brand-fill`:** dark `brand` is a light link-blue for 7:1 text contrast —
  white text on it would fail. Buttons/FABs/toggle tracks always use
  `bg-brand-fill text-on-brand`; links/icons/active-nav use `brand`.
- Contrast: every text token clears **4.5:1** on its `surface`/`page` pairing in both
  modes — machine-checked by `apps/web/src/app/wi068-token-contrast.test.ts` (pure WCAG
  2.1 relative-luminance over the token values). Retunes that regress a pair fail CI.
- `accent` gold is for moments (Pulse insight glyph, celebration particles, "settled"
  flourish) — never a fill behind body text, never a chart series color.
- Elevation: light gets `shadow-card` (`--shadow-1`) on cards and `shadow-pop`
  (`--shadow-2`) on popovers/dialogs. **Dark gets no drop shadows** — border +
  machined top-edge highlight instead (`dark:shadow-top-edge` =
  `inset 0 1px 0 rgba(255,255,255,0.04)`).
- Focus: `:focus-visible` outline is 2px `ring` + 2px offset, globally, never removed.
- Dark mode = `class` strategy via next-themes (web); `useColorScheme()` (mobile).

## Typography

- Typeface: system stack (`system-ui, -apple-system, "Segoe UI", sans-serif`). No
  custom fonts, no external CDNs (self-hosted Inter is a signed-off-only proposal).
- **Money is always tabular** and always rendered through `MoneyText` (web) /
  `MoneyText` (mobile) — `font-variant-numeric: tabular-nums` is hard-applied. No
  screen formats money via bare `formatMoney()` + span/Text. (Sole exemption: compact
  chart axis ticks, in `ink-3` tabular.)
- Scale (web px / mobile pt): Display (Pulse figure) 36–40, weight 700,
  `tracking-[-0.02em]`, tabular. H1 (PageHeader) 20–24, weight 600, tracking-tight.
  Section labels 12, weight 600, uppercase, `+0.06em`, `ink-3`. Body 14–15; metadata
  12–13; nothing below 12. List-row amounts weight 600.
- Radius: cards 16px (`rounded-xl2`), buttons/inputs 10–12px, avatars full.
- Spacing: 4px grid. Cards `p-4`/`p-5`; page gutters 16 mobile / 24 desktop.
- Icons: lucide-react (web) / Ionicons (mobile), 18–20px inline, one style per
  hierarchy level. **No emoji as structural icons** (emoji stays legal in copy strings
  and as group-emoji content).

## Motion (WI-068 §4)

Tokens in `globals.css` (web) / `motion` export (mobile):

| Tier | Duration | Easing | Used for |
|---|---|---|---|
| fast (`--motion-fast`) | 120ms | ease-out | hover/press tints, exits (exit ≤ enter) |
| base (`--motion-base`) | 160ms | `--ease-out-expo` `cubic-bezier(0.16,1,0.3,1)` | fades, `animate-pop-in` |
| slow (`--motion-slow`) | 240ms | `--ease-out-expo` (web) / spring damping 20, stiffness 90 (mobile) | dialogs, sheets |
| count (`--motion-count`) | 600ms | easeOutCubic (web `lib/motion.ts`) / outExpo (mobile) | money count-up |
| celebration | ≤1200ms | `lib/celebrate.tsx` | settle success only |

- What animates: opacity, transform, color tints, count-up digits, sparkline draw-in.
  What never animates: layout bounds on press, list reflows, money **semantic color**
  (always the final value's color), skeleton→content heights (reserve space, CLS < 0.1).
- Budget: max 1–2 animated elements per view; the Pulse choreography is the dashboard's
  one hero animation.
- **Reduced motion** disables every decorative animation on both platforms (count-up
  snaps, no celebration, pop-ins degrade to fades). Functional feedback — focus rings,
  loading indicators, haptics — remains. Web: `usePrefersReducedMotion()` /
  `prefersReducedMotion()` in `apps/web/src/lib/motion.ts`.
- Mobile presses: scale 0.97 → 1.0 (`PressableScale`), transform-only.

## Components (both platforms)

- **Avatar**: colored circle (`user.avatarColor`) + white initials, or uploaded photo.
- **MoneyText**: `formatMoney()` output; positive → `pos` + "+"/"owed to you" phrasing;
  negative → `neg` + minus/"you owe"; zero → muted `ink-3`. NEVER color as the only
  signal. Opt-in `animate`/`animateOnMount` count-up (600ms, integer minor units,
  aria-label carries the final formatted value, reduced-motion snaps).
- **Buttons**: primary (`brand-fill` bg, `on-brand` text), secondary (surface-2),
  ghost, danger (`danger` bg, `on-brand` text), outline (`hairline-strong` border).
  Loading = spinner + disabled.
- **Empty states**: preferred lucide `icon` in a brand-soft circle (legacy `emoji` prop
  back-compat, in a surface-2 circle), one-line title, one-line hint, primary action.
- **Loading**: skeletons for lists/cards (not spinners) on first load; skeleton blocks
  match final heights.
- **Feedback**: web → sonner toasts (bottom-right); mobile → inline banners + haptics.
  Errors show the API's `message` verbatim. Settle-up success additionally fires the
  celebration (`celebrate()` web / `CelebrationOverlay` mobile) — never on expense save.
- **Forms**: labels above inputs; inline validation on blur; primary action disabled
  until valid; Enter submits on web. Input borders `hairline-strong`.

## Signature UX details (what makes Divzy feel better than Splitwise)

- Expense editor defaults: today's date, group's currency, "paid by you", EQUAL split,
  all members selected. Two fields (description + amount) are enough to save.
- Split-type picker = segmented control `= | 1.23 | % | shares | +/- | items` with a
  live per-person preview list (uses `computeSplits` from shared — the exact server
  math) and a running "left to assign" indicator that must reach zero before save.
- Balances read as sentences: "Sam owes you $12.50", never raw signed numbers.
- Settle-up: suggestion rows have a one-tap "Record payment" that prefills the dialog;
  success celebrates (gold/brand/pos particle burst, reduced-motion aware).
- Divzy Pulse (dashboard hero): animated net-position count-up, 6-month spend
  sparkline, one plain-language insight, settle CTA.
- Realtime: lists refresh via socket events silently; a subtle toast for group changes
  you didn't make.
- Web keyboard: `n` opens new-expense in a group page, `Esc` closes dialogs.

## Charts (analytics) — follow exactly (WI-068 §8, dataviz-validated)

Charts use Recharts (web only; mobile hand-rolls Views/SVG — no chart lib).
Single source: `apps/web/src/components/analytics/palette.ts` (web) and the theme
`chartPalette` export (mobile).

- **Single-series marks use `var(--chart-1)`** (`CHART_SERIES`), never `var(--brand)`
  and never palette slot 1 — applies to monthly trend bars, spend snapshot, group
  charts, Pulse sparkline.
- Palette (categorical, FIXED order, never cycled — validator-proven slot order,
  re-ordered 2026-07-19; the old order failed adjacent ΔE at slots 7–8):
  light `#2a78d6 #008300 #e87ba4 #eda100 #1baf7a #eb6834 #4a3aa7 #e34948`,
  dark `#3987e5 #008300 #d55181 #c98500 #199e70 #d95926 #9085e9 #e66767`.
  More than 8 categories → fold smallest into "Other" (cool gray `#7e8a9c`, both
  modes). Color follows the entity, never its rank. Three light slots sit < 3:1 on
  the surface → **relief rule**: charts using them keep visible labels + values.
- **One axis only.** Never dual-axis. Bars: 4px rounded tops, thin (maxBarSize 28),
  `barCategoryGap ≥ 24%`; stacked segments get a 2px surface gap.
- Grid: hairline horizontal only — `var(--chart-grid)` (`CHART_GRID`); axis text
  `ink-3` 12px; no axis lines/ticks clutter.
- Category breakdown = horizontal bar rows (label left, value right, thin 6px colored
  bar), NOT a pie/donut.
- Tooltips on hover for every mark: `bg-elevated border-hairline shadow-pop
  rounded-xl`; label `ink-3` 12px; values via `MoneyText` in `ink`; cursor wash
  `surface-2` @ 50%.
- Legend only for ≥2 series (single series: the title names it); swatch 8px rounded,
  text `ink-2` 13px. Text never wears a series color.
- Stat tiles: label (secondary, 13px) over value (28–32px semibold, tabular). Delta vs
  previous period: ↓ spend = `pos` green with arrow, ↑ = neutral `ink-2` — never red.
