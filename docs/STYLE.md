# Divzy Design System

Divzy's personality: **fast, fair, friendly**. Clean surfaces, generous whitespace,
one accent color, zero clutter. Everything works in light AND dark mode.

## Tokens

| Role | Light | Dark |
|---|---|---|
| Page background | `#f9f9f7` | `#0d0d0d` |
| Surface (cards) | `#fcfcfb` | `#1a1a19` |
| Surface raised / hover | `#f0efec` | `#242422` |
| Border (hairline) | `rgba(11,11,11,0.10)` | `rgba(255,255,255,0.10)` |
| Text primary | `#0b0b0b` | `#ffffff` |
| Text secondary | `#52514e` | `#c3c2b7` |
| Text muted | `#898781` | `#898781` |
| Brand / primary | `#2a78d6` | `#3987e5` |
| Primary hover | `#256abf` | `#5598e7` |
| **Money positive** (owed to you) | `#006300` | `#0ca30c` |
| **Money negative** (you owe) | `#d03b3b` | `#e66767` |
| Danger | `#d03b3b` | `#e66767` |
| Warning surface text | `#c98500` | `#eda100` |

Tailwind (web): expose these as CSS custom properties on `:root` / `.dark` in
`globals.css` and map them in `tailwind.config.ts` (`colors: { surface, page, ink,
brand, pos, neg, ... }`). Dark mode = `class` strategy via next-themes.
Mobile: same values in `src/theme/colors.ts` with `useTheme()` hook keyed off
`useColorScheme()`.

- Typeface: system stack (`system-ui, -apple-system, "Segoe UI", sans-serif`). No
  custom fonts. Amounts in lists/tables use `tabular-nums`.
- Radius: cards 16px (`rounded-2xl`), buttons/inputs 10–12px, avatars full.
- Spacing: 4px grid. Cards `p-4`/`p-5`; page gutters 16 mobile / 24 desktop.
- Shadows: barely-there (`shadow-sm`) in light; none in dark (borders instead).
- Icons: lucide-react (web) / Ionicons via @expo/vector-icons (mobile), 18–20px inline.

## Components (both platforms)

- **Avatar**: colored circle (`user.avatarColor`) + white initials (1–2 letters).
- **MoneyText**: `formatMoney()` output; positive → money-positive color + "you are owed"
  phrasing; negative → money-negative + "you owe"; zero → muted "settled up".
  NEVER a bare minus sign as the only signal — pair color with wording or ±.
- **Buttons**: primary (brand bg, white text), secondary (surface-raised bg),
  ghost, destructive. Loading state = spinner + disabled.
- **Empty states**: emoji (context: 🧾 expenses, 👥 friends, ✈️ groups), one-line title,
  one-line hint, primary action button. Never a blank screen.
- **Loading**: skeleton blocks for lists/cards (not spinners) on first load.
- **Feedback**: web → sonner toasts (bottom-right); mobile → inline banners + haptics
  (success notification on save). Errors show the API's `message` verbatim.
- **Forms**: labels above inputs; inline validation on blur; the primary action is
  disabled until valid; Enter submits on web.

## Signature UX details (what makes Divzy feel better than Splitwise)

- Expense editor defaults: today's date, group's currency, "paid by you", EQUAL split,
  all members selected. Two fields (description + amount) are enough to save.
- Split-type picker = segmented control `= | 1.23 | % | shares | +/- | items` with a
  live per-person preview list that updates as you type (uses `computeSplits` from
  shared — the exact server math) and a running "left to assign" indicator for
  EXACT/PERCENT that must reach zero before save enables.
- Balances read as sentences: "Sam owes you $12.50", never raw signed numbers.
- Settle-up: suggestion rows have a one-tap "Record payment" that prefills the dialog.
- Realtime: lists refresh via socket events silently; a subtle toast "Ana added
  'Groceries' · $42.10" appears for group changes you didn't make.
- Web keyboard: `n` opens new-expense anywhere in a group page, `Esc` closes dialogs.

## Charts (analytics) — follow exactly

Charts use Recharts (web only; mobile shows stat tiles + simple bar lists built from
Views, no chart lib). Rules distilled from the validated dataviz method:

- Palette (categorical, FIXED order, never cycled):
  light `#2a78d6 #1baf7a #eda100 #008300 #4a3aa7 #e34948 #e87ba4 #eb6834`,
  dark `#3987e5 #199e70 #c98500 #008300 #9085e9 #e66767 #d55181 #d95926`.
  More than 8 categories → fold smallest into "Other" (muted gray `#898781`).
- **One axis only.** Never dual-axis. Monthly trend = single bar chart, 4px rounded
  top corners, thin bars (maxBarSize 28), 2px gap between bars.
- Category breakdown = horizontal bar rows (label left, value right, thin colored bar),
  NOT a pie/donut.
- Grid: hairline horizontal only (`#e1e0d9` light / `#2c2c2a` dark); axis text muted
  12px; no axis lines/ticks clutter.
- Tooltips on hover for every mark (Recharts `<Tooltip>`, styled to surface tokens).
- Values in tooltips/labels formatted with `formatMoney`. Text stays in ink colors,
  never series colors.
- Hero stat tiles: label (secondary, 13px) over value (28–32px semibold). Delta vs
  previous period: ↓ spend = positive-green, ↑ = secondary ink with "+x% vs last period"
  wording (spending more isn't an error — don't use red).
- Single series needs no legend; the title names it.
