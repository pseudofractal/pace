# Pace

A progress timer for anything countable. Catppuccin themes, saved sessions, and offline Android PWA support. A Focus view keeps the timer, deadline, and pace insights front and center; a Sessions view holds the searchable library, with a fixed control dock on phones.

- **Use:** [pseudofractal.github.io/pace](https://pseudofractal.github.io/pace/) — set a goal and start.
- **Keys:** `P` complete unit · `L` undo · `T` pause/resume · `S` start/stop.
- **Forecast:** Live pace chart and recent-versus-average trends. Choose an ETA based on the last 5 completed units (default) or the whole session. Overlong current units use `≥` to mark a lower-bound estimate.
- **Deadline:** Set an optional local finish time to see required pace, estimated buffer, and whether you're on track. Breaks consume deadline time. Deadlines and ETA choices save with sessions and backups; completed sessions record whether the deadline was met. Restart clears the old absolute deadline.
- **History:** Create, review, edit, rename, resume, restart, or delete sessions. Renaming keeps progress and timings; deletion asks for confirmation. Stored in this browser only; clearing site data erases them.
- **Browse:** Search sessions by name, filter by status, and sort by newest, oldest, or name.
- **Cleanup:** Select individual sessions or all shown results to delete in bulk. Undo the latest single or bulk deletion for 10 seconds; running timers return paused. Changing the search or status filter clears the selection.
- **Tools:** JSON backup/import, setup presets, notes, pace charts, and optional screen wake lock. Quotes and sparkles can be disabled.
- **Deploy:** Push to `main`; GitHub Actions tests and publishes to Pages automatically.
- **Android:** Open the hosted HTTPS site in Chrome → **Install**.
- **Tests:** `node test-study-timer.cjs`; `node test-browser.cjs` (Chrome required).
