// The body: health, stamina, hunger, thirst, warmth, wetness and sickness, and what the weather,
// fires and shelter do to them.
import { SURVIVAL, TIME, WORLD } from './config.js';
import { clamp, saturate, smoothstep } from './util.js';

export class Survival {
  constructor() {
    this.reset();
    this.onDeath = null;
    this.onHurt = null;
    this.cause = '';
    this.dead = false;
  }

  reset() {
    Object.assign(this, {
      health: 100, stamina: 100, hunger: 88, thirst: 84, warmth: 78, wet: 0, sick: 0,
      exhausted: false, injured: false, dead: false, ambient: 12, felt: 12, battery: 100, torch: false,
      shiver: 0, heat: 0,
    });
  }

  load(d) { Object.assign(this, d || {}); this.dead = false; }
  save() {
    const { health, stamina, hunger, thirst, warmth, wet, sick, battery } = this;
    return { health, stamina, hunger, thirst, warmth, wet, sick, battery };
  }

  // Degrees Celsius outdoors at a height, from the hour and the weather.
  ambientTemp(hour, y, w) {
    const daily = 8 + 6 * Math.cos(((hour - 15) / 24) * Math.PI * 2);
    return daily - (y - WORLD.lakeY) * 0.02 - 2 * w.overcast - 3 * w.storm - 1.5 * Math.min(1, w.rain);
  }

  hurt(amount, cause) {
    if (this.dead || amount <= 0) return;
    this.health -= amount;
    this.cause = cause;
    this.onHurt?.(amount, cause);
    if (this.health <= 0) { this.health = 0; this.dead = true; this.onDeath?.(cause); }
  }

  heal(amount) { this.health = clamp(this.health + amount, 0, 100); }
  eat(hunger, thirst = 0) { this.hunger = clamp(this.hunger + hunger, 0, 100); this.thirst = clamp(this.thirst + thirst, 0, 100); }
  drink(amount) { this.thirst = clamp(this.thirst + amount, 0, 100); }

  // ctx: { dt (real seconds), gameDt (game-seconds scaled by resting), player, hour, weather, heat (0..1.4), sheltered (0..1), jacket, resting }
  update(ctx) {
    if (this.dead) return;
    const { dt, player, weather: w } = ctx;
    const gdt = ctx.gameDt ?? dt;
    const gMin = gdt / TIME.secondsPerMinute;               // game minutes that passed this frame

    // ---- stamina ----
    const running = player.sprinting && player.speed > 3;
    if (running) this.stamina -= SURVIVAL.sprintDrain * dt * (1 + (1 - this.warmth / 100) * 0.4);
    else if (player.swimming) this.stamina -= SURVIVAL.swimDrain * dt * (player.moving ? 1 : 0.4);
    else {
      const rest = (player.moving ? 0.55 : 1) * (this.warmth < 30 ? 0.6 : 1) * (this.thirst < 15 ? 0.7 : 1) * (ctx.resting ? 2 : 1);
      this.stamina += SURVIVAL.staminaRegen * dt * rest;
    }
    if (this.stamina <= 0) { this.stamina = 0; this.exhausted = true; }
    if (this.exhausted && this.stamina > 28) this.exhausted = false;
    this.stamina = Math.min(100, this.stamina);
    if (player.swimming && this.stamina <= 0) this.hurt(6 * dt, 'You ran out of strength in the water and slipped under.');

    // ---- wetness ----
    const outdoors = 1 - (ctx.sheltered || 0);
    let wetRate = 0;
    if (player.swimming) wetRate = 0.6;
    else if (player.wading > 0.3) wetRate = 0.25 * player.wading;
    else wetRate = w.rain * 0.022 * outdoors - (0.0035 + 0.004 * w.wind + 0.03 * Math.min(1, ctx.heat)) * (w.rain < 0.1 ? 1 : 0.3);
    this.wet = clamp(this.wet + wetRate * dt, 0, 1);

    // ---- warmth ----
    const y = player.pos.y;
    this.ambient = this.ambientTemp(ctx.hour, y, w);
    const windChill = outdoors * 1.2 * (w.wind * 3 + w.storm * 2);
    let felt = this.ambient - windChill - 6 * this.wet + (ctx.jacket ? 6 : 0) + ctx.heat * 15 + (ctx.sheltered || 0) * 6 + (running ? 2.5 : 0);
    if (player.swimming) felt -= 8;
    this.felt = felt;
    const target = clamp(50 + (felt - 8) * 3.6, 0, 100);
    const tau = target > this.warmth ? (ctx.heat > 0.2 ? 30 : 110) : 190;
    this.warmth += (target - this.warmth) * (1 - Math.exp(-gdt / tau));
    this.shiver = smoothstep(32, 8, this.warmth);
    this.heat = ctx.heat;

    // ---- hunger and thirst ----
    const work = running ? 2 : player.moving ? 1.2 : 0.8;
    this.hunger = clamp(this.hunger - SURVIVAL.hungerPerMin * work * gMin, 0, 100);
    this.thirst = clamp(this.thirst - SURVIVAL.thirstPerMin * (running ? 1.9 : 1) * (this.sick > 0 ? 1.6 : 1) * gMin, 0, 100);

    // ---- sickness from bad water ----
    if (this.sick > 0) { this.sick = Math.max(0, this.sick - gdt); this.hurt(0.1 * dt, 'The water you drank made you seriously ill.'); }

    // ---- damage and recovery ----
    if (this.hunger <= 0) this.hurt(SURVIVAL.starveDamage * dt * 0.5, 'You starved.');
    if (this.thirst <= 0) this.hurt(SURVIVAL.starveDamage * dt, 'You collapsed from thirst.');
    if (this.warmth < 8) this.hurt(0.55 * dt * (1 - this.warmth / 8 + 0.3), 'The cold got you. You stopped shivering, and then you stopped.');
    if (this.hunger > 25 && this.thirst > 25 && this.warmth > 40 && this.sick <= 0) {
      this.health = Math.min(100, this.health + SURVIVAL.healRate * dt * (ctx.resting ? 3 : 1));
    }

    // ---- flashlight ----
    if (this.torch) {
      this.battery -= (100 / (SURVIVAL.flashlightMinutes * 60)) * gdt;
      if (this.battery <= 0) { this.battery = 0; this.torch = false; }
    }

    this.injured = this.health < 40;
    player.speedMul = 1 - (this.warmth < 25 ? 0.12 : 0) - (this.health < 30 ? 0.18 : 0) - (this.exhausted ? 0.1 : 0);
    player.canSprint = !this.exhausted && this.stamina > 0;
    player.canJump = this.stamina > 6 || player.swimming;
    player.fatigue = clamp(1 - this.stamina / 55, 0, 1);
  }
}
