// Voice acting: every line of mission dialogue and every fight bark was
// recorded ahead of time (tools/voices/generate.py) into assets/voice/, one
// MP3 per line, named by a hash of speaker and text. index.json lists them
// with their lengths so subtitles can last exactly as long as the speech.
import { loadBytes } from './assets.js';
import { BARKS, BARK_VOICES, COLE_LINES } from './barks.js';

export function voiceKey(who, text) {
  const s = `${who}|${text}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];

export class Voices {
  constructor(game) {
    this.game = game;
    this.index = {};
    this.cache = new Map();       // key -> Promise<AudioBuffer>
    this.line = null;             // the dialogue line playing now
    this.lastBark = 0;
    this.lastQuip = 0;
    this.nextVoice = 0;
  }

  async load() {
    try {
      this.index = JSON.parse(new TextDecoder().decode(await loadBytes('assets/voice/index.json')));
    } catch {
      this.index = {};            // no recordings: subtitles only
    }
  }

  // Seconds of recorded speech for a line, or 0 if there is none.
  duration(who, text) {
    return this.index[voiceKey(who, text)] || 0;
  }

  buffer(key) {
    const ctx = this.game.audio.ctx;
    if (!ctx || !this.index[key]) return null;
    let p = this.cache.get(key);
    if (!p) {
      p = loadBytes(`assets/voice/${key}.mp3`).then((b) => ctx.decodeAudioData(b)).catch(() => null);
      this.cache.set(key, p);
      // Keep the most recent few dozen decoded; speech adds up
      if (this.cache.size > 48) this.cache.delete(this.cache.keys().next().value);
    }
    return p;
  }

  // Start decoding a conversation's lines so they follow on without gaps.
  prefetch(lines) {
    for (const [who, text] of lines) this.buffer(voiceKey(who, text));
  }

  // A line of dialogue, heard as if close by. Cuts off the previous one.
  say(who, text) {
    const key = voiceKey(who, text);
    this.stop();
    const p = this.buffer(key);
    if (!p) return;
    const token = (this.line = { key, src: null });
    p.then((buf) => {
      if (this.line !== token) return;
      if (!buf) {
        this.line = null;
        return;
      }
      token.src = this.game.audio.playVoice(buf, { gain: 1 });
      if (token.src) token.src.onended = () => { if (this.line === token) this.line = null; };
      else this.line = null;
    });
  }

  stop() {
    if (this.line?.src) {
      try { this.line.src.stop(); } catch { /* already ended */ }
    }
    this.line = null;
  }

  // A shout from someone in a gunfight: quieter and panned with distance.
  shout(who, text, pos) {
    const g = this.game;
    const p = this.buffer(voiceKey(who, text));
    if (!p) return;
    const cam = g.camera.position;
    const d = cam.distanceTo(pos);
    if (d > 90) return;
    const rel = pos.clone().sub(cam).normalize();
    const pan = Math.max(-1, Math.min(1, rel.dot(g.camRig.right(rel.clone()))));
    const gain = Math.max(0.12, 1 - d / 90) * 0.85;
    p.then((buf) => { if (buf) g.audio.playVoice(buf, { gain, pan: pan * 0.8, verb: Math.min(0.5, d / 120) }); });
  }

  bark(npc, kind) {
    const now = performance.now() / 1000;
    if (now - this.lastBark < 2.2 || (npc.lastBark && now - npc.lastBark < 5)) return;
    if (this.line) return;        // don't talk over the story
    if (npc.voice === undefined) npc.voice = this.nextVoice++ % BARK_VOICES.length;
    this.lastBark = npc.lastBark = now;
    this.shout(BARK_VOICES[npc.voice], pick(BARKS[kind]), npc.pos);
  }

  onKill(npc) {
    const now = performance.now() / 1000;
    if (npc.role !== 'outlaw' || now - this.lastQuip < 9 || Math.random() > 0.3 || this.line) return;
    this.lastQuip = now;
    setTimeout(() => { if (!this.line) this.say('Cole', pick(COLE_LINES.kill)); }, 500);
  }
}
