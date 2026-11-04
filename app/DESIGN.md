# Config App design guidelines

Theme **Midnight** (dark, default) and **Daylight** (light, `prefers-color-scheme`). Source of truth: the
design canvas https://claude.ai/artifact/EbUJGUthCwaCc33u4b24LZ (themes, components, icons, pod icon, pod as
button, app icon, splash, phone layouts). A new look is designed on the canvas first, then built with the tokens.

## Tokens (`src/app/theme.css`)
Never write a colour in a component's CSS; use a token so both themes work.

| Token | Midnight | Daylight | Use |
|---|---|---|---|
| `--bg` | `#0b1426` | `#eef3fb` | page, header |
| `--surface` | `#122039` | `#ffffff` | cards, sections, sheets |
| `--surface-2` | `#1a2c4d` | `#e2eaf6` | inputs, rows in cards, segmented controls |
| `--border` | `#26395e` | `#c9d5e8` | card and input borders |
| `--text` / `--text-muted` | `#e7eefa` / `#93a5c6` | `#0b1630` / `#4a5c7e` | text / secondary, inactive icons |
| `--accent` | `#5b9bff` | `#1e5bd8` | the one accent: primary buttons, links, active tab |
| `--accent-contrast` | `#06122b` | `#ffffff` | text on accent |
| `--accent-soft` | `#1b3566` | `#dce7fc` | active tab pill, selected |
| `--ok` / `--warn` / `--error` | `#34d399` / `#fbbf4b` / `#ff6b81` | `#11804a` / `#a85a00` / `#c21e3a` | status |
| `--floating-*` | | | floating tab bar |
| `--pod-*` | same in both | | the pod puck (dark device in both themes) |
| `--led-*` | same in both | | firmware LED colours, only where they mean LEDs |

Text contrast ≥ 4.5:1 in both themes; colours that must be told apart also differ in lightness.

## Type
`--font-display` (Barlow Semi Condensed 600/700): page titles 26 px, pod names, big numbers. `--font` (Inter
400/500/600): everything else, body 16 px, labels 13–14 px. `--font-mono`: paths, expressions, block ids.
Fonts are bundled (`@fontsource`, latin, imported in `src/main.tsx`) for offline use.

## Icons
- Lucide with one thick stroke (`--icon-stroke` 2.5 in `theme.css`): plain `<Icon size={20} aria-hidden />`,
  never pass `strokeWidth`. Few-stroke glyphs, 20–24 px in lists and buttons, 24 px in the tab bar.
- **`PodIcon`** (`src/components/PodIcon.tsx`, canvas "C2 · back rim") wherever a pod, the set or the
  connection is meant, never Lucide `Radio` etc. Glow from `--pod-glow` (default green);
  `--pod-glow: currentColor` switches it off (inactive tabs).

## The pod
Always the raised puck `LedRing` (`src/components/LedRing.tsx`): cap with a drop edge, 18 LEDs as segments
on the rim; never a flat ring. Optional `title` (name or pod count) and `subtitle` (state, big pucks only)
inside the cap, no labels below. Pressable (Try, game page): the whole puck is the button, `pressed` moves the
cap down; 140 px for 1–2 pods, 116 px for 3–4, 96 px for more. List pucks 56–64 px with the count inside.

## Navigation
- Three destinations by task: **Train** (`/train`), **Games** (`/games`), **Results** (`/results`). Settings
  from the header gear. The connection chip opens **This set** (`/set`, no tab) when connected, else the
  connection dialog. The menu (`/set/menu`) is linked from This set.
- Sub-pages: back arrow to an explicit parent (never history); the parent tab stays highlighted.
- Phone: header (title in the display font, connection chip, settings) + floating tab bar, 12 px above the
  bottom; `.main` keeps room for it; fixed elements (the + button) above it. Toasts at the top, except the
  "ready offline" notice, which sits at the bottom above the tab bar.
- ≥ 900 px: side rail with all destinations (Settings included), no tab bar.
- ≥ 900 px, two columns (`components/Split`, page class `.wide`): what you act on left, what you look at
  right and sticky. Train: controls | last round and progress. Edit: step list | live simulator. Results:
  athletes | selected athlete (`?athlete=`). This set: pods and menu | set and Send to pods. Games on the
  pods: list | pattern editor. Content that only exists on desktop mounts with `useDesktop()`, never hidden
  with CSS. Dialogs (`Modal`) are centred with a scrim from 600 px.

## Screens
- **Train:** one live surface for the connected set. State header in the pod-light colours with the state in
  words, athlete chips, last round result in big figures, value steppers (applied with Continue or Start),
  Continue / Repeat / Pause / Stop in thumb reach. Not connected: the puck and a numbered connect guide.
- **Games:** rows with name, description and pods needed. Chips only for problems, in words.
- **Game page** (`/games/game`): header (name, pods needed, origin, ··· menu) and a segmented control
  **About · Edit · Try**. Shipped games are read only: **Make my copy** instead of Edit. Edit has a bottom
  bar (Undo, Redo, Add step, Try) and shows problems as a banner. Try: tappable pods, the current step as a
  sentence, results in seconds, details collapsed, bottom bar Pause / Skip pause / Start over.
- **Step sheets:** plain words and LED colour names with presets; locked steps say why; the footer has Done.
  Block names and ports only in expert mode.
- **This set:** unsent changes in words with one **Send to pods**, battery per pod, Find, details collapsed,
  **Reset menu** as a danger action. The connection chip carries a dot while changes are unsent.
- **Results:** athletes by last training; athlete page with trend, change and personal best; a training shows
  its summary first, then the rounds. A round left out is marked, with undo.
- **Settings:** language, expert mode, debug console, file deletion, and the platform preview under Advanced
  only (a development option).

## Copy
- Short sentences, one term per thing, in both languages: game (Spiel), main pod (Zentrale), send (Send to
  pods / Auf die Pods hochladen), round (Runde). Durations in seconds everywhere.
- Variables and metrics get human labels; internal names only in expert mode.
- Every UI text in `en.json` and `de.json`; a test checks the keys.

## Layout rules
- Mobile first: touch targets ≥ 44 px, no drag and drop needed, nothing cut off at 360 px.
- Cards: `--surface`, 1 px `--border`, radius `--radius-m`–`--radius-l`; no coloured left stripes (use an icon tile).
- One primary (filled `--accent`) button per view; others outlined or plain.

## App icon and splash
- Icon / favicon: six-segment ring, 4 blue "ready" + 2 green "go", white button in the middle. Generated by
  `npm run icons` (`scripts/make-icons.mjs` → `public/icons/`): change the script, not the files.
- Splash: static HTML/CSS in `index.html` (big puck "ReactPod", segments chasing in the icon colours, cap
  pressing), replaced when React mounts; no animation under `prefers-reduced-motion`.

## Checking a UI change
`npm run build`, `npm run preview`, `node scripts/screenshots.mjs <dir>` at 360 px and 1200 px in both
schemes. Look at the screenshots.
