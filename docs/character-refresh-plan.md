# Character refresh — implementation and remaining plan

September 5, 2026. The approved crouch, upright stance, and aim-driven head/torso motion are implemented in main gameplay. A separate detailed-character preview is ready for visual review. The full cosmetic creator, its saved looks, and detailed gameplay artwork follow that approval; broader movement, keyboard, and camera changes remain separate work.

## Approved and implemented

The user approved the full crouch silhouette, then the stronger head movement at extreme up/down aim, and requested integration into main gameplay. The character now uses those poses in practice, including connected knees, boots, arms, and sole thrusters during movement.

- **Grounded crouch:** Hold **S** or **Down arrow**. Either key keeps crouch active; release both to stand. The body lowers over approximately **0.18 seconds**, with planted feet and bent knees. Full crouch walking is **160 px/s**, half the normal ground speed.
- **Physical clearance:** The standing collider remains **68 world pixels** tall; full crouch is about **54.2 pixels**. Resizing preserves the feet. A low ceiling blocks standing, and the simulation retries automatically after the character moves clear.
- **Jump and flight:** Jumping and airborne movement release crouch while respecting ceiling clearance. Jump impulse, jetpack power, and air speed remain unchanged. A held crouch applies again after landing once Space is released. Pausing preserves the physical stance; resumed ticks safely release it after input cleanup.
- **Weapon alignment:** The body, gun, aim indicator, firing origin, and muzzle effects use the same stance offsets. Head/torso rotation does not move the stance's weapon pivot. Shots originate at the lowered hand, so nearby cover still blocks a protruding muzzle.
- **Upper-body aim:** The head and helmet tilt by up to **60 degrees**, progressively stronger near vertical aim. The torso leans by at most **6 degrees** from the waist. The neck follows its torso attachment, and the near arm remains attached to the shoulder and gun grip. Level aim retains the approved neutral pose.

The approved artwork is scaled uniformly by `68 / 85.94` for gameplay, preserving its proportions while fitting the existing standing collider. The full crouch is about 20% shorter than standing. Shared geometry in `src/game/stance.ts` drives collision height, body offsets, and weapon positioning; `simulation.ts` owns fixed-tick transitions and clearance, while `character.ts`, `renderer.ts`, and `runtime.ts` apply the pose and controls.

## Preview and review

Open `/?preview=crouch` or choose **Crouch preview** in the menu footer. Compare standing and crouching at enlarged and actual gameplay scale using the depth slider, stance buttons, transition replay, facing flip, and joint overlay. **Try in practice** enters the normal practice flow directly from the preview. Saved character colours carry into both views.

The look-direction slider and **Look up / Level / Look down** buttons work independently of stance and facing. Up/down presets select the full vertical aiming extremes, retaining the selected facing. Reduced motion makes stance/look presets immediate and disables replay; sliders remain available. Practice uses the latest rendered mouse aim without an added aiming delay.

`node scripts/review-crouch.mjs` checks the preview against a running development server. See `docs/verification.md` for current gameplay verification and screenshots; the earlier pose-study images begin at `docs/screenshots/20-crouch-preview.png`.

## Detailed character preview — ready for review

Open `/?preview=character` or choose **Character preview** in the menu footer. The isolated renderer shows Base, Field, Scout, and Heavy with three body builds, original detailed faces, readable hands, and articulated supporting/trigger arms. The enlarged character and level-aim face close-up sit beside pose/aim controls; four native gameplay-size figures make small-scale comparison possible. All looks retain the approved rig, head response, fixed soles, and weapon pivot.

Controls include standing/crouching/walking/jumping/jet poses, facing, vertical aim, crouch depth, frozen animation phase, forward/backward walking, joint guides, and a temporary headgear/eyewear removal switch. Reduced motion disables playback while keeping manual controls. No preview choice writes settings or activates practice. The current main character and three-colour customizer remain intact until visual approval.

`src/game/appearance.ts` defines the temporary typed look recipes and colour roles; `src/game/detailedCharacter.ts` draws the new parts without image loading or per-frame network calls. The two rifle grips and muzzle are explicit anchors; the articulated arms use the same aim/recoil transform as the visible hands. Headgear masks covered hair without mutating its selection. See [the accepted customization plan](character-customization-plan.md) for the catalog and remaining milestones.

## Detailed artwork direction

The supplied Mini Militia screenshot is a visual reference for facing, readable anatomy, facial features, and footwear. Preserve Burnhop's original soldier design, colours, approved crouch, and aim response while refining the artwork.

- Use a slight three-quarter view so the face and chest turn toward the viewer while the character can aim left or right.
- Show both eyes and eyebrows, a defined nose, mouth, and short beard. Open the helmet brim enough to expose the face.
- Separate the near and far shoulders, arms, and hands. Give the trigger hand and supporting hand clear positions on the rifle.
- Keep both legs and boots readable, with recognisable toes, uppers, and soles. Preserve the existing boot-mounted thrusters and approved knee geometry.
- Use restrained shading on far limbs, clear outlines, and a few tunic details. Judge facial details at gameplay size as well as enlarged; allow natural limb overlap across aim angles.

Continue using the Canvas 2D renderer and SVG assets. Character pose calculation lives in `src/game/character.ts`; completed artwork lives in the shared `src/game/detailedCharacter.ts`, with typed parts in `appearance.ts` and corresponding creator/loading checks. The original visor sprite has been retired from loading. Keep shared stance geometry and the weapon origin aligned if proportions change. General movement tuning, additional keyboard changes, and camera changes are separate later requests.

## Remaining acceptance checks

1. Review revised artwork in standing, crouching, walking, backward walking, flying, and extreme aim poses, facing both directions, at gameplay size and enlarged.
2. Make eyes, brows, mouth, beard, hands, legs, and boots readable without weakening the approved crouch silhouette.
3. Preserve connected joints, fixed feet during stationary stance changes, safe standing clearance, and correctly attached sole exhaust.
4. Keep the gun, aim indicator, shot origin, and effects aligned, including shooting close to cover while crouched.
5. Check customization, target presentation, existing colour choices, and reduced motion. Extend meaningful geometry checks and run relevant tests, typecheck, browser review, and a production build.
