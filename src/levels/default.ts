/**
 * The regulation free-throw court (DESIGN.md §3, §9).
 *
 * Collider order is meaningful — it is the collision tie-break — so it is written explicitly here
 * rather than assembled by a loop: floor, backboard, front rim, back rim.
 *
 * The rim node centres sit at `RIM_Y - RIM_TUBE_R`, because 10 ft is measured to the TOP of the
 * ring, not to its centreline.
 */

import type { Collider } from '../core/colliders.js';
import { COLLIDER_IDS } from '../core/colliders.js';
import {
  BACK_RIM_X,
  BOARD_BOTTOM_Y,
  BOARD_TOP_Y,
  BOARD_X,
  DEFAULT_RELEASE_Y,
  FRONT_RIM_X,
  FT_LINE_X,
  RIM_TUBE_R,
  RIM_Y,
} from '../core/constants.js';
import { v2 } from '../core/units.js';
import type { Level } from './schema.js';

const RIM_CENTRE_Y = RIM_Y - RIM_TUBE_R;

const colliders: readonly Collider[] = [
  {
    kind: 'segment',
    id: COLLIDER_IDS.floor,
    a: v2(-2, 0),
    b: v2(12, 0),
    material: 'hardwood',
  },
  {
    // Two-sided on purpose: a shot that sails over the top must be able to come back off the rear
    // face (DESIGN.md §5.3).
    kind: 'segment',
    id: COLLIDER_IDS.board,
    a: v2(BOARD_X, BOARD_BOTTOM_Y),
    b: v2(BOARD_X, BOARD_TOP_Y),
    material: 'glass',
  },
  {
    kind: 'circle',
    id: COLLIDER_IDS.rimFront,
    c: v2(FRONT_RIM_X, RIM_CENTRE_Y),
    r: RIM_TUBE_R,
    material: 'steel',
  },
  {
    kind: 'circle',
    id: COLLIDER_IDS.rimBack,
    c: v2(BACK_RIM_X, RIM_CENTRE_Y),
    r: RIM_TUBE_R,
    material: 'steel',
  },
];

export const REGULATION_LEVEL: Level = {
  version: 1,
  id: 'regulation',
  name: 'Regulation free throw',
  bounds: { min: v2(-2, 0), max: v2(12, 12) },
  goal: { boardX: BOARD_X, rimY: RIM_Y },
  colliders,
  shooter: { x: FT_LINE_X, releaseY: DEFAULT_RELEASE_Y },
};
