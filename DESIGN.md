# Free Throw Simulator — Design Doc

Status: **M0–M7 implemented** (100 tests passing) · Date: 2026-10-13 ·
Repo: `wr_basketball_physics`

Where the build corrected this document, the document has been corrected rather than quietly
diverging — see §13 for the list.

A 2D cross-section basketball free-throw simulator. The player stands on the left, the hoop and
backboard are on the right, and the user aims and releases a shot that is integrated under
gravity with rigid-body collisions against floor, backboard, and rim.

---

## 1. Goals and non-goals

**Goals**

- Side-on (cross-section) 2D view: player left, goal right, floor along the bottom.
- User controls: player x-position, release angle, release force (speed), release height.
- Physics: gravity, restitution + friction collisions with floor, backboard, and both rim nodes.
- Verbose, structured, exportable logs of every meaningful sim event.
- **Strict determinism**: identical inputs produce an identical event stream and an identical final
  state, every run, on any machine running the same build. A shot is fully described by a small
  record and is replayable from it. §4.1 spells out the contract this imposes on the core.
- Correct real-world dimensions and units (SI), so results are physically interpretable.
- **Outcome map**: sweep the (angle, power) space and visualize which shots go in (§12).

**Stretch goals** (designed for, not built in v1)

- Air drag and wind.
- **User-facing spin control** plus the Magnus force. Note that `ω` is plumbed through the core from
  day one (§5.1) and spin is still *generated* in v1 by friction at contacts — what's deferred is
  the release-spin slider and the Magnus term.
- Level editor: place obstacles, wind zones, move the goal; save/load JSON levels.
- Additional materials and a runtime `e`/`μ` tuning UI.
- Net modeled as a drag/deflection region rather than cosmetics.

**Non-goals**

- 3D, and any left/right (off-axis) error. The cross-section means every shot is in-plane: it
  either goes in or it doesn't, and there is no "side rim" miss. A 3D version may be asked for
  later; §14 lists the hedges that cost nothing to take now and the ones we are deliberately not
  taking. No v1 code gets contorted around a hypothetical 3D.
- Shooting animation or skeleton. The shooter is a static stick figure at the release point (§7).
- A release-error / variance model, anywhere, in any form. Materials keep their measured values and
  the sim stays exact. The outcome map (§12) reports hard make/miss, not probability.
- AI shooter, multiplayer, sound.

---

## 2. Language and stack decision

**Decided: TypeScript, browser, Canvas 2D, built with Vite. No game engine, no physics library.**

Rationale:

- The deliverable is an interactive toy with sliders and a live visualization. The browser is the
  shortest path to that, and zero-install sharing (a URL or a static build) matters for something
  meant to be shown to someone.
- Canvas 2D is sufficient — this is a handful of primitives per frame. WebGL/Pixi/Phaser would add
  build weight for no gain.
- We *want* to write the physics ourselves. The interesting content of this project is the
  collision response and material model; Matter.js/Planck would hide exactly the part worth
  owning, and their restitution models are tuned for stable stacking, not for a single fast-moving
  ball striking a thin plate and a 1 cm rim.
- TS's type system earns its keep in a sim: branded unit types, discriminated-union log events,
  exhaustive switches over collider kinds.

Why not Python: pygame is fine, and NumPy would make the numerics pleasant, but distribution is
worse, UI widgets are hand-rolled, and a one-ball sim is nowhere near needing NumPy's throughput.
The one argument for Python was the batch sweep, and that is now in scope (§12) — but it runs
comfortably in Web Workers, so it doesn't justify the language switch. The core stays headless and
dependency-free regardless, which keeps the door open to driving it from Python later via WASM if
the analysis ever outgrows the browser.

Toolchain: Vite + TypeScript (strict), Vitest for unit tests, ESLint + Prettier. No runtime
dependencies in the core; UI is plain DOM (no React needed for ~8 controls, and it keeps the
render loop honest).

---

## 3. Coordinate system, units, and world constants

SI throughout: metres, seconds, kilograms, radians. **y is up**, x increases to the right, origin
at the floor line. Pixels appear only inside the renderer's world→screen transform.

Angles: release angle measured CCW from the +x axis, so 45° is up-and-right. Positive angular
velocity is CCW, which means backspin on a right-facing shot is **positive** ω.

Regulation geometry (NBA/FIBA), with the backboard face placed at `x = 6.0`:

| Quantity | Symbol | Value |
|---|---|---|
| Rim height (top of rim) | `RIM_Y` | 3.048 m (10 ft) |
| Rim inner diameter | `2*R_RIM` | 0.4572 m (18 in) |
| Rim tube radius | `r_tube` | 0.0095 m (5/8 in dia.) |
| Hoop centre from backboard face | — | 0.381 m (15 in) |
| Backboard face | `BOARD_X` | 6.0 m (arbitrary world placement) |
| Backboard vertical extent | — | 2.896 m → 3.962 m (9 ft 6 in to 13 ft) |
| Free-throw line from backboard face | — | 4.572 m (15 ft) ⇒ shooter at `x = 1.428` |
| Free-throw line to hoop centre (horiz.) | — | 4.191 m (13 ft 9 in) |
| Ball radius | `R_BALL` | 0.1197 m (size 7, 0.7515 m circumference) |
| Ball mass | `M_BALL` | 0.6237 kg (22 oz) |
| Gravity | `g` | 9.80665 m/s² |
| Default release height | — | 2.10 m (adjustable 1.5–2.6) |

Derived collider positions: hoop centre `x_h = 5.619`; front rim node centre
`x_h - (R_RIM + r_tube) = 5.3809`; back rim node centre `x_h + (R_RIM + r_tube) = 5.8571`.

Sanity check: the regulation 6 in (0.1524 m) gap falls out of these numbers — measured from the
backboard face to the ring's **inner** edge (`BOARD_X - (x_h + R_RIM)`), which is the convention
that pairs with the hoop centre being 15 in from the board: 6 + 9 = 15. Measured to the outer edge
of the tube instead it is 0.1334 m, and getting those two confused is exactly the sort of thing
this check exists to catch. `tests/collide.spec.ts` asserts both forms.

Reality anchor: a typical human free throw releases at ≈7.0–7.5 m/s, ≈50–55°, from ≈2.1 m, with
≈2–3 rev/s of backspin. If the defaults don't score near those values, the geometry is wrong.

**Result:** the built sim puts the make window at 52° from 2.1 m at **7.160–7.300 m/s**, inside the
published human range with no tuning whatsoever. That agreement is the strongest evidence the
geometry table is right.

The default shot is **7.184 m/s**, the maximum-clearance *clean* make at that angle (2.1 cm from the
iron), so the first shot fired is a true swish rather than one that kisses the rim on its way
through. Clean makes are scarce from the line — see §12.

---

## 4. Architecture

Hard rule: **the sim core never touches the DOM, canvas, wall-clock time, or randomness.** It is a
pure function of `(state, inputs, dt)`. Rendering, input, and logging sit outside it. This is what
makes replay, headless tests, and a future batch-sweep harness possible at all.

```
src/
  core/
    units.ts         # branded types (Metres, Seconds, ...), vec2 helpers
    constants.ts     # the §3 table, single source of truth
    world.ts         # World: colliders[], gravity, wind field, materials
    colliders.ts     # Segment | Circle union + distance/sweep queries
    materials.ts     # MaterialId -> { restitution, friction, name }
    ball.ts          # BallState { p, v, theta, omega }
    integrate.ts     # fixed-step semi-implicit Euler + substepping
    forces.ts        # gravity, drag, Magnus (stretch), wind sampling
    collide.ts       # swept circle-vs-collider, impulse resolution
    scoring.ts       # shot outcome state machine
    sim.ts           # Simulation: step(), reset(), run(ShotDescriptor)
  log/
    events.ts        # LogEvent union, levels, categories
    logger.ts        # ring buffer, filters, subscribers
    format.ts        # text formatter + JSON/CSV export
  render/
    camera.ts        # world<->screen transform, letterboxing
    draw.ts          # court, backboard, rim, net, ball, shooter
    debug.ts         # velocity vectors, contact normals, trail, wireframes
  ui/
    controls.ts      # sliders / numeric inputs, keyboard, drag-to-aim
    logpanel.ts      # scrolling log view with category + level filters
    hud.ts           # live readouts: speed, apex, flight time, outcome
  levels/
    schema.ts        # Level JSON type + validator (stretch: editor)
    default.ts       # regulation free-throw court
  main.ts            # wiring: raf loop, accumulator
tests/
  physics.spec.ts    # analytic checks
  collide.spec.ts    # geometry + impulse cases
  golden.spec.ts     # trajectory regression snapshots
```

**Main loop**: `requestAnimationFrame` drives a fixed-timestep accumulator. Rendering interpolates
between the last two sim states, so visuals stay smooth at any refresh rate while physics stays
deterministic and frame-rate independent.

### 4.1 Determinism contract

Determinism is a stated requirement, so it gets enforced rather than hoped for. The core obeys all
of the following, and `tests/determinism.spec.ts` checks the ones that are checkable:

1. **No ambient inputs.** No `Date.now`, no `performance.now`, no `Math.random`, no DOM reads
   inside `core/`. The only inputs to a run are the `ShotDescriptor` and the `Level`.
2. **Fixed timestep.** `dt` is a constant; the substep count is derived only from the ball's own
   state, never from frame timing. Frame rate, tab backgrounding, and slow-motion all change how
   often `step()` is *called*, never what it computes.
3. **Ordered iteration.** Colliders are an array and their order is part of the level. Collisions
   resolve strictly by earliest time of impact, with ties broken by ascending collider index — so
   a ball hitting the rim and the backboard on the same substep always resolves in the same order.
   No iteration over object keys or `Set`/`Map` order anywhere in the core.
4. **Restricted float ops.** `+ - * /` and `sqrt` are bit-exact per IEEE 754 across engines;
   `sin`, `cos`, `pow`, `exp` are *not* guaranteed to be. The core therefore confines transcendental
   functions to one place: converting release angle to a direction vector, done once per shot
   outside the step loop. The resolved `v0` vector is recorded in the log alongside the angle, so a
   replay can be driven from the vector and bypass trig entirely. The step loop itself uses only
   the exact ops.
5. **Versioned physics.** `physicsVersion` is a constant bumped on any change to constants,
   integrator, or collision response. It is stamped into every `ShotDescriptor`, so a replay or a
   golden snapshot from an older version is flagged rather than silently reinterpreted.
6. **Replay equality test.** Running the same descriptor twice must produce byte-identical event
   streams and final states. Same-build exactness is asserted directly; cross-engine golden
   snapshots compare within a tight tolerance, since point 4 reduces but does not fully eliminate
   libm variance.

The payoffs are concrete: shots are shareable as URLs, the predicted-arc ghost is exactly the
trajectory the ball will fly, bugs are reproducible from a log, and the §12 sweep can cache results.

---

## 5. Physics model

### 5.1 State and integration

```ts
type BallState = {
  p: Vec2;       // centre position (m)
  v: Vec2;       // velocity (m/s)
  theta: number; // rotation (rad) — visual + spin bookkeeping
  omega: number; // angular velocity (rad/s), CCW positive
};
```

The ball is treated as a uniform **hollow** sphere for rotational inertia: `I = (2/3) m r²`. A
basketball is a shell, not a solid ball, and this materially changes how much spin a grazing rim
contact imparts — worth getting right from the start.

Integrator: semi-implicit (symplectic) Euler at a fixed `dt = 1/240 s`, with each step subdivided
further whenever `|v| * dt > 0.25 * R_BALL`, so the ball never advances more than a quarter radius
per substep. Chosen over RK4 because forces are near-constant (gravity dominates), the dominant
error source is collision handling rather than the smooth arc, and Euler's energy behaviour is
predictable. RK4 is held in reserve for if drag + Magnus ever make the smooth phase stiff.

Explicitly rejected: deriving `dt` from frame time. It is non-deterministic and it tunnels at low
FPS.

### 5.2 Forces

- **Gravity**, always: `a += (0, -g)`.
- **Drag** (stretch, flag-gated): `F = -½ ρ C_d A |v_rel| v_rel`, with `ρ = 1.225`, `C_d = 0.47`,
  `A = πR²`, `v_rel = v - v_wind(p)`. Terminal velocity for a basketball is ~20 m/s, so across a
  one-second free throw drag shaves a few percent off the range: visible, not dominant, and worth
  being able to switch off for A/B comparison.
- **Magnus** (stretch): `F = C_m ρ A R (ω × v_rel)`, which in 2D is a vector perpendicular to
  `v_rel` scaled by `ω`; `C_m ≈ 0.25`. Backspin lifts the ball and steepens its descent angle,
  which is the actual reason shooters use it — a nice thing to be able to demonstrate.
- **Wind** (stretch): `v_wind(p)` sampled from the world. Uniform field first, axis-aligned wind
  zones once the level editor exists.

### 5.3 Colliders

The world is a list of **static** colliders; nothing but the ball ever moves.

```ts
type Collider =
  | { kind: 'segment'; a: Vec2; b: Vec2; material: MaterialId }
  | { kind: 'circle';  c: Vec2; r: number; material: MaterialId };
```

The regulation level is: floor segment at `y = 0`; backboard as a vertical segment (two-sided —
shots that sail over the board must be able to come back off its rear face); and two rim circles.
Segment queries clamp the closest point to the segment, which gives capsule behaviour and correct
rounded-endpoint response for free, so the ball rolls off the backboard's lip instead of catching
an infinitely sharp corner.

### 5.4 Collision detection

Per substep, for each collider: compute the closest point and signed distance from the ball centre,
then run a **swept test** — treat the motion as a segment and solve for the earliest time of impact
`t ∈ [0, dt]` at which the distance equals `R_BALL`. Take the minimum TOI across all colliders,
advance to it, resolve, and continue with the remaining substep time. Cap at 4 resolutions per
substep, then just depenetrate and move on — a ball wedged between rim and backboard is a
legitimate physical outcome, not a bug to be solved with more iterations.

The swept approach is non-negotiable for the rim: the rim nodes are ~1 cm in radius and the ball
can be travelling 10 m/s. Discrete overlap checks would miss them outright.

### 5.5 Collision response

Given a contact normal `n` (unit, pointing from surface toward the ball centre), contact point
`q = p - R n`, and material `(e, μ)`:

1. **Depenetrate**: `p += (R - d) n`, plus a ~1e-5 skin so the same contact doesn't retrigger.
2. **Contact-point velocity**: `v_c = v + ω × (q - p)`; split into `v_n = (v_c·n) n` and
   `v_t = v_c - v_n`.
3. **Normal impulse**: `j_n = -(1 + e)(v_c·n) m`, applied only when `v_c·n < 0` (approaching).
4. **Tangential impulse (Coulomb)**: the impulse that would kill sliding is `-m |v_t|`, clamped to
   `μ |j_n|`. Apply it to both `v` and `ω` (torque `= r × j_t / I`). This is where spin is born,
   and where backspin visibly kills forward velocity on a rim hit.
5. **Restitution floor**: if `|v_c·n| < 0.25 m/s`, force `e = 0` for that contact. Without this, a
   settling ball micro-bounces indefinitely.
6. **Log it**: emit a `collision` event carrying collider id, material, normal, incoming and
   outgoing velocity, both impulse magnitudes, ΔE, and whether restitution was floored.

The floor stops the bouncing but not the *events*: gravity re-accelerates a resting ball into the
floor every step, so it still produces a fresh contact every step — one shot in the golden set
racked up 453 of them. Those are one continuous resting contact, not 453 impacts, so a
restitution-floored contact is resolved physically but is **not logged individually and does not
count toward the outcome classification**. The shot summary reports the resting-contact count
separately.

Energy must be non-increasing across any contact; `collide.spec.ts` asserts that over randomized
inputs.

### 5.6 Materials

```ts
const MATERIALS = {
  hardwood: { e: 0.77, mu: 0.45, name: 'Hardwood floor' },
  glass:    { e: 0.78, mu: 0.20, name: 'Tempered glass backboard' },
  steel:    { e: 0.72, mu: 0.35, name: 'Steel rim' },
  padding:  { e: 0.35, mu: 0.70, name: 'Padded obstacle' },
  rubber:   { e: 0.90, mu: 0.80, name: 'Rubber' },
};
```

`e = 0.77` on hardwood is anchored to the regulation ball-inflation drop test, whose measurement
conventions are asymmetric and materially change the answer:

> Dropped from 1.80 m measured to the **bottom** of the ball, it must rebound to between 1.20 m
> and 1.40 m measured to the **top** of the ball.

The centre therefore falls 1.80 m and rises between `1.20 - 2R` and `1.40 - 2R`, i.e. 0.961 m to
1.161 m, so `e = sqrt(rise/fall)` lies between **0.731 and 0.803**. An earlier draft of this
document read both heights under the same convention and got 0.82–0.87, which is too lively by
about 9% — a ball that bounces noticeably higher than a real one. Writing the test was what
surfaced it, which is the whole argument for anchoring to an external spec instead of to our own
output. `tests/physics.spec.ts` asserts the implied range and a simulated rebound inside the
regulation window.

Glass sits a touch above hardwood (0.78 vs 0.77) because a sprung hardwood court absorbs more than
a rigid glass pane.

**Decision: these stay at measured/published values.** We are not tuning them backwards from
real-world make rates, which also means no release-variance model in v1 (see §1 non-goals). Two
consequences worth being aware of up front:

- Whatever make rate falls out of the physics is the answer, and it will be far above a human's
  because a deterministic sim has no release error. That is correct behaviour here, not a bug.
- The rim value (`e = 0.72`) is the least defensible number in the table and it is the single
  biggest determinant of whether a near-miss rattles in or out. We keep it measured, but the
  runtime `e`/`μ` sliders stay a debug control (§7) so its sensitivity can be *explored* without
  changing the shipped defaults. If a future request is "make it feel right," that is a deliberate
  decision to revisit, and it belongs with the variance model rather than alone.

### 5.7 Rest and termination

A shot ends when any of these holds: the ball is at rest (`|v| < 0.05` while in contact, sustained
for 0.5 s of sim time); the ball leaves the world AABB; or 15 s of sim time elapse. On termination,
emit a `result` summary event.

---

## 6. Shot outcome detection

State machine, evaluated every substep:

```
Idle -> (release) -> InFlight -> ... -> Resolved { outcome, contacts[] }
```

Scoring test: the ball's centre crosses the scoring plane `y = RIM_Y` moving **downward**, while
`x` lies strictly between the rim's inner edges (`x_h ± R_RIM`). The ball fits with room to spare
(0.239 m through a 0.457 m hoop). Crossing the plane *upward* must not count and must not latch.

Outcomes, in roughly increasing order of interest:

- `swish` — scored with zero contacts.
- `bank` — scored, backboard contacted.
- `rattle` — scored, at least one rim contact.
- `miss_short` / `miss_long` — never crossed the plane; classified by whether the closest approach
  to the hoop centre was in front of or behind it.
- `rim_out` — entered the hoop region but came back up and out after rim contact.
- `airball` — never came within 0.5 m of the hoop.
- `stuck` — came to rest wedged on the rim or between rim and board.

Recorded per shot alongside the outcome: apex height, time of flight, release-to-first-contact
time, **entry angle** at the scoring plane, and clearance over the front rim.

**The classification inputs freeze the moment the outcome is certain.** This is not a detail — it
is what keeps the outcome map honest. An interactive run keeps simulating past the verdict (watching
the ball drop through the net and clatter around) while a swept run stops dead, so anything recorded
in that tail would make the two disagree. The early-abort agreement test caught precisely this: a
shot that dropped in cleanly off the board and *then* rattled the rim on its way down was reported
as `bank` by one run and `rattle` by the other. The outcome describes how the ball went in, so only
contacts made on the way in count.

**What counts as "on the way in" is the ball being at the hoop, not the plane crossing.** The
snapshot closes once the ball has fallen clear of the rim — far enough below the tube centres that
no further rim contact is geometrically possible. Closing it at the scoring plane instead was wrong:
a ball can cross the plane and *then* clip the back of the rim from inside on its way down, a
contact that lands a step or two later. That recorded the default free throw as a clean swish with a
rim contact attached to it — self-contradictory, and invisible until cells were coloured by whether
the rim was touched, at which point a ball that audibly clanks the iron would have been painted as a
clean make. Several shots in the golden set reclassified from `swish` to `rattle` when this was
fixed, which is correct.

"Certain" has a rigorous test rather than a heuristic one: the ball can never reach rim height again
once `y + R + |v|²/2g < rimY`, because `|v|²/2g` is the highest it could rise if *all* of its
kinetic energy became height, which no bounce or drag can exceed. Requiring it to also be more than
0.5 m below the rim freezes the miss classification too, since a ball that far below rim height is
always more than 0.5 m from the hoop centre. An aborted run and a full run therefore always agree —
asserted over 150 randomised shots in `tests/determinism.spec.ts`.

---

## 7. Controls and UI

Layout: the canvas fills the window, a right-hand panel holds the controls, a bottom drawer holds
the log and the outcome table.

**The controls panel is hidden by default**, with a single `⚙ Controls` button at the top-right of
the court as the only chrome over it (opposite the HUD, which sits top-left). The button toggles it,
the panel carries its own `✕`, and `M` does the same from the keyboard. Two details this needs:

- Hiding the panel with `display: none` is not enough on its own. Grid columns are declared on the
  container, so the 320px track would still reserve its space and leave a dead strip beside the
  court; the open state is a class on `#app` that adds the column.
- The canvas re-fits on toggle, because the court's width changes. That is also why the panel
  appears instantly rather than sliding: an animated width would need the canvas re-fitted on every
  frame of the transition, for no real gain.

The state is deliberately not persisted — "hidden by default" should mean on every load, not only
the first one.

**Shot controls** — each a slider plus a numeric field, with its real unit displayed:

| Control | Range | Default |
|---|---|---|
| Shooter x | 0.5 – 5.0 m | 1.428 (free-throw line) |
| Release height | 1.5 – 2.6 m | 2.10 |
| Release angle | 0 – 89° | 52 |
| Release force / speed | 0 – 15 m/s | 7.23 |

Release spin is **not** a v1 control (§1 stretch). `ω` still exists in the state and is still
produced by contact friction; it just starts every shot at 0 and has no slider. The HUD shows it
as a readout so rim-induced spin is visible.

"Force" is presented to the user as a 0–100% power bar mapping linearly to release speed
`v0 = 15 * pct`. Internally it is an instantaneous impulse `J = m * v0` applied at release, and the
log records both numbers so the mapping is never a mystery. A true force-over-time release model
would add nothing observable, since the hand-contact phase isn't simulated.

**Interaction**: arrow keys nudge angle and power, Space releases, R resets, and dragging from the
shooter sets angle (drag direction) and power (drag length) — by far the fastest way to explore the
space. A `?` overlay lists the keys.

**Shooter and net rendering** (both decided, both deliberately minimal):

- The shooter is a **static stick figure** drawn at the shooter's x-position, scaled so its hands
  land at the release height — so moving the release-height slider visibly raises the arms' end
  point without any animation system. No shooting motion, no pose interpolation. The ball spawns at
  the release point and the figure never changes.
- The net is **cosmetic**: a short fan of lines hanging from the rim nodes, drawn behind the ball.
  It has no collider and does not appear in the world's collider list, so it cannot affect physics
  or the log. Modeling it as a drag region stays a stretch goal (§1).

**Debug toggles**: trajectory trail; predicted-arc ghost (runs the sim headless from the current
parameters and draws the result — essentially free, because the core is pure); collider wireframes;
contact normals; velocity vector; live per-material `e`/`μ` sliders; drag and Magnus on/off;
slow-motion (0.1×–1×) and single-step.

---

## 8. Logging

Verbose logging is a first-class feature here, not `console.log` sprinkled around.

```ts
type LogEvent = { t: number; tick: number; level: Level } & (
  | { cat: 'input';     kind: 'param_change'; param: string; from: number; to: number }
  | { cat: 'release';   shot: ShotDescriptor }
  | { cat: 'step';      p: Vec2; v: Vec2; omega: number; forces: Record<string, Vec2> }
  | { cat: 'collision'; collider: string; material: MaterialId; n: Vec2; q: Vec2;
                        vIn: Vec2; vOut: Vec2; jN: number; jT: number;
                        dE: number; restitutionFloored: boolean }
  | { cat: 'scoring';   kind: 'plane_cross' | 'near_miss'; x: number; vy: number }
  | { cat: 'result';    outcome: Outcome; summary: ShotSummary }
  | { cat: 'system';    msg: string }
);
```

- Levels: `trace | debug | info | warn`. `step` events are `trace` and **sampled** (default every
  12th substep, i.e. 20 Hz) because 240 Hz over 15 s is ~3600 full-state records per shot. The
  sampling rate is a setting; collisions are never sampled out.
- Storage: an in-memory ring buffer of 50k events. The panel renders a windowed view with
  category/level filters plus text search.
- **A `NullLogger` must be a real zero-cost option**: when logging is off, the core allocates no
  event objects at all (guard at the call site, not inside the logger — an allocated-then-discarded
  object per substep would dominate the §12 sweep's runtime). The sweep runs with the null logger;
  the interactive sim runs with the real one.
- Text format, column-aligned for scanning:
  `[  1.284s t=308] COLLISION rim_front  steel   n=(-0.62,+0.78)  |v| 6.41->4.58 m/s  jN=6.85 jT=1.21  dE=-3.7 J`
- Export: JSON (full fidelity, including the `ShotDescriptor` for replay) and CSV (one row per
  sampled step, for plotting elsewhere).
- `ShotDescriptor = { shooterX, releaseY, angleDeg, speed, omega, wind, levelId, physicsFlags,
  physicsVersion }` — everything needed to reproduce a run exactly. Encode it in the URL hash so a
  specific shot can be shared as a link.

---

## 9. Levels (and the stretch editor)

v1 ships a single hardcoded regulation level, but expresses it in the level format from day one so
the editor is additive rather than a refactor:

```ts
type Level = {
  version: 1;
  name: string;
  bounds: { min: Vec2; max: Vec2 };
  goal: { boardX: number; rimY: number };   // the goal can move
  colliders: Collider[];                     // floor, board, rim, obstacles
  wind?: { kind: 'uniform'; v: Vec2 }
       | { kind: 'zones'; zones: { aabb: AABB; v: Vec2 }[] };
  shooter: { x: number; releaseY: number };
};
```

Editor (stretch): click-drag to place segment and circle obstacles, choose material from a palette,
drag the goal, draw wind zones, save/load JSON to localStorage and to file. Deliberately
unglamorous — the schema and the pure core do the real work.

---

## 10. Testing

- **Analytic**: with drag off, a released ball matches the closed-form parabola (range, apex, time
  of flight) to within integrator tolerance. Validates the integrator and the units.
- **Bounce**: the regulation drop test, with its asymmetric conventions (§5.6) — dropped from
  1.80 m to the ball's bottom, the rebound measured to the ball's top must land inside 1.20–1.40 m.
  Checks the model against the rule book, not against itself.
- **Collision invariants**: randomized incoming velocities and normals ⇒ energy non-increasing, no
  residual penetration after resolve, tangential impulse always inside the friction cone.
- **Tunneling**: a ball fired at 40 m/s directly at a rim node still registers contact.
- **Scoring logic**: hand-built trajectories for each outcome class, including the
  upward-through-the-hoop case (must not score) and a grazing front-rim edge case.
- **Golden trajectories**: a dozen `ShotDescriptor`s snapshotted to known outcomes and final
  positions, to catch unintended physics drift. `physicsVersion` is bumped when a change is
  intentional, forcing an explicit rebaseline.

---

## 11. Milestones

| # | Deliverable | Status |
|---|---|---|
| M0 | Vite + TS skeleton, canvas, camera, court drawn to scale | **done** |
| M1 | Gravity + fixed-step integrator + floor bounce | **done** |
| M2 | Full collider set with swept detection and impulse response | **done** |
| M3 | Controls + HUD + release model | **done** |
| M4 | Logging subsystem, log panel, export, replay-by-descriptor | **done** |
| M5 | Scoring state machine, outcome classification, shot stats | **done** |
| M6 | Tests from §10, including determinism and replay-equality checks | **done** (48 tests) |
| M7 | Outcome **table**: worker sweep, table panel, clearance column, click-to-load, CSV/JSON export (§12) | **done** |
| M7b | Heatmap view over the same sweep | optional |
| S1 | Drag + wind + Magnus + release-spin slider, material table in UI | partial: drag and Magnus are implemented behind default-off flags with UI toggles; wind has a World field but no UI; release-spin slider deliberately absent |
| S2 | Level format + editor + obstacles | format done, editor outstanding |

M0–M2 was where the real risk lived (swept collision against a 1 cm rim). M7 depends on M5's
outcome classification and the null logger from §8, and on nothing else.

**What the physics produced, once built.** Two results worth recording, neither of which was
tuned for:

- The make window at 52° spans 7.160–7.300 m/s — inside the published human release range (§3).
- The window **widens monotonically with launch angle**: 0.085 m/s at 45°, 0.140 at 52°, 0.190 at
  60°. "High-arc shots are more forgiving" is not a coaching platitude here, it is a measurement
  that fell out of regulation geometry and measured restitution. This is the effect §12's map is
  meant to make visible, and it is already there in the numbers.

---

## 12. Outcome table (batch sweep)

**Built as a table rather than a heatmap**, at the client's request: power down the side, release
angle across the top, and two numbers in every cell — a binary `1`/`0` for basket/miss, and the
**rim clearance** in centimetres. Colour shading is kept as a background hint, but the numbers are
the deliverable, and every view exports to CSV.

### Rim clearance

Defined as: the shortest distance from the **ball's surface** to the **nearest rim tube's surface**,
over the whole flight. Properties that make it readable:

- **Geometric ceiling of 10.89 cm** (`R_RIM - R_BALL`), reached by a ball falling dead centre
  through the hoop. So for a made shot the number runs 0 → 10.9 and is a direct measure of how good
  the make was.
- **Zero means it hit the iron.** Swept collision resolution means the ball never interpenetrates,
  so clearance bottoms out at 0 rather than going negative. The cell prints `hit` instead of `0.0`
  so the reading is never ambiguous, and `rim_contacts` is in the export for the same reason.
- **Measured against the swept path, not step endpoints.** The ball covers ~1.7 cm per step near the
  rim, so endpoint sampling would inflate a 3 cm clearance by up to half a step — a large fraction
  of the quantity being reported. Clearances use point-to-segment distance against each step's
  travel, which is exact for piecewise-linear motion.
- **Clamped to 0 on a recorded rim contact.** This is not redundant with the above: a collision
  *bends* the path mid-step, so the straight chord from step start to step end passes farther from
  the tube than the ball actually did. Without the clamp a shot that demonstrably struck the rim
  reported 3.7 mm of clearance, contradicting its own contact count.
- **Frozen at the same moment in every run mode** (§6), so a table cell reports exactly what the
  HUD reports after firing that same shot. Asserted bitwise over 60 randomised shots.

Known property, not a defect: through the interesting part of the band most shots graze the rim, so
at coarse resolution the clearance column fills with `hit`. That is a true fact about free throws —
the hoop is 45.7 cm, the ball 23.9 cm, so the clean gap is 21.8 cm and ±11 cm of arrival error
touches iron. The default speed step is 0.02 m/s (≈3 cm of arrival shift) so the first table shows
the gradient rather than a wall of zeros. If a continuous measure is wanted *through* the strikes,
the option is to measure against the collision-free trajectory instead, giving a signed number
(negative = how deep into the tube the undisturbed arc would have passed). That is a different
quantity and a second simulation per cell; not built, and noted here as an open choice.

### Colour coding

To the client's specification. The five categories are a total partition of every possible cell:

| Colour | Cell |
|---|---|
| **black** | missed without touching the rim (the airball, and any other no-contact miss) |
| **gray** | hit the rim but did not score |
| **blue** | hit the rim and scored after bouncing **up** off it |
| **orange** | hit the rim and scored, deflected **down** off it |
| **red → magenta** | scored without touching the rim, interpolated by clearance |

The categories live in `sweep/grid.ts` (a fact about the shot), the colours in `ui/colors.ts` (a
presentation choice), and the long CSV carries the category so a spreadsheet can reproduce the
shading.

Four points where the spec needed a decision:

- **"Hit the rim" means hit it at the hoop**, i.e. `rimContactsInbound`, not any contact in the
  flight. A ball that bounces off the floor and back up into the iron has not changed how the shot
  went in. This forced the §6 fix below.
- **Blue vs. orange is the direction off the *last* rim contact at the hoop**, since that is the
  contact that sent the ball in. It is read from the ball's vertical velocity immediately after the
  impulse, which the tracker now receives from the collision result.
- **Misses that never touched the rim but are not strictly airballs** — a brick off the backboard,
  or a near miss that passed close without contact — are not covered by the spec's wording. They
  take black, so black reads as "missed, never touched the rim". Easy to split out if wanted.
- **The ramp is normalised to the table's own largest clean-make clearance**, not to the 10.89 cm
  geometric ceiling, and the legend prints the cm range. The ceiling assumes a ball dropping
  vertically through the hoop; a free throw arrives at roughly a 40° entry angle and threads it
  diagonally, so real clean makes from the line top out near **2 cm at 52°** and **4 cm at 56°** —
  under a fifth of the ceiling. Scaled to the ceiling, every realistic table would be shades of red
  with magenta never reached and the gradient carrying almost no information. Normalising spends the
  whole ramp on the range present. The trade is that colours are comparable within a table but not
  between tables, which is why the numbers are printed in the cells and the range in the legend.

Clean makes are scarcer than they look, for the same entry-angle reason: at 52° only about 40 of
600 sampled speeds between 6.8 and 8.0 m/s avoid the iron entirely. Most makes from the free-throw
line touch the rim, so blue and orange dominate the made region and red/magenta marks the genuinely
clean ones.

### Heatmap view

Still worth having eventually, and cheap now that the sweep exists: angle on the x-axis, power on
the y-axis, one colour per outcome class from §6.

The expected picture is the interesting part. The set of (angle, power) pairs that score is a thin
curved **band**, because for most angles there is exactly one power that drops the ball through the
hoop. The band widens where the entry angle is steepest — that is the "soft touch" region shooters
actually aim for — and pinches to nothing at the low-arc end where the ball must thread the gap
between front rim and backboard. Seeing that band's width vary across the map is a far better
explanation of why high-arc shots are more forgiving than any paragraph about entry angles.

**No probability layer.** Every cell is a hard make/miss produced by an exact run — the map shows
what the physics does, nothing more. A Gaussian release-error convolution was considered and
**cut**: it would have introduced a notion of shooter imprecision that nothing else in the sim has,
and the project is committed to being deterministic end to end. The band's *width* already conveys
how forgiving a region is, without inventing a variance parameter to tune.

**Performance.** A naive sweep is expensive: 15 s of sim at 240 Hz is ~3600 steps, so a 200×200
grid is 40k shots and ~144M steps. Of the four mitigations below, (1) and (2) are implemented and
(3) is implemented as a single worker — measured at ~0.25 ms per shot, so the 671-cell default table
completes in well under a second and a 10k-cell table in ~2.5 s. A worker *pool* and (4) are not
built, and are not needed until the grid grows past ~20k cells:

1. **Early abort.** The sweep doesn't need rest states, only outcomes. Stop as soon as the outcome
   is decided — plane crossed, or the ball has descended past rim height beyond any chance of
   recovery. Most shots resolve in well under 2 s, cutting average steps by ~5×.
2. **Null logger** (§8). No event allocation on the hot path.
3. **Worker pool.** `navigator.hardwareConcurrency` workers, each handed a row band. The core is
   pure and dependency-free, so it loads into a worker unchanged — this is the payoff for the §4
   architecture rule.
4. **Progressive refinement.** Render a coarse grid (50×50) immediately, then subdivide only cells
   adjacent to an outcome boundary. The map appears instantly and sharpens; most of the interior is
   uniform and never needs refining.

**UI.** A tab in the bottom drawer alongside the log. Six range controls (angle and speed: from, to,
step), a live cell count that warns above 6000, a progress readout, and cancel. Clicking any cell
loads that shot into the controls and fires it, so the table doubles as a shot browser — and since
both come from the same core, the court always does exactly what the cell says. The table is
generated on demand rather than recomputed on every parameter change, because a sweep is a
deliberate act, not a side effect of nudging a slider.

Exports: long CSV (one row per cell — for plotting), make-matrix CSV and clearance-matrix CSV (for
pasting into a spreadsheet), and JSON (everything, including the spec and `physicsVersion`).

---

## 13. Decisions log

Resolved 2026-10-11, in response to the §12 questions from the first draft:

| # | Question | Decision |
|---|---|---|
| 1 | Language | **TypeScript**, browser. §2 is now a decision, not a proposal. |
| 2 | Fidelity vs. feel | **Measured material values.** No tuning to make rates, no variance model in v1 (§5.6). |
| 3 | Shooter | **Static stick figure** at the release point. No animation (§7). |
| 4 | Net | **Cosmetic only.** No collider (§7). |
| 5 | Batch analysis | **In scope** as M7 (§12). |
| 6 | Spin | **No user control in v1.** `ω` is plumbed through the core anyway; slider deferred to S1. |
| 7 | Audience | Single stakeholder, directed work. See below. |
| — | Determinism | Confirmed as a hard requirement; promoted to a goal with an enforced contract (§4.1). |
| — | 3D | Possible future request. Free hedges only (§14); no v1 compromises. |
| — | Make-probability overlay | **Cut** (§12). The outcome map stays, but stays a hard make/miss. No variance parameter anywhere in the project. |

### Corrections the build forced on this document

Recorded rather than silently applied, because each one changes a number someone might otherwise
trust from an earlier read:

| What | Was | Now | Why |
|---|---|---|---|
| `hardwood.e` | 0.84 | **0.77** | The drop-test anchor was derived by reading the spec's drop and rebound heights under the same measurement convention. They are asymmetric (bottom of ball vs. top of ball), and correcting that drops the implied range to 0.731–0.803 (§5.6). |
| Rim-gap sanity check | gap to the tube's outer edge | gap to the ring's **inner** edge | Only the inner-edge reading gives the regulation 6 in, and it is the one consistent with a 15 in hoop-centre offset (§3). |
| Default release speed | 7.3 m/s | **7.23 m/s** | 7.3 clips the back rim. 7.23 is the midpoint of the simulated make window, so the first shot fired goes in (§3). |
| Resting contacts | counted and logged like impacts | counted separately, never logged individually | A ball sitting on the floor generated 453 "contacts" in one golden shot (§5.5). |
| Classification inputs | read live at resolve time | frozen when the outcome becomes certain | Otherwise a swept run and an interactive run disagree on shots that rattle *after* dropping in (§6). |
| `server.watch` | default | `usePolling: true` | Windows Vite cannot `fs.watch` the repo over `\\wsl.localhost` — it dies with EISDIR. See README. |
| Rim clearance | front rim only, sampled at step endpoints, frozen at the scoring instant | nearest of both tubes, measured against the swept path, frozen after the ball passes the rim, clamped to 0 on contact | Promoting clearance to a reported client-facing number exposed three separate ways the old stat was wrong — each worth a few millimetres to centimetres on a quantity that tops out at 10.9 cm (§12). |
| M7 output | heatmap | table of 1/0 + clearance, with a heatmap as an optional follow-up | Client asked for a table. |
| "On the way in" window | closed at the scoring plane | closes when the ball falls clear of the rim | A ball can cross the plane and then clip the back of the rim from inside. The old window called that a clean swish with a rim contact attached (§6). |
| Default release speed | 7.23 m/s | **7.184 m/s** | 7.23 is a make but kisses the rim; 7.184 is the maximum-clearance clean make at 52°, so the first shot fired is a true swish (§3). |
| Clearance ramp scale | 10.89 cm geometric ceiling | the table's own largest clean-make clearance | A free throw enters at ~40°, so real clean makes reach only ~2 cm. Against the ceiling the gradient would never leave the reds (§12). |

On (7): the work is directed by one person, which sets two priorities. **Changeability over
polish** — expect revisions to defaults, geometry, and feel, so constants live in one table (§3),
materials in one table (§5.6), and the level in one schema (§9); none of those should ever require
touching physics code to adjust. And **legibility** — the verbose log and the outcome map are how
someone else confirms the sim is doing the right thing, which makes them core deliverables rather
than nice-to-haves. This log gets appended to as decisions change, so the reasoning behind a
default is never lost.

---

## 14. If 3D happens later

A 3D version may be requested. We are **not** building for it: no abstraction that costs 2D clarity
goes in now. But a few habits are free, so we take them.

**Free hedges (adopt now):**

- All vector arithmetic goes through `core/units.ts` with a narrow API (`add`, `scale`, `dot`,
  `len`, `cross`). No `.x`/`.y` arithmetic scattered through `collide.ts` or `forces.ts` — a Vec3
  swap should be mechanical in those files rather than a rewrite.
- 2D cross-product returns a scalar; keep it behind the `cross()` function instead of inlining
  `ax*by - ay*bx` at call sites, so the 3D version can return a vector.
- `type AngVel = number` as an alias rather than bare `number` wherever angular velocity is stored
  or passed. In 3D it becomes `Vec3`; the call sites don't change.
- Keep the §3 constants in SI and regulation-derived. They are identical in 3D.
- Keep the `Level` schema versioned (§9); a 3D level is simply `version: 2`.
- Keep the sim core pure and renderer-agnostic (§4). This is already the plan and is the single
  biggest thing that makes a 3D port feasible.

**Genuine costs of a 3D port, deliberately not pre-paid:**

- Colliders change shape: the rim becomes a torus, the backboard a rectangle, the floor a plane.
  Swept sphere-vs-torus is meaningfully harder than sphere-vs-circle.
- Scoring becomes a disc test rather than an interval test, and off-axis misses become possible —
  which is most of what makes 3D shooting feel different.
- The renderer is a full rewrite (and probably the reason to adopt WebGL/Three.js at that point).
- Controls gain an azimuth axis, and the outcome map gains a dimension.

If the request comes, this doc gets a sibling rather than a rewrite.
