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
  tag for (`.error`/`.success`/`.warning`/`.info`, `.box`, `.checkboxes`,
  `.kv-table`, `.row`, `.wide`, `.cols`).
- **Small footprint**, like [purecss.io](https://pure-css.github.io/): one
  file, no build step for consumers, no JS, no icon font, no *general*
  grid system — `.row` is a two-line flexbox rule, not a 24-column grid.
  `.cols` is the one deliberate exception: a single, fixed two-column
  sidebar+content shape (CSS Grid, not a column framework), added only
  once two real pages needed exactly that shape — see its own entry
  below. If a rule would only ever be used by one app, it belongs in
  that app's own `<style>` block, not here.
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
<link rel="stylesheet" href="https://cdn.masiar.io/lite/@latest/lite.min.css">
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
<link rel="stylesheet" href="https://cdn.masiar.io/lite/@latest/lite.min.css">
<link rel="stylesheet" href="https://cdn.masiar.io/icons/@latest/icons.min.css">
<script src="https://cdn.masiar.io/icons/@latest/icons.min.js" defer></script>
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
| `--lite-info-bg` / `--lite-info-text` | `#eff6ff` / `#1e40af` | `.info` |
| `--lite-required` | `#dc2626` | `.required` |
| `--lite-code-bg` | `#f3f4f6` | `code`, `pre`, button background |
| `--lite-box-bg` | `#f9fafb` | `.box` background |
| `--lite-table-border` | `#cccccc` | `table`/`th`/`td` borders |
| `--lite-table-head-bg` | `#f5f5f5` | `th` background |
| `--lite-width` | `32rem` | `body` max-width (a narrow single-column page) |
| `--lite-wide-width` | `64rem` | `.wide` max-width |
| `--lite-sidebar-width` | `12rem` | `.cols` sidebar column width |

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
- **`.error`** / **`.success`** / **`.warning`** / **`.info`** — same box
  shape (padding, rounded corners, top margin), only the color pair
  differs. Use whichever matches the message: a failed action, a
  confirmed one, something the user should notice but that isn't a
  failure, or a neutral note.
- **`.box`** — a plain neutral panel: shaded background, rounded
  corners, padding. For grouping arbitrary content (a result tile, a
  usage note, anything that just needs to visually stand out from the
  page background without implying success/warning/error).
- **`.wide`** — widens `body` to `var(--lite-wide-width)` (64rem) with a
  smaller top margin, for text-heavy pages (API docs, reference pages)
  where the default 32rem feels cramped. `body` itself keeps its
  original 32rem default — `.wide` is an opt-in modifier, not a change
  to the base.
- **`.cols`** — a two-column CSS Grid: a fixed-width sidebar
  (`var(--lite-sidebar-width)`, 12rem) and a flexible content column.
  Apply directly to `<body>` alongside `.wide` — no wrapper div, just a
  `<nav>` and one other direct child (typically `<main>`):
  ```html
  <body class="wide cols">
    <nav>...</nav>
    <main>...</main>
  </body>
  ```
  Add `.sidebar-right` to put the sidebar on the right instead (the
  `<nav>` stays first in the DOM for reading/tab order — only its visual
  position moves, via `order`). The sidebar is `position: sticky` so it
  stays in view while the content column scrolls. Below 640px, `.cols`
  collapses to a single column with `<nav>` stacked above the content,
  sticky disabled — see "Optional: collapsible mobile nav" below for
  turning that stacked list into a hamburger-triggered one instead of
  always showing it in full.
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

### Optional: collapsible mobile nav (JS snippet)

`.cols` ships CSS-only: on mobile, `<nav>` just stacks above the content
in full — no JS in this package, per Philosophy. For a `<nav>` with many
links (or nested sub-lists) where a full always-expanded stack pushes the
actual content too far down the page, a page can opt into a
hamburger-style collapsible nav with its own small script — this is not
loaded by `@cdn/lite` itself, just a pattern to copy into that page's own
`<script>` block (same as `qr.masiar.io`'s CSRF polling or
`lenny.masiar.io`'s clipboard copy — page-specific behavior stays in that
page).

Markup — any number of nesting levels, each with its own toggle button
immediately before the list it controls:

```html
<nav>
  <button type="button" class="nav-toggle" aria-expanded="false" aria-controls="site-nav">Menu</button>
  <ul id="site-nav" hidden>
    <li><a href="/installation">Installation</a></li>
    <li>
      <button type="button" class="nav-toggle" aria-expanded="false" aria-controls="sub-size">Size</button>
      <ul id="sub-size" hidden>
        <li><a href="/size/small">Small</a></li>
        <li><a href="/size/large">Large</a></li>
      </ul>
    </li>
  </ul>
</nav>
```

Script — one delegated click handler, works for every `.nav-toggle` on
the page regardless of nesting depth, since each toggle only ever
controls its own `aria-controls` target:

```js
document.addEventListener('click', function (e) {
  var toggle = e.target.closest('.nav-toggle');
  if (!toggle) return;

  var target = document.getElementById(toggle.getAttribute('aria-controls'));
  if (!target) return;

  var expanded = toggle.getAttribute('aria-expanded') === 'true';
  toggle.setAttribute('aria-expanded', String(!expanded));
  target.hidden = expanded;
});
```

How this works with `.cols`'s own CSS: every `.nav-toggle` is styled to
look like plain text, not a button, at any depth — so a nested one (e.g.
"Size") still reads as that section's heading even when it isn't acting
as a clickable control. Only the *outermost* toggle (the "Menu"
hamburger, a direct child of `<nav>`) is hidden above the 640px
breakpoint; nested toggles stay visible everywhere, since anything they
hide gets forced back open on desktop anyway. Below 640px, the hamburger
reappears (styled as a bordered button) and whatever the script has set
`hidden` stays hidden — exactly what `[hidden] { display: none
!important }` is for (see above). Above 640px, `.cols > nav [hidden] {
display: block !important }` forces every list back open regardless of
its `hidden` attribute, so the desktop sidebar always shows the full,
expanded nav — the same markup works unmodified at both widths. A nested
`<ul>` indents via `.cols > nav ul ul { padding-left: 1rem }`, already
included.

Only add this when a real `<nav>` actually has enough links (or nesting)
to justify it — a short flat list is fine left always-expanded, per
Philosophy's "recurring, genuine need" rule.

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
