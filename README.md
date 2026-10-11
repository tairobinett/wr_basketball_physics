# wr_basketball_physics

2D cross-section basketball free-throw simulator with a deterministic physics core.

The shooter stands on the left, the goal on the right. You control position, release height, angle
and power; the ball is integrated under gravity with swept, impulse-based collisions against the
floor, the backboard and both rim nodes. Every meaningful event is logged, and every shot is
reproducible from a short descriptor that lives in the URL.

See [DESIGN.md](DESIGN.md) for the full design, the reasoning behind each decision, and the
decisions log.

## Running it

```bash
npm install
npm run dev        # dev server (prints the URL)
npm run build      # typecheck + production build into dist/
npm test           # 48 tests
npm run typecheck  # tsc --noEmit
```

### Note on WSL vs. Windows

This repo lives on the WSL filesystem (`/home/tai/projects/...`), which is reachable from Windows
as `\\wsl.localhost\Ubuntu-24.04\...`. That makes the toolchain sensitive to which side you run it
from:

- **The installed `node_modules` is Windows-native** (`@esbuild/win32-x64`,
  `@rollup/rollup-win32-*`), because WSL has Node 18 but no `npm` — only the Windows npm is
  reachable from inside WSL via PATH interop. Run the tooling from Windows and it works as is.
- **To work from inside WSL instead**, install npm there (`sudo apt install npm`, or nvm) and
  re-run `npm install` from WSL so the native binaries match. The two installs are not
  interchangeable.
- **`npm` cannot be run with a UNC path as the working directory** (`cmd.exe` refuses: "UNC paths
  are not supported"). Map a drive letter first — `pushd \\wsl.localhost\Ubuntu-24.04\home\tai\projects\wr_basketball_physics`
  does this automatically for the life of that shell — or work from inside WSL.
- **File watching is set to polling** in `vite.config.ts`. Native `fs.watch` fails outright over an
  SMB/UNC share (`EISDIR: illegal operation on a directory, watch ...`), so the dev server would
  crash on startup without it. Polling costs a little CPU when running natively from WSL and is
  left on so both ways of working behave the same.

## Controls

| Input | Action |
|---|---|
| `Space` | shoot |
| `R` | reset |
| `↑` / `↓` | release angle (hold `Shift` for 0.1° steps) |
| `←` / `→` | power (hold `Shift` for 0.01 m/s steps) |
| drag from the shooter | aim by direction, power by distance |
| `P` / `.` | pause / single step |
| `G` / `C` | predicted arc / collider wireframe |
| `?` | help overlay |

The make window is only ~0.14 m/s wide, so hold `Shift` when hunting for it.

Every shot is encoded in the URL hash. Copying the address bar shares that exact shot, because the
sim is deterministic — see DESIGN.md §4.1.

## Layout

```
src/core/     the sim: pure, no DOM, no clock, no randomness
src/log/      structured events, ring buffer, text/JSON/CSV formatting
src/render/   camera and canvas drawing
src/ui/       controls, HUD, log drawer
src/levels/   level schema, validator, and the regulation court
tests/        analytic, collision, determinism, golden and boot tests
```

The dependency rule: `core/` imports from nothing else in the project. That is what lets the same
code run the interactive sim, the predicted-arc ghost, the test suite, and (next) the sweep workers.

## Status

M0–M6 of the design are implemented: geometry, integrator, collisions, controls, logging, scoring
and tests. **M7, the outcome map** (sweep the angle/power space and draw which shots go in), is the
next piece of work. Stretch items — level editor, wind, user-facing spin — are scoped in DESIGN.md
but not built; air drag and Magnus are implemented behind default-off toggles.

## Physics notes

Two external anchors validate the model, rather than it only agreeing with itself:

- **Ball inflation drop test.** Dropped from 1.80 m (to the ball's bottom), the rebound (to the
  ball's top) lands inside the regulation 1.20–1.40 m window. This fixes `hardwood.e = 0.77`.
- **Human free throw.** The simulated make window at 52° from 2.1 m is 7.160–7.300 m/s, inside the
  published human release range of ~7.0–7.5 m/s. Nothing was tuned to achieve this.

And one result that simply fell out: the make window widens monotonically with release angle
(0.085 m/s at 45°, 0.190 m/s at 60°), which is why a high arc is more forgiving.
