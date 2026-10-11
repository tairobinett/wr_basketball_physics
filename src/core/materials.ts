/**
 * Material table (DESIGN.md §5.6).
 *
 * DECISION: these stay at measured/published values. They are NOT tuned backwards from real-world
 * make rates, and there is no release-variance model anywhere in the project. Whatever make rate
 * falls out of the physics is the answer.
 *
 * `hardwood.e = 0.77` is anchored to the regulation ball-inflation drop test. The measurement
 * conventions in the rule are asymmetric and change the answer substantially:
 *
 *   Dropped from 1.80 m measured to the BOTTOM of the ball, it must rebound to between 1.20 m and
 *   1.40 m measured to the TOP of the ball.
 *
 * The centre therefore falls 1.80 m and rises between (1.20 - 2R) and (1.40 - 2R), i.e. 0.961 m to
 * 1.161 m, so e = sqrt(rise/fall) lies between 0.731 and 0.803. (Reading both heights under the
 * same convention — the easy mistake, and what DESIGN.md's first draft did — inflates this to
 * 0.82-0.87.) 0.77 sits mid-window. tests/physics.spec.ts asserts both the implied range and an
 * actual simulated rebound, so the floor is checked against the rule rather than against itself.
 *
 * The debug e/mu sliders (DESIGN.md §7) do NOT mutate this table or any module-level state — that
 * would break the §4.1 purity rule and make a run depend on UI history. Overrides are resolved into
 * an immutable table when the World is built, and recorded in the ShotDescriptor, so any run is
 * still exactly reproducible from its descriptor alone.
 */

export type MaterialId = 'hardwood' | 'glass' | 'steel' | 'padding' | 'rubber';

export interface Material {
  /** Coefficient of restitution, normal direction. */
  readonly e: number;
  /** Coefficient of friction, tangential direction (Coulomb). */
  readonly mu: number;
  readonly name: string;
}

export type MaterialTable = Readonly<Record<MaterialId, Material>>;

export const DEFAULT_MATERIALS: MaterialTable = {
  hardwood: { e: 0.77, mu: 0.45, name: 'Hardwood floor' },
  /** Slightly livelier than the floor: a sprung hardwood court absorbs more than rigid glass. */
  glass: { e: 0.78, mu: 0.2, name: 'Tempered glass backboard' },
  /**
   * The least defensible number in this table, and the one that most decides whether a near-miss
   * rattles in or out. It stays measured; the debug sliders exist to explore its sensitivity
   * without changing the shipped default.
   */
  steel: { e: 0.72, mu: 0.35, name: 'Steel rim' },
  padding: { e: 0.35, mu: 0.7, name: 'Padded obstacle' },
  rubber: { e: 0.9, mu: 0.8, name: 'Rubber' },
};

export type MaterialOverrides = Partial<Record<MaterialId, { e: number; mu: number }>>;

export const MATERIAL_IDS: readonly MaterialId[] = [
  'hardwood',
  'glass',
  'steel',
  'padding',
  'rubber',
];

/** Resolve overrides into a fresh immutable table. Never mutates DEFAULT_MATERIALS. */
export function resolveMaterials(overrides?: MaterialOverrides): MaterialTable {
  if (!overrides) return DEFAULT_MATERIALS;
  const out: Record<MaterialId, Material> = { ...DEFAULT_MATERIALS };
  for (const id of MATERIAL_IDS) {
    const o = overrides[id];
    if (o) out[id] = { e: o.e, mu: o.mu, name: DEFAULT_MATERIALS[id].name };
  }
  return out;
}
