# Recorded weapon audio

The 43 local WAVs contain actual gunfire, gun handling, and recorded reload Foley. There are three separate shot discharges and three reload stages for every weapon, plus one dry-fire click. Total WAV size: **1,535,514 bytes (1.46 MiB)**. Every output is mono 44.1 kHz signed PCM16, with peak headroom and quiet edit boundaries. No source archive, external service or third-party request is required during play.

## Sources and license

Source pages and license labels were checked on **2026-09-06**. All contributions below are offered under [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/). Attribution is retained for provenance even though CC0 does not require it. The edits in this directory are also dedicated to CC0 1.0.

| Contribution | Creator / source page | Download and source identity |
| --- | --- | --- |
| All gunfire | Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew Nanney — [The Free Firearm Sound Library](https://opengameart.org/content/the-free-firearm-sound-library) | [Prepared SFX Library.7z](https://opengameart.org/sites/default/files/Prepared%20SFX%20Library.7z). Prepared 24-bit, 96 kHz stereo recordings. Model and microphone descriptions come from the archive's `Prepared Master Sheet.csv` and embedded WAV metadata. |
| Pistol magazine and slide; Uzi magazine removal | zer0_sol — [Handgun Reload Sound Effect](https://opengameart.org/content/handgun-reload-sound-effect) | [reload.wav](https://opengameart.org/sites/default/files/reload.wav). Recorded handgun magazine drop, insertion, and slide operation. The source does not specify the handgun model. |
| Rifle and SMG magazine/charging Foley | SpringySpringo — [Gun reload sounds](https://opengameart.org/content/gun-reload-sounds) | [assaultriflereload1_0.wav](https://opengameart.org/sites/default/files/assaultriflereload1_0.wav), [gunreload1.wav](https://opengameart.org/sites/default/files/gunreload1.wav). The creator identifies these as **airsoft gun recordings**; they provide physical mechanical Foley, not model-exact rifle or SMG reloads. |
| Magazine seating | Brian MacIntosh (BMacZero) — [Gun Reload Sound Effects](https://opengameart.org/content/gun-reload-sound-effects) | [clipload1.wav](https://opengameart.org/sites/default/files/clipload1.wav), [clipload2.wav](https://opengameart.org/sites/default/files/clipload2.wav). Model-unspecified reload Foley. |
| Revolver cylinder handling and dry fire | AugustSandberg — [Revolver Reload](https://freesound.org/people/AugustSandberg/sounds/508744/) | [Public high-quality preview](https://cdn.freesound.org/previews/508/508744_1934171-hq.mp3), saved as `revolver-reload.mp3`. Ruger GP100 .357 Magnum, recorded indoors with a Sony PCM-M10. We used the publicly accessible MP3 preview; the original 24-bit/96 kHz WAV requires a Freesound login. |
| Sniper bolt and cartridge handling | AugustSandberg — [Bolt Action Rifle Reload](https://freesound.org/people/AugustSandberg/sounds/508747/) | [Public high-quality preview](https://cdn.freesound.org/previews/508/508747_1934171-hq.mp3), saved as `bolt-reload.mp3`. Mauser k98 bolt-action rifle, recorded indoors with a Sony PCM-M10. We used the public MP3 preview. |

## Weapon matching

| Game weapon | Recorded gunfire | Matching limits |
| --- | --- | --- |
| Pistol | Walther PPQ, 9 mm | Representative semiautomatic pistol. |
| Revolver | Smith & Wesson 642, .38 Special | Actual revolver. Its reload/dry-fire recording uses a different revolver, the Ruger GP100. |
| AK-47 | AK-47, 7.62×39 | Actual named weapon family. |
| M416 | AR-15 / M4, .223 / 5.56×45 | Similar rifle class and cartridge; **not an HK416 recording**. |
| Uzi | Carl Gustav M45 / Swedish K, 9 mm | Actual 9 mm submachine gun; **not an Uzi recording**. |
| UMP | PPSh, 7.62×25 Tokarev | Actual submachine gun used as a tonal class approximation; **not a UMP or matching-cartridge recording**. |
| Sniper | Mosin Nagant, 7.62×54 | Representative full-power bolt-action rifle; the bolt Foley is a Mauser k98. |

All three variants per gun are different recorded discharges, not duplicates with random pitch changes. M416 and revolver use two near-distance takes and one mid-distance take because their source sessions contain two close shots. The third take has its late reflections attenuated to fit the close perspective. The other five sets use three near-distance takes from the same source session.

The `remove`, `insert`, and `rack` filenames follow the game's stage API. Revolver stages use cylinder manipulation / cartridge handling / closure excerpts. Sniper stages use bolt manipulation / cartridge handling / closure excerpts. These class-specific sequences are compact game edits; they do not claim to document a full real-world reload procedure.

## Processing and regeneration

The complete reproducible recipe is [scripts/build-weapon-audio.py](../../../../../scripts/build-weapon-audio.py). It requires Python 3 and FFmpeg, with no third-party Python packages. These outputs were built with FFmpeg **8.0.1**.

1. Download the sources linked above into a temporary directory. Extract the firearm archive so the directory contains `Prepared SFX Library/`.
2. Place the seven reload source files in the same directory, using the filenames in the table below. In particular, save the Freesound previews as `revolver-reload.mp3` and `bolt-reload.mp3`.
3. Verify their SHA-256 hashes against the source manifest below.
4. Run `python3 scripts/build-weapon-audio.py --source-dir /path/to/source-directory` from the project root. Use `--output-dir /tmp/weapon-audio-check` for a non-mutating comparison build.

The script explicitly averages stereo channels, resamples to 44.1 kHz, trims the listed source regions, and applies gentle high/low-pass filtering. Each profile's exact cutoff frequencies and peak targets are encoded in `Cue` values. Gunfire uses 45–95 Hz high-pass and 11.5 kHz low-pass filters. Handling uses 65–180 Hz high-pass and 8.5–11 kHz low-pass filters. There is no oscillator layer, synthesized bang, pitch shift, speed change, compressor or limiter in these assets.

The sniper is a stylized magnum report inspired by the weight and outdoor decay of an unsuppressed game sniper. It uses 1.55-second Mosin takes, strengthened recorded 45–340 Hz pressure, a brief 2–11 kHz crack layer and a lifted natural decay. Ten irregular, filtered pressure reflections between 37 ms and 1.079 seconds add a diffuse outdoor tail. Their exact gains and envelopes are in the script's `magnum` branch. All layers derive from the same licensed discharge; no PUBG sound asset is used, and this is not an actual AWM recording. Final peak remains 0.82.

Finishing removes DC offset, applies a 0.4 ms shot or 1.5 ms mechanical opening fade, then a final 90 ms shot or 35 ms mechanical fade. Source joins have an 8 ms closing taper. Peaks normalize to 0.82 for shots, 0.78 for reloads, and 0.70 for dry fire. The third M416/revolver take uses an exponential attenuation of late reflections after 45 ms (60 ms decay constant). Source attack timing and waveform pitch remain intact. Sniper bolt movements are joined at the destination offsets shown below; each recorded movement retains its own original speed.

The short pistol rack is 190 ms; other final reload stages are 190–340 ms. They fit the game's stage/completion timing without a long mechanical tail continuing after the gun becomes ready. All starts and durations below are in seconds of the decoded source; they are not MP3 byte offsets.

## Exact edit regions

| Shipped file | Source file | Start / duration (seconds) | Destination offset |
| --- | --- | --- | --- |
| `shot-pistol-1.wav` | `Prepared SFX Library/Walther PPQ/X_39P.wav` | 1.406116 / 0.400 | 0.000 |
| `shot-pistol-2.wav` | `Prepared SFX Library/Walther PPQ/X_39P.wav` | 6.443486 / 0.400 | 0.000 |
| `shot-pistol-3.wav` | `Prepared SFX Library/Walther PPQ/X_39P.wav` | 10.659427 / 0.400 | 0.000 |
| `shot-ak47-1.wav` | `Prepared SFX Library/AK-47/C_28P.wav` | 0.610334 / 0.480 | 0.000 |
| `shot-ak47-2.wav` | `Prepared SFX Library/AK-47/C_28P.wav` | 3.256570 / 0.480 | 0.000 |
| `shot-ak47-3.wav` | `Prepared SFX Library/AK-47/C_28P.wav` | 6.019903 / 0.480 | 0.000 |
| `shot-uzi-1.wav` | `Prepared SFX Library/Carl Gustav M45/G_31P.wav` | 0.309472 / 0.340 | 0.000 |
| `shot-uzi-2.wav` | `Prepared SFX Library/Carl Gustav M45/G_31P.wav` | 3.500447 / 0.340 | 0.000 |
| `shot-uzi-3.wav` | `Prepared SFX Library/Carl Gustav M45/G_31P.wav` | 6.726955 / 0.340 | 0.000 |
| `shot-ump-1.wav` | `Prepared SFX Library/PPSh/P_30P.wav` | 0.968021 / 0.390 | 0.000 |
| `shot-ump-2.wav` | `Prepared SFX Library/PPSh/P_30P.wav` | 4.386411 / 0.390 | 0.000 |
| `shot-ump-3.wav` | `Prepared SFX Library/PPSh/P_30P.wav` | 8.241785 / 0.390 | 0.000 |
| `shot-sniper-1.wav` | `Prepared SFX Library/Mosin Nagant/M_21P.wav` | 1.032987 / 1.550 | 0.000 |
| `shot-sniper-2.wav` | `Prepared SFX Library/Mosin Nagant/M_21P.wav` | 5.018951 / 1.550 | 0.000 |
| `shot-sniper-3.wav` | `Prepared SFX Library/Mosin Nagant/M_21P.wav` | 9.154801 / 1.550 | 0.000 |
| `shot-revolver-1.wav` | `Prepared SFX Library/Smith & Wesson 642/V_27P.wav` | 0.804574 / 0.520 | 0.000 |
| `shot-revolver-2.wav` | `Prepared SFX Library/Smith & Wesson 642/V_27P.wav` | 6.217885 / 0.520 | 0.000 |
| `shot-revolver-3.wav` | `Prepared SFX Library/Smith & Wesson 642/V_22P.wav` | 0.672352 / 0.520 | 0.000 |
| `shot-m416-1.wav` | `Prepared SFX Library/AR-15/D_32P.wav` | 0.702919 / 0.430 | 0.000 |
| `shot-m416-2.wav` | `Prepared SFX Library/AR-15/D_32P.wav` | 5.646615 / 0.430 | 0.000 |
| `shot-m416-3.wav` | `Prepared SFX Library/AR-15/D_24P.wav` | 0.548021 / 0.430 | 0.000 |
| `reload-pistol-remove.wav` | `reload.wav` | 0.099000 / 0.145 | 0.000 |
| `reload-pistol-insert.wav` | `reload.wav` | 0.578000 / 0.260 | 0.000 |
| `reload-pistol-rack.wav` | `reload.wav` | 1.184000 / 0.190 | 0.000 |
| `reload-revolver-remove.wav` | `revolver-reload.mp3` | 4.940000 / 0.280 | 0.000 |
| `reload-revolver-insert.wav` | `revolver-reload.mp3` | 12.515000 / 0.375 | 0.000 |
| `reload-revolver-rack.wav` | `revolver-reload.mp3` | 19.270000 / 0.220 | 0.000 |
| `reload-ak47-remove.wav` | `assaultriflereload1_0.wav` | 0.226000 / 0.200 | 0.000 |
| `reload-ak47-insert.wav` | `clipload1.wav` | 0.023000 / 0.220 | 0.000 |
| `reload-ak47-rack.wav` | `assaultriflereload1_0.wav` | 1.198000 / 0.300 | 0.000 |
| `reload-m416-remove.wav` | `assaultriflereload1_0.wav` | 0.230000 / 0.190 | 0.000 |
| `reload-m416-insert.wav` | `assaultriflereload1_0.wav` | 1.028000 / 0.160 | 0.000 |
| `reload-m416-rack.wav` | `assaultriflereload1_0.wav` | 1.198000 / 0.300 | 0.000 |
| `reload-uzi-remove.wav` | `reload.wav` | 0.099000 / 0.135 | 0.000 |
| `reload-uzi-insert.wav` | `clipload2.wav` | 0.050000 / 0.158 | 0.000 |
| `reload-uzi-rack.wav` | `gunreload1.wav` | 1.263000 / 0.190 | 0.000 |
| `reload-ump-remove.wav` | `gunreload1.wav` | 0.116000 / 0.180 | 0.000 |
| `reload-ump-insert.wav` | `clipload1.wav` | 0.023000 / 0.220 | 0.000 |
| `reload-ump-rack.wav` | `assaultriflereload1_0.wav` | 1.218000 / 0.280 | 0.000 |
| `reload-sniper-remove.wav` | `bolt-reload.mp3` | 2.153000 / 0.145 | 0.000 |
| `reload-sniper-remove.wav` | `bolt-reload.mp3` | 3.080000 / 0.160 | 0.150 |
| `reload-sniper-insert.wav` | `bolt-reload.mp3` | 12.820000 / 0.260 | 0.000 |
| `reload-sniper-rack.wav` | `bolt-reload.mp3` | 20.124000 / 0.160 | 0.000 |
| `reload-sniper-rack.wav` | `bolt-reload.mp3` | 20.501000 / 0.160 | 0.180 |
| `dry-fire.wav` | `revolver-reload.mp3` | 2.042000 / 0.145 | 0.000 |

## Source checksums

The full firearm archive has SHA-256 `cc1ab5a99a0a365105c7c5dd783f4b0b1fe90938114d3ceec53856bfe005f7d6` (193,954,738 bytes). The source checksums below identify the exact extracted WAVs and downloaded reload files; the builder prints these again on regeneration.

```text
e0934c1d79192d2216db62fdf6ab57bf9d5d585267af367a1cfb21f0972a537d  Prepared SFX Library/AK-47/C_28P.wav
4c6a54ca0583150bbb32b7f658bc64da9ad9ba42fd3aca769c6120b44af8d3f0  Prepared SFX Library/AR-15/D_24P.wav
acee9d2106b68fe5956225a19d7aedf943d97793817f9bda9d486a2b74b0a812  Prepared SFX Library/AR-15/D_32P.wav
5982c6c2fa44545b750ba6217ed57797a6a15c02f5c9943ac0e99e5f3ab2b158  Prepared SFX Library/Carl Gustav M45/G_31P.wav
970ed2322ba61579dc8afaefb4f25e6ae791a3acb1e6e23372ea948cfe2a97b3  Prepared SFX Library/Mosin Nagant/M_21P.wav
75621034e31c390edc44c963e00d44c995fb62ebcb11bec36ad7a752fafd4346  Prepared SFX Library/PPSh/P_30P.wav
2ddbaff76737abe2b9af2a13eb5f00056364c0a0de170b8c19bddfb5c4058f25  Prepared SFX Library/Smith & Wesson 642/V_22P.wav
dc9a11f7e6544139f38cadccf3373fed733f2e000caca1b2328575293838fc58  Prepared SFX Library/Smith & Wesson 642/V_27P.wav
d679a3cd87eae2898d984159f83544392932e6b77526045b672e3aaa9c2dda9f  Prepared SFX Library/Walther PPQ/X_39P.wav
efb2d724d634eabe6ba8d3065686abca848bb7497d4d43a5e4aed5e5ea23016f  assaultriflereload1_0.wav
ac695311f800a63c255d456c2cd052dffbb6c0016e8ea061f183c10602298af9  bolt-reload.mp3
1cdc10c50a26834ce7562a5f2925b9aa1118e3bb58a86fea80f34558bf2c5101  clipload1.wav
a5441641e7e9ede24f3ac311642e06265c6f480e3b1ba4b92c19c81c3a5e4d86  clipload2.wav
685cac6a184e3cc3ec09a25b6ddb1d6feffd86d469778f339aa423d384035c50  gunreload1.wav
091399145b174ac3b2e0df245b4712a13ce85df072e37256b0fc32658718be53  reload.wav
05bcb3971d11396050ffbe24be9f9c49b29ceecf90630f982dec61c4a9a8755a  revolver-reload.mp3
```

## Verification scope

The checked-in assets were inspected for RIFF/WAVE PCM16 format, mono 44.1 kHz sample rate, finite samples, expected durations, quiet first/last samples, conservative peaks, distinct shot data, and consistent per-weapon shot RMS. These signal checks establish file and timing quality; headphone/speaker listening in the full game mix remains a subjective check.
