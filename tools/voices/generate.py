"""Record the voice acting for Outlaw Frontier with the Kokoro TTS model.

Every line of mission dialogue (western/js/missions.js) and every fight bark
(western/js/barks.js) becomes western/assets/voice/<key>.mp3, where key is a
hash of "speaker|text" (the same hash as voiceKey() in western/js/voice.js).
index.json maps each key to the clip's length in seconds. Lines that already
have a clip are skipped, and clips no line uses any more are deleted.

    pip install kokoro-onnx soundfile
    # model files from https://github.com/thewh1teagle/kokoro-onnx/releases (model-files-v1.0)
    python tools/voices/generate.py --model kokoro-v1.0.onnx --voices voices-v1.0.bin

Needs ffmpeg with libmp3lame on the PATH.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile

import numpy as np
import soundfile as sf

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
GAME = os.path.join(ROOT, 'western')
OUT = os.path.join(GAME, 'assets', 'voice')

# Who sounds like whom: a blend of Kokoro voices and a speaking speed.
CAST = {
    'Cole': ([('am_michael', 0.65), ('am_onyx', 0.35)], 0.95),
    'Gus': ([('am_santa', 0.45), ('am_onyx', 0.35), ('bm_george', 0.2)], 0.88),
    'Sheriff Dawes': ([('am_onyx', 0.55), ('am_eric', 0.45)], 0.93),
    'Eli Hollis': ([('am_puck', 0.6), ('am_liam', 0.4)], 1.0),
    'Red Lockhart': ([('bm_george', 0.5), ('am_fenrir', 0.5)], 0.9),
    'Jack Mercer': ([('bm_daniel', 0.5), ('am_echo', 0.5)], 0.86),
    'Walt': ([('am_adam', 0.5), ('am_santa', 0.5)], 0.95),
    'Gunman A': ([('am_eric', 0.7), ('am_fenrir', 0.3)], 1.06),
    'Gunman B': ([('am_liam', 0.6), ('am_echo', 0.4)], 1.08),
    'Gunman C': ([('bm_lewis', 0.6), ('am_fenrir', 0.4)], 1.03),
}
# Unnamed speakers in the missions borrow a gunman's voice
CAST['Robber'] = CAST['Gunman A']
CAST['Outlaw'] = CAST['Gunman C']
CAST['Raider'] = CAST['Gunman B']


def voice_key(who, text):
    """FNV-1a over the UTF-16 code units of "who|text", as voiceKey() in voice.js."""
    h = 0x811c9dc5
    data = f'{who}|{text}'.encode('utf-16-le')
    for i in range(0, len(data), 2):
        h ^= data[i] | (data[i + 1] << 8)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return f'{h:08x}'


JS_STR = r"'((?:[^'\\]|\\.)*)'"


def js_unescape(s):
    return re.sub(r'\\(.)', r'\1', s)


def mission_lines():
    src = open(os.path.join(GAME, 'js', 'missions.js'), encoding='utf-8').read()
    out = []
    for m in re.finditer(r'\[\s*' + JS_STR + r'\s*,\s*' + JS_STR, src):
        who, text = js_unescape(m.group(1)), js_unescape(m.group(2))
        if who in CAST:
            out.append((who, text))
    return out


def bark_lines():
    js = ("import { BARKS, BARK_VOICES, COLE_LINES } from './western/js/barks.js';"
          "console.log(JSON.stringify({ BARKS, BARK_VOICES, COLE_LINES }));")
    data = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', js], cwd=ROOT))
    out = []
    for who in data['BARK_VOICES']:
        for lines in data['BARKS'].values():
            out += [(who, t) for t in lines]
    for lines in data['COLE_LINES'].values():
        out += [('Cole', t) for t in lines]
    return out


def style(kokoro, blend):
    return sum(kokoro.get_voice_style(name) * w for name, w in blend)


def tidy(samples, sr):
    """Trim silence at the ends and level the line."""
    a = np.abs(samples)
    loud = np.where(a > 0.01)[0]
    if len(loud):
        samples = samples[max(0, loud[0] - int(0.04 * sr)):loud[-1] + int(0.12 * sr)]
    rms = np.sqrt(np.mean(samples ** 2)) or 1.0
    samples = samples * min(0.1 / rms, 0.89 / (np.max(np.abs(samples)) or 1.0))
    return samples.astype(np.float32)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', required=True)
    ap.add_argument('--voices', required=True)
    ap.add_argument('--force', action='store_true', help='re-record every line')
    args = ap.parse_args()
    from kokoro_onnx import Kokoro
    kokoro = Kokoro(args.model, args.voices)
    os.makedirs(OUT, exist_ok=True)
    lines = list(dict.fromkeys(mission_lines() + bark_lines()))
    index_path = os.path.join(OUT, 'index.json')
    old = json.load(open(index_path)) if os.path.exists(index_path) else {}
    index = {}
    styles = {}
    made = 0
    for who, text in lines:
        key = voice_key(who, text)
        path = os.path.join(OUT, key + '.mp3')
        if key in old and os.path.exists(path) and not args.force:
            index[key] = old[key]
            continue
        blend, speed = CAST[who]
        if who not in styles:
            styles[who] = style(kokoro, blend)
        samples, sr = kokoro.create(text, voice=styles[who], speed=speed, lang='en-us')
        samples = tidy(np.asarray(samples, dtype=np.float32), sr)
        with tempfile.NamedTemporaryFile(suffix='.wav') as tmp:
            sf.write(tmp.name, samples, sr)
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', tmp.name, '-af', 'highpass=f=80',
                            '-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', '-b:a', '40k', path], check=True)
        index[key] = round(len(samples) / sr, 2)
        made += 1
        print(f'  {who:>14}: {text}')
    for f in os.listdir(OUT):
        if f.endswith('.mp3') and f[:-4] not in index:
            os.remove(os.path.join(OUT, f))
    with open(index_path, 'w') as f:
        json.dump(index, f, indent=0, sort_keys=True)
    total = sum(os.path.getsize(os.path.join(OUT, k + '.mp3')) for k in index)
    print(f'{len(index)} lines ({made} new), {sum(index.values()):.0f} s of speech, {total / 1048576:.1f} MB')


if __name__ == '__main__':
    sys.exit(main())
