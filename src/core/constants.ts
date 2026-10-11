/**
 * Single source of truth for world geometry and ball properties (DESIGN.md §3).
 *
 * SI units throughout: metres, seconds, kilograms, radians. y is up, x increases to the right, the
 * origin sits on the floor line. The shooter is on the left, the goal on the right.
 *
 * Nothing in this file should ever need to be changed to adjust gameplay feel except by deliberate
 * decision — these are regulation values, and the derived positions below are computed from them so
 * that an edit to one number stays consistent everywhere.
 */

/** Bumped on ANY change to constants, integrator, or collision response (DESIGN.md §4.1 rule 5). */
export const PHYSICS_VERSION = 1;

// ---------------------------------------------------------------------------------------------
// Ball (men's size 7)
// ---------------------------------------------------------------------------------------------

/** 0.7515 m circumference / (2*pi). */
export const R_BALL = 0.1197;
/** 22 oz. */
export const M_BALL = 0.6237;
/**
 * A basketball is a thin shell, not a solid sphere, so I = (2/3)mr^2 rather than (2/5)mr^2
 * (DESIGN.md §5.1). This changes how much spin a grazing rim contact imparts.
 */
export const I_BALL = (2 / 3) * M_BALL * R_BALL * R_BALL;

// ---------------------------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------------------------

export const G = 9.80665;

/** Where we choose to put the backboard face in world space. Everything else derives from it. */
export const BOARD_X = 6.0;
/** 9 ft 6 in to 13 ft. */
export const BOARD_BOTTOM_Y = 2.896;
export const BOARD_TOP_Y = 3.962;

/** Top of the rim: 10 ft. */
export const RIM_Y = 3.048;
/** Inner radius: half of an 18 in inner diameter. */
export const R_RIM = 0.2286;
/** Rim tube is 5/8 in diameter steel. */
export const RIM_TUBE_R = 0.0095;
/** Hoop centre sits 15 in out from the backboard face, i.e. to the LEFT of it. */
export const HOOP_FROM_BOARD = 0.381;

/** Free-throw line: 15 ft from the backboard face. */
export const FT_LINE_FROM_BOARD = 4.572;

// ---------------------------------------------------------------------------------------------
// Derived positions
// ---------------------------------------------------------------------------------------------

/** 5.619 */
export const HOOP_X = BOARD_X - HOOP_FROM_BOARD;

/** Rim node centres, i.e. the centres of the two circle colliders. 5.3809 and 5.8571. */
export const FRONT_RIM_X = HOOP_X - (R_RIM + RIM_TUBE_R);
export const BACK_RIM_X = HOOP_X + (R_RIM + RIM_TUBE_R);

/** Inner edges of the hoop — the scoring gate (DESIGN.md §6). 5.3904 and 5.8476. */
export const HOOP_LEFT_EDGE = HOOP_X - R_RIM;
export const HOOP_RIGHT_EDGE = HOOP_X + R_RIM;

/** 1.428 — the free-throw line in world x. */
export const FT_LINE_X = BOARD_X - FT_LINE_FROM_BOARD;

/**
 * Sanity check from DESIGN.md §3: the gap between the back of the rim and the backboard must come
 * out at the regulation 6 in (0.1524 m). If this fails, a constant above is inconsistent.
 */
export const RIM_TO_BOARD_GAP = BOARD_X - (BACK_RIM_X + RIM_TUBE_R);

// ---------------------------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------------------------

/** Fixed timestep. Never derived from frame time (DESIGN.md §4.1 rule 2). */
export const DT = 1 / 240;

/** Substep so the ball never advances more than a quarter radius at a time (DESIGN.md §5.1). */
export const MAX_STEP_TRAVEL = 0.25 * R_BALL;
export const MAX_SUBSTEPS = 64;

/** Collision resolutions permitted per substep before we give up and just move (DESIGN.md §5.4). */
export const MAX_CONTACTS_PER_SUBSTEP = 4;

/** Pushed out this far past the surface after a resolve, so the same contact cannot retrigger. */
export const CONTACT_SKIN = 1e-5;

/** Below this approach speed, restitution is forced to 0 to stop micro-bouncing (DESIGN.md §5.5). */
export const RESTITUTION_FLOOR_SPEED = 0.25;

/** Rest detection (DESIGN.md §5.7). */
export const REST_SPEED = 0.05;
export const REST_DURATION = 0.5;
/** Hard cap on a single shot. */
export const MAX_SHOT_TIME = 15.0;

// ---------------------------------------------------------------------------------------------
// Air (stretch: only used when physics flags enable drag/Magnus — DESIGN.md §5.2)
// ---------------------------------------------------------------------------------------------

export const AIR_DENSITY = 1.225;
export const DRAG_COEFF = 0.47;
export const BALL_AREA = Math.PI * R_BALL * R_BALL;
export const MAGNUS_COEFF = 0.25;

// ---------------------------------------------------------------------------------------------
// Shot defaults (DESIGN.md §7). A real human free throw: ~7.3 m/s at ~52 deg from ~2.1 m.
// ---------------------------------------------------------------------------------------------

export const DEFAULT_RELEASE_Y = 2.1;
export const DEFAULT_ANGLE_DEG = 52;
/**
 * Mid-point of the contiguous make window at 52 deg from 2.1 m, which the sim puts at
 * 7.160-7.300 m/s. So the app's first shot is a swish rather than a back-rim clang.
 *
 * This is also the geometry's reality check: published human free-throw release speeds are
 * ~7.0-7.5 m/s at 50-55 deg, and the sim's window sits inside that with no tuning at all.
 */
export const DEFAULT_SPEED = 7.23;
export const MAX_SPEED = 15;

export const SHOOTER_X_MIN = 0.5;
export const SHOOTER_X_MAX = 5.0;
export const RELEASE_Y_MIN = 1.5;
export const RELEASE_Y_MAX = 2.6;
