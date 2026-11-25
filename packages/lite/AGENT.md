# @cdn/lite

A small, classless-first base CSS for quick, single-purpose tools — the
kind of page that needs a clean, standardized baseline (typography,
forms, tables, a few common notice boxes) without pulling in a full
design system or hand-writing a `<style>` block from scratch every time.
Link one file, write plain semantic HTML, done.

## Philosophy — read this before adding anything

- **Classless-first**, like [simplecss.org](https://simplecss.org/): style
  the semantic HTML tag directly (`body`, `h1`, `label`, `input`, `button`,
  `table`, `code`, ...). A page that links this file and uses zero classes
  should already look right. Classes exist only for shapes raw HTML has no
  tag for (`.error`/`.success`/`.warning`, `.box`, `.checkboxes`,
  `.kv-table`, `.row`).
- **Small footprint**, like [purecss.io](https://pure-css.github.io/): one
  file, no build step for consumers, no JS, no icon font, no grid system —
  `.row` is a two-line flexbox rule, not a 24-column grid. If a rule would
  only ever be used by one app, it belongs in that app's own `<style>`
  block, not here.
- **No dark mode, no theming system.** Explicitly rejected when this
  package was built. The CSS custom properties exist so a single value is
  easy to override per-app (e.g. `:root { --lite-accent: #16a34a; }` after
  the `<link>`), not as scaffolding for a theme switcher.
- **Before adding a new rule**, it should already be a recurring, genuine
  need across more than one page — not a speculative "might be useful
  someday" addition. A one-off need stays in that page's own `<style>`
  block.

## Usage

```html
<link rel="stylesheet" href="https://cdn.masiarek.pl/lite/@latest/lite.min.css">
```

That's the whole integration. No `<script>`, no build step, no extra
markup required beyond normal semantic HTML.

### Companion package: `@cdn/icons`

`@cdn/lite` only does layout/typography/form chrome — it has no icon set
and never will (see Philosophy: no icon font). Icons are a separate,
sibling package in this same repo (`packages/icons`, docs at
[masiarek.pl/icons](https://masiarek.pl/icons)), built from Bootstrap
Icons. Load both together when a page needs icons:

```html
<link rel="stylesheet" href="https://cdn.masiarek.pl/lite/@latest/lite.min.css">
<link rel="stylesheet" href="https://cdn.masiarek.pl/icons/@latest/icons.min.css">
<script src="https://cdn.masiarek.pl/icons/@latest/icons.min.js" defer></script>
```

```html
<h1><span class="icon icon-key-fill"></span> Password Generator</h1>
<button type="button"><span class="icon icon-dice-5-fill"></span> Generate</button>
```

## Reference

### CSS custom properties (`:root`)

| Variable | Default | Used by |
|---|---|---|
| `--lite-bg` | `#ffffff` | `body`, form controls |
| `--lite-text` | `#111827` | `body`, spinner border-top |
| `--lite-muted` | `#6b7280` | `header`/`footer`/`nav` text, `.kv-table` first column, blockquote |
| `--lite-border` | `#e5e7eb` | input/button/table borders, `hr`, spinner |
| `--lite-accent` | `#2563eb` | link color |
| `--lite-danger-bg` / `--lite-danger-text` | `#fef2f2` / `#991b1b` | `.error` |
| `--lite-success-bg` / `--lite-success-text` | `#f0fdf4` / `#166534` | `.success` |
| `--lite-warning-bg` / `--lite-warning-text` | `#fffbeb` / `#92400e` | `.warning` |
| `--lite-required` | `#dc2626` | `.required` |
| `--lite-code-bg` | `#f3f4f6` | `code`, `pre`, button background |
| `--lite-box-bg` | `#f9fafb` | `.box` background |
| `--lite-table-border` | `#cccccc` | `table`/`th`/`td` borders |
| `--lite-table-head-bg` | `#f5f5f5` | `th` background |
| `--lite-width` | `32rem` | `body` max-width (a narrow single-column page) |

Override one by redeclaring it on `:root` in a `<style>` block *after* the
`<link>` tag — no need to touch this file or fork it.

### Bare elements (no class needed)

- `body` — centered single column, `max-width: var(--lite-width)`, system
  font stack, `3rem` top/bottom margin. A narrow centered page, not a
  full-width layout — the one opinion this package holds unmodified.
- `h1`/`h2`/`h3` — sized, no color override (inherits `--lite-text`).
- `a` — colored with `--lite-accent`, no underline by default.
- `hr`, `blockquote`, `ul`/`ol` — minimal, muted-border/muted-text treatment.
- `header`, `footer` — centered, muted, small text. A simple
  "tool name / short tagline" header-footer pattern.
- `nav` — a small back-link pattern ("← Back"): no underline until hover.
- `label`, `input[type=text|number|email|password|url|search]`, `textarea`,
  `select` — full-width, bordered, `box-sizing: border-box` so padding
  never blows out a `.row` layout.
- `button`, `input[type=submit]` — bordered, `--lite-code-bg` background;
  `button[disabled]` dims to 60% opacity and drops the pointer cursor.
- `table`/`th`/`td` — assumes a header row (`<thead>`), bordered cells
  with a shaded header.
- `code`/`pre` — `--lite-code-bg` chip/block. `pre code` resets the
  double-background you'd otherwise get nesting the two.

### Classes

- **`.row`** — direct children become equal-width flex items, wrapping on
  narrow viewports. The "field next to field" side-by-side layout. Not a
  grid system — just this one shape.
- **`.checkboxes`** — a wrapping flex row of `<label><input
  type=checkbox>...</label>` pairs with tightened spacing, so a group of
  toggle options doesn't each take their own full-width `label` line.
- **`.error`** / **`.success`** / **`.warning`** — same box shape
  (padding, rounded corners, top margin), only the color pair differs.
  Use whichever matches the message: a failed action, a confirmed one, or
  something the user should notice but that isn't a failure.
- **`.box`** — a plain neutral panel: shaded background, rounded
  corners, padding. For grouping arbitrary content (a result tile, a
  usage note, anything that just needs to visually stand out from the
  page background without implying success/warning/error).
- **`.kv-table`** — the *other* table shape: label/value rows with no
  header row, muted first column pinned to 40% width. Use plain `table`
  instead when you have a header row; use `.kv-table` when you don't.
- **`.required`** — a red `*` or similar marker next to a label.
- **`.spinner`** — a small spinning loading indicator, typically shown
  next to a button while an API call is in flight. Respects `[hidden]`.
- **`.logo`** — constrains an `<img>` logo to a sane max width without
  the image needing its own inline styles.

### The `[hidden] { display: none !important }` rule

This exists because of a real bug: a page had a class like `.clear-link {
display: inline-block; }`, which silently overrode the browser's own
`[hidden] { display: none }` default the moment that class also carried
the `hidden` attribute — the element stayed visible. Any class in your own
page that sets `display` can do the same to any element you also mark
`hidden`. This rule makes `[hidden]` win unconditionally so that class of
bug can't recur. Toggle visibility with the `hidden` attribute
(`el.hidden = true`), not a custom "is-visible" class, and this is a
non-issue.

## Build

```bash
npm install
npm run build
```

Outputs `dist/lite.min.css` (+ sourcemap) via esbuild, same as every other
package in this repo. No bundler config beyond `build.mjs` — it's one CSS
file in, one minified file out.

## Adopting this in a new app

1. Drop the `<link>` tag (see Usage above) into the page's `<head>`,
   before any app-specific `<style>` block.
2. Delete whatever ad-hoc `body { font-family: system-ui, ... }` etc. rules
   the page already had — they're now redundant.
3. Keep only genuinely page-specific rules in that page's own `<style>`
   block, below the `<link>`, so they can still override this file's base.
4. If you find yourself duplicating a new rule across more than one page
   again, that's the signal to promote it here — see Philosophy above.
