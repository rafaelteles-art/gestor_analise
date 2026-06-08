# Dark Mode — Design Spec

**Date:** 2026-06-07
**Status:** Approved (design), pending implementation plan
**Scope:** Full, real dark mode across the entire REPORT app, with a Light / Dark / System control in the header.

## Problem

The app renders only in light mode. Today dark styling is limited to two root CSS
variables (`--background`, `--foreground`) that flip via `@media (prefers-color-scheme: dark)`
in `app/globals.css`. Because every component hardcodes light-mode Tailwind color
utilities (`bg-white`, `bg-[#f4f7fb]`, `text-gray-800`, etc.) — **815 such occurrences
across 22 component files, with zero `dark:` variants** — flipping those root variables
produces almost no visible change. There is also no user-facing control to choose a theme.

## Goal

- A user-selectable theme: **Light / Dark / System** (System follows the OS).
- The choice persists across reloads and is applied before first paint (no light flash).
- The whole app actually renders dark when Dark (or System→dark) is active.
- Light mode remains visually **identical** to today.

## Non-Goals

- No redesign of the light palette.
- No per-component theming beyond light/dark.
- No server-side persistence of the preference (localStorage only for v1).

## Strategy: `dark:` variants (class strategy)

Chosen over semantic-token refactor (B) and hybrid (C) because it keeps the existing
light UI byte-identical and lets each of the 22 components be converted and verified
independently. Trade-off accepted: more verbose class lists.

Tailwind v4 is configured for **class-based** dark mode (a `.dark` class on `<html>`),
not media-query based, so the JS-controlled toggle is the single source of truth.

## Architecture / Components

### 1. Tailwind + CSS config — `app/app/globals.css`

- Add the class-based dark variant:
  ```css
  @custom-variant dark (&:where(.dark, .dark *));
  ```
- Remove the `@media (prefers-color-scheme: dark)` block (the class now controls theme;
  "System" is resolved in JS, see below).
- Keep `:root` light vars; add a `.dark { ... }` override for `--background` / `--foreground`
  so the `body` base colors track the theme.

### 2. Anti-FOUC inline script — `app/app/layout.tsx` `<head>`

A small blocking inline `<script>` that runs before paint:
- Reads `localStorage.getItem('theme')`.
- If `'dark'`, or unset/`'system'` and `matchMedia('(prefers-color-scheme: dark)')` matches,
  add `class="dark"` to `document.documentElement`.
- Otherwise ensure the class is absent.

This prevents a light flash on first load. It is intentionally dependency-free and inline
(cannot be a React effect, which runs after paint).

### 3. Theme state — `app/app/components/ThemeProvider.tsx` (client) + `useTheme` hook

- Holds `theme: 'light' | 'dark' | 'system'`, initialized from `localStorage` (default `'system'`).
- `setTheme(next)` persists to `localStorage.theme` and applies the resolved class to
  `document.documentElement`.
- A resolver maps `'system'` → current OS preference.
- When `theme === 'system'`, subscribes to `matchMedia('(prefers-color-scheme: dark)')`
  `change` events and re-applies the class live.
- Wrapped inside the existing provider tree in `layout.tsx` (alongside `SessionProvider`).

**Interface:** `useTheme()` → `{ theme, resolvedTheme, setTheme }`.

### 4. Theme toggle UI — `app/app/components/ThemeToggle.tsx`

- A compact 3-state control (Light / Dark / System) using `lucide-react` icons
  (sun / moon / monitor — confirm availability in `lucide-react@1.7.0`, fall back to inline SVG).
- Rendered in the header bar of `V2MediaLabLayout.tsx` (line ~236), right-aligned next to
  the page title, so it is visible on every page that uses the shared shell.
- Styled with `dark:` variants like the rest of the app.

### 5. Component conversion — all 22 files

Add `dark:` counterparts to every color utility. Standard mapping (dark value chosen to
preserve contrast/hierarchy):

| Light usage                | Dark variant added            |
|----------------------------|-------------------------------|
| page bg (`#f4f7fb`, `gray-50/100`) | `dark:bg-gray-950` / `dark:bg-gray-900` |
| surfaces (`bg-white`)      | `dark:bg-gray-900` / `dark:bg-gray-800` |
| borders (`border-gray-100/200`) | `dark:border-gray-800` / `dark:border-gray-700` |
| primary text (`text-gray-800/900`) | `dark:text-gray-100` |
| secondary text (`text-gray-500/600`) | `dark:text-gray-300/400` |
| muted text (`text-gray-400`) | `dark:text-gray-500` |
| hover (`hover:bg-gray-50`)  | `dark:hover:bg-gray-800` |
| accents (indigo/blue/green/red/amber) | preserved; adjust only `-50` tint backgrounds (e.g. `bg-indigo-50` → `dark:bg-indigo-950/40`) |

Files (22): `V2MediaLabLayout.tsx`, `OfferSelector.tsx`, `HomeSignOut.tsx`, `page.tsx`,
`login/page.tsx`, `data-studio/page.tsx`, `analise/ClientAnalise.tsx`,
`importv2/ClientImportV2.tsx`, `import/ClientImport.tsx`, `import/CampaignHoverPopup.tsx`,
`users/UsersClient.tsx`, `overview/ClientOverview.tsx`, `catalogo/ClientCatalogo.tsx`,
`api-config/components/ApiTokenForm.tsx`, `status-contas/ClientStatusContas.tsx`,
`campaigns/ClientCampaignBuilder.tsx`, `paginas/ClientStatusPaginas.tsx`,
`ofertas/ClientOfertas.tsx`, `settings/components/VturbSyncPanel.tsx`,
`settings/components/BlacklistPanel.tsx`, `settings/components/AccountList.tsx`,
`settings/components/MetaSyncPanel.tsx`.

> Note: `react-select` (used in pickers) renders its own DOM; its dark styling needs the
> component's `styles`/`classNames` props, not plain `dark:` utilities. Flag during conversion.

## Data Flow

```
inline <head> script ──(pre-paint)──▶ sets .dark on <html> from localStorage/OS
        │
ThemeProvider (mount) ── reads localStorage ──▶ useTheme() context
        │                                            │
ThemeToggle.setTheme() ── writes localStorage ──▶ re-applies .dark ──▶ Tailwind dark: utilities repaint
        │
OS theme change (when 'system') ──▶ matchMedia listener ──▶ re-applies .dark
```

## Error Handling / Edge Cases

- `localStorage` unavailable (private mode / SSR): script and provider wrap access in
  try/catch; fall back to `'system'` / OS preference. Never throw.
- SSR/hydration: `<html>` has no `dark` class server-side; the inline script sets it before
  React hydrates, so server and client markup agree (class is applied via DOM, not React-rendered
  attribute) — avoids hydration mismatch warnings.
- Invalid stored value: treat anything other than `light`/`dark`/`system` as `system`.

## Testing

- Unit (vitest): theme resolver (`system` → light/dark given OS pref); `localStorage`
  persistence; invalid-value fallback.
- Manual: toggle each of the 3 states; reload (no light flash); switch OS theme while on
  "System"; spot-check each of the 22 screens in dark; confirm light mode unchanged.
- `tsc --noEmit` clean after each component batch.

## Rollout

- No deploy-time data dependency, but per the project's `force-dynamic` rule this is a
  client-only concern and unaffected.
- After implementation, run `graphify update .` to refresh the knowledge graph.

## Open Questions

- Confirm `lucide-react@1.7.0` exports `Sun` / `Moon` / `Monitor` (else inline SVG).
- `react-select` dark styling approach (custom `classNames` vs `styles`) — decide during conversion.
