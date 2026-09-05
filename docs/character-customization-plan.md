# Detailed character and customization — accepted delivery plan

September 5, 2026. The user approved the character preview and the waist/hit-flash corrections. Full creator and gameplay integration are now authorized and implemented; final verification is recorded in verification.md.

## Decisions

- Use original MM-inspired three-quarter artwork, readable faces, separate hands and detailed boots, while retaining Burnhop's night-outpost presentation.
- Review the base character and three sample looks before completing the creator or changing gameplay artwork.
- All cosmetics are available immediately: no shop, currencies, crates, progression, or unlocks.
- Slim, standard, and broad builds share the existing height, rig and collision dimensions. Builds change contours, not reach or gameplay advantages.
- Begin with a curated catalog and separate colour choices. Changes in the creator apply and save automatically; named looks store independent full-appearance snapshots.

## Full catalog after preview approval

| Part | Initial styles |
| --- | --- |
| Face | Oval, round, square; integrated nose |
| Eyes | Round, narrow, relaxed |
| Eyebrows | Straight, angled, thick |
| Mouth | Neutral, smile, clenched teeth |
| Skin | Six tones used consistently on face, neck and hands |
| Build | Slim, standard, broad |
| Hair | None, buzz cut, short crop, swept, spiky, tied back |
| Sideburns | None, short, long |
| Moustache | None, pencil, handlebar |
| Beard | None, stubble, goatee, full |
| Headgear | None, helmet, cap, beret |
| Eyewear | None, glasses, sunglasses, goggles |
| Tops | Field jacket, T-shirt, tactical shirt |
| Trousers | Fatigues, cargo, reinforced |
| Gloves | None, fingerless, full |
| Vests | None, utility, armoured |
| Belts | None, webbing, pouches |
| Boots | Light, combat, armoured |
| Outfits | Field, Scout, Heavy |

Use six hair colours and eight equipment/clothing palettes. Hair, sideburns, moustache and beard colours are independent, as are clothing and equipment slot colours. Preserve the existing Olive, Sand and Slate role colours when migrating saved settings. The complete catalog includes 64 choices across 18 parts. The approved short beard remains as an additional fifth beard option alongside None, Stubble, Goatee, and Full.

Complete outfits replace clothes, equipment, boots and their colours while retaining face, hair and build. Named saved looks capture every appearance part. Save, restore, update, rename and delete with Undo; edits to the active appearance never silently overwrite a named snapshot. Look names do not change the callsign.

## Milestones

1. **Preview — approved.** `/?preview=character` presents an unobscured Base, olive standard-build Field with helmet/short beard/combat boots, sand slim-build Scout with cap/stubble/light boots, and broad slate Heavy with beret/full beard/armour. Enlarged and gameplay-size views, facing/aim, standing/crouch/walk/jump/jet, frozen phase and joints use temporary state. The study keeps temporary inspection state; the approved renderer is shared with gameplay.
2. **Full creator — implemented.** Replaced the three colour swatches with a category rail, thumbnail options, independent colours, outfits and saved looks alongside the live preview. Narrow layouts put the preview above category navigation and scrollable options. Provide labelled keyboard controls, visible selections and reduced-motion support.
3. **Integration — implemented.** Completed reusable artwork parts and use the detailed renderer in creator, menu, crouch preview, player and bot. Keep an explicit bot recipe, existing crouch preview and practice-entry flow. Add versioned settings and migration from current Burnhop settings and the legacy fallback; preserve preferences and colours, default unknown parts individually, and handle unavailable storage without blocking play.

## Technical invariants and validation

Keep the 36-pixel collider width, 68-pixel standing height, approximately 54.2-pixel crouch height, leg lengths, weapon pivot, sole plane and both exhaust anchors. The detailed rifle uses the existing 28-pixel local muzzle convention, with separate trigger and support grip points. Both arms articulate to those grips through aim and recoil. Head parts rotate together; headgear masks covered hair while retaining its selected style.

Continue Canvas 2D and reusable vector parts. The preview has no additional runtime assets; the creator should retain loading progress, failure handling and Retry when assets are added. Avoid per-frame resource decoding/requests and combinations of pre-rendered full-character sprites.

Review every selectable item and representative combinations across three builds, both facings, vertical aim, crouch transitions, forward/backward walking, jump, thrust, recoil and hit feedback. Verify facial readability, hair/gear overlap, hand contacts, boot/exhaust placement and unchanged geometry. Check saved-look operations, invalid data, migration, responsive/keyboard/reduced-motion behaviour, current game regressions and production loading. Migration and full saved-look tests belong to the subsequent creator milestone.

Movement tuning, additional gameplay bindings, camera revisions, weapons, multiplayer and online storage are outside this change.
