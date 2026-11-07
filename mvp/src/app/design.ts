/**
 * Which design the app renders.
 *
 * `v3` is the current design. `v2` is the original v0.2 appearance, kept in full so the
 * visual redesign can be reverted without touching features: both designs share the
 * service layer, the screens' logic and the design-system primitives; they differ in
 * tokens (src/styles), the shells (navigation), the tournament cards, the player home,
 * the lobby and club-page headers, and the poker table.
 *
 * The value comes from the build (`node scripts/build.mjs --design=v2`); under the test
 * runner, where nothing injects it, the current design applies.
 */
export const DESIGN: 'v2' | 'v3' = typeof __DESIGN__ !== 'undefined' && __DESIGN__ === 'v2' ? 'v2' : 'v3';
export const V3 = DESIGN === 'v3';
