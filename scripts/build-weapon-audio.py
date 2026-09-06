#!/usr/bin/env python3
"""Build the recorded weapon cues with Python's standard library and FFmpeg.

See public/assets/audio/sfx/weapons/README.md for download locations and credits.
The source directory contains Prepared SFX Library/ and the named reload files.
No network access, source archive, or Python package is needed at game runtime.
"""

from __future__ import annotations

import argparse
from array import array
from dataclasses import dataclass, replace
import hashlib
import math
from pathlib import Path
import shutil
import subprocess
import sys
import wave

RATE = 44100
ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class Cut:
    source: str
    start: float
    duration: float
    offset: float = 0
    gain: float = 1


@dataclass(frozen=True)
class Cue:
    cuts: tuple[Cut, ...]
    duration: float
    highpass: int = 85
    lowpass: int = 10000
    peak: float = .78
    shot: bool = False
    reflection_decay: bool = False
    magnum: bool = False


def firearm(path: str) -> str:
    return f"Prepared SFX Library/{path}"


# Each shot entry is a separate discharge from the source session. Start offsets
# retain approximately 0.8 ms before the first substantial pressure transient.
SHOTS = {
    "pistol": ("Walther PPQ/X_39P.wav", (1.406116, 6.443486, 10.659427), .40, 75),
    "ak47": ("AK-47/C_28P.wav", (.610334, 3.256570, 6.019903), .48, 55),
    "uzi": ("Carl Gustav M45/G_31P.wav", (.309472, 3.500447, 6.726955), .34, 95),
    "ump": ("PPSh/P_30P.wav", (.968021, 4.386411, 8.241785), .39, 70),
    "sniper": ("Mosin Nagant/M_21P.wav", (1.032987, 5.018951, 9.154801), 1.55, 45),
}


def cues() -> dict[str, Cue]:
    result = {}
    for weapon, (source, starts, duration, highpass) in SHOTS.items():
        for take, start in enumerate(starts, 1):
            result[f"shot-{weapon}-{take}"] = Cue(
                (Cut(firearm(source), start, duration),), duration,
                highpass, 11500, .82, True, magnum=weapon == "sniper",
            )
    for weapon, near, starts, mid, third, duration, highpass in (
        ("revolver", "Smith & Wesson 642/V_27P.wav", (.804574, 6.217885),
         "Smith & Wesson 642/V_22P.wav", .672352, .52, 60),
        ("m416", "AR-15/D_32P.wav", (.702919, 5.646615),
         "AR-15/D_24P.wav", .548021, .43, 70),
    ):
        for take, start in enumerate(starts, 1):
            result[f"shot-{weapon}-{take}"] = Cue(
                (Cut(firearm(near), start, duration),), duration,
                highpass, 11500, .82, True,
            )
        result[f"shot-{weapon}-3"] = Cue(
            (Cut(firearm(mid), third, duration),), duration,
            highpass, 11500, .82, True, True,
        )

    # Reloads are edited physical mechanisms at their original speed and pitch.
    # The stage filenames follow the game's remove/insert/rack animation API;
    # revolver stages are cylinder handling and sniper stages are bolt handling.
    stages = {
        "pistol": (
            Cue((Cut("reload.wav", .099, .145),), .145, 130, 10000),
            Cue((Cut("reload.wav", .578, .260),), .260, 100, 10500),
            Cue((Cut("reload.wav", 1.184, .190),), .190, 110, 10500),
        ),
        "revolver": (
            Cue((Cut("revolver-reload.mp3", 4.940, .280),), .280, 140, 9500),
            Cue((Cut("revolver-reload.mp3", 12.515, .375),), .375, 150, 10000),
            Cue((Cut("revolver-reload.mp3", 19.270, .220),), .220, 90, 10000),
        ),
        "ak47": (
            Cue((Cut("assaultriflereload1_0.wav", .226, .200),), .200, 85, 8500),
            Cue((Cut("clipload1.wav", .023, .220),), .220, 65, 9500),
            Cue((Cut("assaultriflereload1_0.wav", 1.198, .300),), .300, 85, 9500),
        ),
        "m416": (
            Cue((Cut("assaultriflereload1_0.wav", .230, .190),), .190, 150, 11000),
            Cue((Cut("assaultriflereload1_0.wav", 1.028, .160),), .160, 120, 10000),
            Cue((Cut("assaultriflereload1_0.wav", 1.198, .300),), .300, 150, 11000),
        ),
        "uzi": (
            Cue((Cut("reload.wav", .099, .135),), .135, 180, 11000),
            Cue((Cut("clipload2.wav", .050, .158),), .158, 170, 11000),
            Cue((Cut("gunreload1.wav", 1.263, .190),), .190, 180, 11000),
        ),
        "ump": (
            Cue((Cut("gunreload1.wav", .116, .180),), .180, 110, 9000),
            Cue((Cut("clipload1.wav", .023, .220),), .220, 120, 9000),
            Cue((Cut("assaultriflereload1_0.wav", 1.218, .280),), .280, 100, 9000),
        ),
        "sniper": (
            Cue((Cut("bolt-reload.mp3", 2.153, .145),
                 Cut("bolt-reload.mp3", 3.080, .160, .150)), .310, 110, 9500),
            Cue((Cut("bolt-reload.mp3", 12.820, .260),), .260, 130, 10000),
            Cue((Cut("bolt-reload.mp3", 20.124, .160),
                 Cut("bolt-reload.mp3", 20.501, .160, .180)), .340, 85, 10500),
        ),
    }
    for weapon, stages_for_weapon in stages.items():
        for stage, cue in zip(("remove", "insert", "rack"), stages_for_weapon):
            result[f"reload-{weapon}-{stage}"] = cue
    result["dry-fire"] = Cue((Cut("revolver-reload.mp3", 2.042, .145),), .145, 180, 9500, .70)
    return result


def decode(source: Path, ffmpeg: str) -> array:
    # Explicit equal stereo downmix prevents FFmpeg's default equal-power
    # summation from raising already normalized recordings above full scale.
    raw = subprocess.run([
        ffmpeg, "-v", "error", "-i", str(source), "-af",
        "aformat=channel_layouts=stereo,pan=mono|c0=0.5*c0+0.5*c1",
        "-ar", str(RATE), "-f", "f32le", "pipe:1",
    ], check=True, capture_output=True).stdout
    samples = array("f")
    samples.frombytes(raw)
    if sys.byteorder != "little":
        samples.byteswap()
    return samples


def filter_audio(samples: array, cue: Cue, ffmpeg: str) -> array:
    values = array("f", samples)
    if sys.byteorder != "little":
        values.byteswap()
    filters = f"highpass=f={cue.highpass},lowpass=f={cue.lowpass}"
    raw = subprocess.run([
        ffmpeg, "-v", "error", "-f", "f32le", "-ar", str(RATE),
        "-ac", "1", "-i", "pipe:0", "-af", filters,
        "-f", "f32le", "pipe:1",
    ], input=values.tobytes(), check=True, capture_output=True).stdout
    result = array("f")
    result.frombytes(raw)
    if sys.byteorder != "little":
        result.byteswap()
    return result


def render(cue: Cue, decoded: dict[str, array], ffmpeg: str) -> array:
    samples = array("f", [0]) * round(cue.duration * RATE)
    for cut in cue.cuts:
        source = decoded[cut.source]
        begin, count, offset = round(cut.start * RATE), round(cut.duration * RATE), round(cut.offset * RATE)
        if begin + count > len(source):
            raise ValueError(f"Cut extends beyond {cut.source}")
        for i in range(min(count, len(samples) - offset)):
            # Cut joins taper their last 8 ms; this also keeps the compact bolt
            # sequence free of edit clicks without stretching either movement.
            join_fade = min(1.0, (count - 1 - i) / (RATE * .008))
            samples[offset + i] += source[begin + i] * cut.gain * max(0, join_fade)
    samples = filter_audio(samples, cue, ffmpeg)
    if cue.magnum:
        # A game-style magnum report: immediate crack, broad low pressure, then
        # diffuse outdoor reflections. Every layer comes from this recorded take;
        # no pitched oscillator, pitch bend, or extracted commercial-game audio.
        original = array("f", samples)
        body = filter_audio(original, replace(cue, highpass=45, lowpass=340), ffmpeg)
        crack = filter_audio(original, replace(cue, highpass=2000, lowpass=11000), ffmpeg)
        reflected = filter_audio(original, replace(cue, highpass=160, lowpass=2600), ffmpeg)
        for i, sample in enumerate(original):
            time = i / RATE
            tail_lift = 1 + .8 * min(1, max(0, time - .055) / .10)
            samples[i] = sample * tail_lift + body[i] * 3.0 * math.exp(-time / .24) + crack[i] * .35 * math.exp(-time / .025)
        for delay, level in ((.037, .65), (.071, .575), (.119, .50), (.181, .425),
                             (.263, .35), (.367, .275), (.499, .2125), (.661, .15), (.857, .0875), (1.079, .045)):
            offset = round(delay * RATE)
            for i in range(min(round(.48 * RATE), len(samples) - offset)):
                time = i / RATE
                soft_attack = min(1, time / .0015)
                pressure_tail = body[i] * .7 + reflected[i] * .3
                samples[offset + i] += pressure_tail * level * soft_attack * math.exp(-time / .12)
    dc = sum(samples) / len(samples)
    fade_in = round((.0004 if cue.shot else .0015) * RATE)
    fade_out = round((.090 if cue.shot else .035) * RATE)
    for i, sample in enumerate(samples):
        envelope = min(1, i / fade_in, (len(samples) - 1 - i) / fade_out)
        if cue.reflection_decay:
            # The library supplies only two close takes for these two guns.
            # Retain a third discharge while reducing its late range echoes.
            envelope *= math.exp(-max(0, i / RATE - .045) / .060)
        samples[i] = (sample - dc) * max(0, envelope)
    peak = max(abs(sample) for sample in samples)
    if not math.isfinite(peak) or peak < .00001:
        raise ValueError("Empty or non-finite cue")
    gain = cue.peak / peak
    return array("h", (round(sample * gain * 32767) for sample in samples))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "public/assets/audio/sfx/weapons")
    parser.add_argument("--ffmpeg", default=shutil.which("ffmpeg"))
    args = parser.parse_args()
    if not args.ffmpeg:
        parser.error("FFmpeg is required; install it or pass --ffmpeg /path/to/ffmpeg")
    recipes = cues()
    sources = sorted({cut.source for cue in recipes.values() for cut in cue.cuts})
    missing = [name for name in sources if not (args.source_dir / name).is_file()]
    if missing:
        parser.error("Missing sources: " + ", ".join(missing))
    decoded = {name: decode(args.source_dir / name, args.ffmpeg) for name in sources}
    args.output_dir.mkdir(parents=True, exist_ok=True)
    total_bytes = 0
    for name, cue in recipes.items():
        pcm = render(cue, decoded, args.ffmpeg)
        if sys.byteorder != "little":
            pcm.byteswap()
        target = args.output_dir / f"{name}.wav"
        with wave.open(str(target), "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(RATE)
            output.writeframes(pcm.tobytes())
        total_bytes += target.stat().st_size
    print(f"Built {len(recipes)} cues; {total_bytes:,} bytes; mono PCM16 / {RATE} Hz")
    for name in sources:
        digest = hashlib.sha256((args.source_dir / name).read_bytes()).hexdigest()
        print(f"{digest}  {name}")


if __name__ == "__main__":
    main()
