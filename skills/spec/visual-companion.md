# Visual companion: driving the browser tab

How to run the mockup server under `scripts/` once your human partner has said yes to the companion. Read it before the first start.

## Browser or terminal: decide per question
The companion is a per-question tool, not a session mode. Ask each time: would they get this faster by looking than by reading?

| The question is about... | Where | For instance |
|---|---|---|
| something whose answer is a sentence (what a word means, a yes or no, a clarification) | terminal | "Should archived items count toward the quota?" |
| how something looks: polish, spacing, visual hierarchy | browser | two type scales for the same page |
| what is in or out of scope, what it must do | terminal | "Which reports are in?" |
| how parts relate in space: state machines, flowcharts, entity diagrams, data flow, component maps | browser | a diagram of the import pipeline |
| a technical decision: API shape, data model, which architecture | terminal | REST vs. a queue for notifications |
| two or more directions, layouts or color schemes to compare | browser | the same screen in two arrangements, side by side |
| weighing costs: pros and cons, comparison tables | terminal | a table of three hosting options |
| a screen's structure: wireframes, navigation, components | browser | a wireframe of the settings page |
| approaches that differ in idea rather than appearance (A/B/C in words) | terminal | "sync nightly, or on every save?" |

The topic does not decide it. "Should the sign-up be one page or several steps?" is conceptual and stays in text; "Which of these two sign-up layouts reads better?" is visual and goes to the browser.

## The moving parts
- A small server watches a content folder and always shows the most recently modified `.html` file in it.
- You create screens in `screen_dir`; your partner sees them in the browser and can click options.
- Each click is appended as one JSON line to `$STATE_DIR/events`, which you read on your next turn.
- A file whose first characters are `<!DOCTYPE` or `<html` is served as written, with only the helper script injected. Anything else is a fragment: the server drops it into the frame template at its `<!-- CONTENT -->` marker (the template's `<!-- BRANDING -->` marker becomes the plugin badge), which supplies the header, theme CSS, connection indicator and click handling. Write fragments unless you truly need control of the whole page.

## Starting the server
Only after your partner accepts the companion:

```bash
bash scripts/start-server.sh --project-dir /path/to/project --open
```

It prints one JSON line, for example:

```json
{"type":"server-started","port":49152,"url":"http://localhost:49152/?key=9f3c…","screen_dir":"/path/to/project/.ai-sdlc/brainstorm/4821-1760000000/content","state_dir":"/path/to/project/.ai-sdlc/brainstorm/4821-1760000000/state"}
```

Keep `screen_dir` and `state_dir`. The session folder is their parent (`.ai-sdlc/brainstorm/<pid>-<epoch>/`); you need it to stop the server.

| Flag | Effect |
|---|---|
| `--project-dir <path>` | Session lives in `<path>/.ai-sdlc/brainstorm/`, mockups survive a stop, and a restart reuses the same port and key. The script also creates `.ai-sdlc/.gitignore` (containing `*`) if it is absent, so nothing lands in git. Without this flag the session goes to `/tmp/brainstorm-<id>` and is deleted on stop. Always pass the project root. |
| `--open` | The browser opens by itself when the first screen arrives. |
| `--host <bind>` | Interface to bind; default `127.0.0.1`. Use `--host 0.0.0.0` when the URL cannot be reached from the browser (remote machines, containers). |
| `--url-host <name>` | Hostname written into the printed URL, e.g. `--url-host localhost` alongside `--host 0.0.0.0`. |
| `--idle-timeout-minutes <n>` | Shut down after n idle minutes; default 240 (four hours). |
| `--foreground` / `--background` | By default the script puts the server in the background itself and switches to foreground on its own where background processes get reaped (CI sandboxes, Windows shells). These flags force one mode. |

Remote or containerized setup:

```bash
bash scripts/start-server.sh --project-dir /path/to/project --host 0.0.0.0 --url-host localhost
```

An unknown flag prints `{"error": "Unknown argument: ..."}` and exits 1.

### The key in the URL
The `url` field ends in `?key=…`. The server refuses every HTTP and WebSocket request that lacks the key, so no stray tab or other machine on the network can read screens or inject clicks. Give your partner the whole URL exactly as printed; never trim the query string or hand out a bare `http://host:port`. After the first visit a cookie carries the key, so reloads and `/files/*` assets keep working.

Even with `--open`, share the URL: headless and remote setups cannot open a browser for you.

### Lost the startup line?
The server also writes the same JSON to `$STATE_DIR/server-info`. If you started it without capturing stdout, read that file; with `--project-dir`, the session folders are under `<project>/.ai-sdlc/brainstorm/`.

## Each screen, step by step
1. **Confirm it is alive.** Before you mention the URL or write a screen, the server counts as up only while `$STATE_DIR/server-info` is present and `$STATE_DIR/server-stopped` is absent. If it stopped (idle timeout, crash, stop script), run `start-server.sh` again with the same `--project-dir`: it comes back on the same port, the open tab (showing a "paused" overlay meanwhile) reconnects by itself, and no new URL is needed.
2. **Write a new file** in `screen_dir` with your file-creation tool, not `cat` or a heredoc, which spills the markup into the terminal. Give it a name that says what it shows (`checkout-flow.html`, `color-palette.html`). Never write to an existing name; each screen is a new file, and the newest one is what the browser shows.
3. **Tell them and stop.** Repeat the URL every time, say in a sentence what is on screen ("Two checkout layouts, A and B"), and ask them to answer in the terminal, clicking an option if they like. End your turn.
4. **Next turn: combine both signals.** Their terminal message is the main feedback. If `$STATE_DIR/events` exists, read it for the clicks and merge them with what they wrote.
5. **Revise or move on.** Feedback that changes the screen means a new file (`checkout-flow-v2.html`). Move to the next question only once this one is settled.
6. **Clear the tab when you go back to text.** If the next question is not visual, push a waiting screen so they are not left looking at a decided choice:

   ```html
   <!-- waiting.html, then waiting-2.html, ... -->
   <div style="display:flex;align-items:center;justify-content:center;min-height:60vh">
     <p class="subtitle">Back in the terminal for now.</p>
   </div>
   ```

   The next visual question gets a fresh content file as usual.

## Reading clicks
`$STATE_DIR/events` holds one JSON object per line, one per click on an element with `data-choice`. The server empties it whenever a new screen appears.

```jsonl
{"type":"click","choice":"b","text":"B - Cards with thumbnails","timestamp":1760000210}
{"type":"click","choice":"a","text":"A - Plain list","timestamp":1760000216}
{"type":"click","choice":"b","text":"B - Cards with thumbnails","timestamp":1760000231}
```

The last click is usually where they landed, but back-and-forth like the above is itself a signal worth a question. No file means no clicks; work from their terminal text alone.

## Writing a fragment
A fragment is just the body content. No `<html>`, `<head>`, CSS or `<script>`: the frame adds them.

```html
<h2>How should saved recipes be listed?</h2>
<p class="subtitle">Think about scanning a long collection on a phone</p>

<div class="options">
  <div class="option" data-choice="a" onclick="toggleSelect(this)">
    <div class="letter">A</div>
    <div class="content"><h3>Plain list</h3><p>Titles only, alphabetical</p></div>
  </div>
  <div class="option" data-choice="b" onclick="toggleSelect(this)">
    <div class="letter">B</div>
    <div class="content"><h3>Cards with thumbnails</h3><p>Photo, title and cooking time</p></div>
  </div>
</div>
```

### Class reference
Every clickable element takes `data-choice="<id>"` and `onclick="toggleSelect(this)"`.

| Building block | Markup | Use |
|---|---|---|
| Option list | `class="options"` holding `class="option"` items, each with `class="letter"` and `class="content"` (an `h3` and a `p`) | A/B/C choices. Add `data-multiselect` to the container to let several be selected; each click toggles one. |
| Cards | `class="cards"` holding `class="card"`, each with `class="card-image"` (the mockup) and `class="card-body"` (`h3` + `p`) | Comparing visual designs |
| Mockup frame | `class="mockup"` with `class="mockup-header"` (caption) and `class="mockup-body"` (the mockup) | Showing one design in a labeled frame |
| Split view | `class="split"` around two `mockup` frames | Side by side |
| Pros and cons | `class="pros-cons"` with `class="pros"` and `class="cons"`, each an `h4` and a `ul` | Weighing one option |
| Wireframe parts | `class="mock-nav"`, `class="mock-sidebar"`, `class="mock-content"`, `class="mock-button"` (on a button), `class="mock-input"` (on an input), `class="placeholder"` | Quick wireframes |
| Text | `h2` page title, `h3` section heading, `class="subtitle"` line under the title, `.section` block with bottom spacing, `.label` small uppercase tag | Page structure |

A card and a wireframe together:

```html
<div class="cards" data-multiselect>
  <div class="card" data-choice="dense" onclick="toggleSelect(this)">
    <div class="card-image">
      <div class="mock-nav">Recipes | Planner | Shopping</div>
      <div style="display:flex">
        <div class="mock-sidebar">Filters</div>
        <div class="mock-content"><div class="placeholder">Recipe grid</div></div>
      </div>
      <input class="mock-input" placeholder="Search recipes">
      <button class="mock-button">Add recipe</button>
    </div>
    <div class="card-body"><h3>Dense</h3><p>Filters always visible</p></div>
  </div>
</div>
```

## Making screens that work
- Two to four options on a screen; more turns a choice into a survey.
- Write the full question at the top of each page ("Which listing is easier to scan?"); a bare "Choose one" leaves them guessing what to judge.
- Aim for structure and layout. Pixel-perfect mockups waste time and distract from the question.
- Fidelity follows the question: a layout question gets a wireframe, and polish appears only when polish is what you are asking about.
- Filler text and gray boxes hide problems when the content drives the design; for a photo-heavy page, use real photos (Unsplash works).
- Feedback that changes a screen produces a new version before you move on, named with a suffix (`layout-v2.html`, `layout-v3.html`); the server shows whichever file was modified last.

## Stopping

```bash
bash scripts/stop-server.sh $SESSION_DIR
```

`$SESSION_DIR` is the folder holding `content/` and `state/`. It prints one status line:

| Output | Meaning | `server-stopped` written? |
|---|---|---|
| `{"status": "stopped"}` | server shut down (SIGTERM, then SIGKILL after about 2 s if needed) | yes, and `server-info` is removed |
| `{"status": "stale_pid"}` | the recorded PID is not this session's server, so it is not signalled | yes, and `server-info` is removed |
| `{"status": "not_running"}` | no PID file in `state/` | no, nothing is touched |
| `{"status": "failed", ...}`, exit 1 | the process survived the kill | no |

A missing argument prints an error and exits 1. On `stopped`, a session under `/tmp` is deleted; sessions under `.ai-sdlc/brainstorm/` keep their mockups for later reference.

## Files behind the frame
- `scripts/frame-template.html`: the page wrapper and its CSS, the reference for the classes above.
- `scripts/helper.js`: the in-page script that records clicks and keeps the connection.
