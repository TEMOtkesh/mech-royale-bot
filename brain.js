// Mech Royale brain: plain JS, runs in bun (submission) and in the browser (test harness).
// makeBot(hello, mapFiles, params) -> { name, act(obs) -> action }
// mapFiles = { world: <parsed world.json>, terrain: <ArrayBuffer of terrain.i16> }

const CELL = 4.0
const TAU = Math.PI * 2
const hyp = Math.hypot
const angDiff = (a, b) => ((a - b + Math.PI) % TAU + TAU) % TAU - Math.PI
const norm2 = (x, y) => { const l = hyp(x, y); return l > 1e-6 ? [x / l, y / l] : [0, 0] }
const dist3 = (a, b) => hyp(a[0] - b[0], a[1] - b[1], (a[2] || 0) - (b[2] || 0))
const dist2 = (a, b) => hyp(a[0] - b[0], a[1] - b[1])
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

export const DEFAULTS = {
  strategy: "prey",
  retreat_hp: 0.38,
  engage_range: 170,
  loot_radius: 70,
  zone_margin: 0.55,
  upgrade_order: ["plating", "armor", "nanites", "gun_damage", "laser_damage", "gun_rate", "laser_charge", "sensors",
    "gyros", "capacitor", "reactor", "jets", "servos", "gun_mag", "gun_velocity", "mortar_reload",
    "lightning_efficiency", "lightning_range", "lightning_chain", "mortar_splash", "mortar_velocity", "laser_pierce"],
  weapon_pref: { laser: 3, lightning: 2, mortar: 0 },
  laser_seek: 160,
  weapon_seek: 70,
  cube_cap: 99,
  lightning_min_energy: 25,
  drop_gun: false,        // allow laser + lightning loadout (drop the arm gun)
  squad_after: 45,        // walk this far for a laser when safe
  squad_override: null,   // merged into params once practice-squad mode is confirmed
  ffa_override: null,     // merged into params once free-for-all is detected
  farm_npcs: true,
  strafe: true,
  expose_w: 3.0,
  cover_w: 0.6,
  hunt_hp: 0.6,
  prey_fire_range: 120,
  slow_walk: true,
  drift: true,
  hunt_after: 0,
  peek: false,           // corner-peek dueling: shoot from a peek spot, hide to reload/regen
  peek_hide_hp: 0.55,
  roof: false,           // camp on a roof inside the zone
  roof_min_h: 14, roof_max_h: 48, roof_fire: true, roof_center_w: 0.25,
  idle: false,
  stick: 70,
  lead_k: 1.0, vel_ema: 1.0, gun_tol: 1.6, tac_reload: false, aim_latency: 0,
  gun_select: false, gun_select_min: 50, gun_select_k: 0.5,
  grab_cubes: 0,
  laser_direct: true,
  aim_noise: 0,
  dodge: true,
  jink: 0, jink_min: 0.25, jink_max: 0.6,
  kite: false, kite_range: 90, keep_fight: false,
  bdodge: false, bdodge_reach: 3.6, bdodge_t: 0.6, bdodge_hold: 0.35,
  hostile_only: false, hostile_ang: 0.2, hostile_near: 60, hostile_mem: 4,
  short_retreat: 0, lethal: false, lethal_k: 0.8,
  opp: false, opp_late: 4, opp_range: 130, fight_boost: false, aim_risk: 0, near_risk: 0,
  ammo_track: false, pick_mem: false, pick_mem_empty: 160, pick_mem_swap: 90,
  fightmove: false, fr_gun: 88, fr_laser: 115, fr_light: 28, fr_range_w: 1.0, fr_los_w: 40, fr_expose_w: 28, fr_strafe_w: 8, fr_aim_w: 0, ghost_fight: false, iso_press: 0, tgt_hpw: 90, tgt_low: 0, finish_fm: 0, tgt_need_los: false, finish_crowd: 0, finish_min_hp: 0.35, drops: true, grab_safe: false, late_base_t: 0, late_override: null,
  overwhelm: 3, overwhelm_hp: 0.9,
  fortress: false, fort_open: 5, fort_arms: 1, fort_after: 60,
  econ: false, econ_radius: 180, econ_hp: 0.5, econ_cubes: 10,
  finish: false, finish_hp: 0.4,
  recover_hp: 0.7,
  precharge: true,           // experiment: stand still, never fire
  ghost: false,          // never fire unless we were hit in the last 3 s
  shoot_crates: true,
}
export const STRATS = {
  prey: {},
  predator: { retreat_hp: 0.32, engage_range: 230, expose_w: 1.0, loot_radius: 90 },
}

// ---------------------------------------------------------------- world model
function pip(x, y, ring) {
  let inside = false
  const n = ring.length >> 1
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[2 * i], yi = ring[2 * i + 1], xj = ring[2 * j], yj = ring[2 * j + 1]
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi) inside = !inside
  }
  return inside
}

export class World {
  constructor(w, terrainBuf) {
    const t = w.terrain
    this.tnx = t.nx; this.tny = t.ny; this.tminx = t.minX; this.tminy = t.minY; this.tstep = t.step
    this.terr = new Int16Array(terrainBuf.slice ? terrainBuf.slice(0, 2 * t.nx * t.ny) : terrainBuf)
    const b = w.bounds
    this.minx = b.minX; this.miny = b.minY; this.maxx = b.maxX; this.maxy = b.maxY
    this.nx = Math.floor((this.maxx - this.minx) / CELL) + 1
    this.ny = Math.floor((this.maxy - this.miny) / CELL) + 1
    const N = this.nx * this.ny
    this.ground = new Float32Array(N)
    for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) {
      const [x, y] = this.cellCenter(i, j)
      this.ground[j * this.nx + i] = this.height(x, y)
    }
    this.btop = new Float32Array(N).fill(-1e9)
    this.bbase = new Float32Array(N).fill(1e9)
    this.block = new Uint8Array(N)
    this.roofs = []
    for (const p of w.prisms) {
      const ring = p.ring, holes = p.holes || []
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9
      for (let k = 0; k < ring.length; k += 2) { x0 = Math.min(x0, ring[k]); x1 = Math.max(x1, ring[k]); y0 = Math.min(y0, ring[k + 1]); y1 = Math.max(y1, ring[k + 1]) }
      const [i0, j0] = this.cellOf(x0, y0), [i1, j1] = this.cellOf(x1, y1)
      let cnt = 0, sx = 0, sy = 0
      for (let j = Math.max(0, j0); j <= Math.min(this.ny - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(this.nx - 1, i1); i++) {
        const [cx, cy] = this.cellCenter(i, j)
        if (!pip(cx, cy, ring)) continue
        if (holes.some((h) => h && h.length && pip(cx, cy, h))) continue
        const k = j * this.nx + i
        if (p.top > this.btop[k]) this.btop[k] = p.top
        if (p.base < this.bbase[k]) this.bbase[k] = p.base
        const g = this.ground[k]
        if (p.base < g + 9.5 && p.top > g + 1.2) this.block[k] = 1
        cnt++; sx += cx; sy += cy
      }
      if (p.kind === "building" && cnt >= 20) {
        const cx = sx / cnt, cy = sy / cnt
        // roof spot: building cell nearest the centroid that has building cells all around (away from edges)
        let best = null, bd = 1e18
        for (let j = Math.max(0, j0); j <= Math.min(this.ny - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(this.nx - 1, i1); i++) {
          const [x, y] = this.cellCenter(i, j)
          if (!pip(x, y, ring)) continue
          let inner = 0
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const [xx, yy] = this.cellCenter(i + di, j + dj); if (pip(xx, yy, ring)) inner++ }
          if (inner < 9) continue
          const dd = hyp(x - cx, y - cy)
          if (dd < bd) { bd = dd; best = [x, y] }
        }
        if (best) this.roofs.push({ x: best[0], y: best[1], top: p.top, ground: this.height(best[0], best[1]), cells: cnt, ring })
      }
    }
    this.cost = new Float32Array(N).fill(1)
    for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) {
      const k = j * this.nx + i
      if (this.block[k]) continue
      let c = 1
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj
        if (ii >= 0 && ii < this.nx && jj >= 0 && jj < this.ny && this.block[jj * this.nx + ii]) c = 2.5
      }
      this.cost[k] = c
    }
  }
  cellOf(x, y) { return [Math.floor((x - this.minx) / CELL), Math.floor((y - this.miny) / CELL)] }
  cellCenter(i, j) { return [this.minx + (i + 0.5) * CELL, this.miny + (j + 0.5) * CELL] }
  inb(i, j) { return i >= 0 && i < this.nx && j >= 0 && j < this.ny }
  height(x, y) {
    const fx = (x - this.tminx) / this.tstep, fy = (y - this.tminy) / this.tstep
    const i = clamp(Math.floor(fx), 0, this.tnx - 2), j = clamp(Math.floor(fy), 0, this.tny - 2)
    const ax = clamp(fx - i, 0, 1), ay = clamp(fy - j, 0, 1), n = this.tnx, t = this.terr
    const h00 = t[j * n + i], h10 = t[j * n + i + 1], h01 = t[(j + 1) * n + i], h11 = t[(j + 1) * n + i + 1]
    return ((h00 * (1 - ax) + h10 * ax) * (1 - ay) + (h01 * (1 - ax) + h11 * ax) * ay) * 0.01
  }
  blockedAt(x, y) {
    const [i, j] = this.cellOf(x, y)
    return !this.inb(i, j) || this.block[j * this.nx + i] === 1
  }
  enclosure(x, y, rays = 24, maxd = 80) {
    // distance to the first building along each ray; returns {mean, open, dir}
    let sum = 0, open = 0, ox = 0, oy = 0
    for (let r = 0; r < rays; r++) {
      const a = (r / rays) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a)
      let d = 4
      for (; d < maxd; d += 4) if (this.blockedAt(x + c * d, y + s * d)) break
      sum += d
      if (d >= maxd) { open++; ox += c; oy += s }
    }
    return { mean: sum / rays / maxd, open, dir: Math.atan2(oy, ox) }
  }
  roofAt(x, y) { // top of building under (x,y) or null
    const [i, j] = this.cellOf(x, y)
    if (!this.inb(i, j)) return null
    const k = j * this.nx + i
    return this.btop[k] > -1e8 ? this.btop[k] : null
  }
  los(a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2]
    const d = hyp(dx, dy)
    const steps = Math.floor(d / (CELL * 0.7)) + 1
    for (let s = 1; s < steps; s++) {
      const f = s / steps
      const x = a[0] + dx * f, y = a[1] + dy * f, z = a[2] + dz * f
      const i = Math.floor((x - this.minx) / CELL), j = Math.floor((y - this.miny) / CELL)
      if (i < 0 || i >= this.nx || j < 0 || j >= this.ny) return false
      const k = j * this.nx + i
      if (this.bbase[k] < z && z < this.btop[k]) return false
      if (z < this.ground[k] - 0.5) return false
    }
    return true
  }
  nearestFree(i, j) {
    if (this.inb(i, j) && !this.block[j * this.nx + i]) return [i, j]
    for (let r = 1; r < 14; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const ii = i + di, jj = j + dj
      if (this.inb(ii, jj) && !this.block[jj * this.nx + ii]) return [ii, jj]
    }
    return [i, j]
  }
  path(start, goal, maxExp = 4000) {
    const [si, sj] = this.nearestFree(...this.cellOf(start[0], start[1]))
    const [gi, gj] = this.nearestFree(...this.cellOf(goal[0], goal[1]))
    const nx = this.nx, s = sj * nx + si, g = gj * nx + gi
    if (s === g) return [[goal[0], goal[1]]]
    const gs = new Map([[s, 0]]), came = new Map()
    const heap = new MinHeap()
    heap.push(0, s)
    let best = s, bestd = 1e18, exp = 0
    const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]]
    while (heap.size && exp < maxExp) {
      const cur = heap.pop()
      if (cur === g) { best = g; break }
      exp++
      const ci = cur % nx, cj = (cur - ci) / nx
      const hd = hyp(ci - gi, cj - gj)
      if (hd < bestd) { bestd = hd; best = cur }
      const gc = gs.get(cur)
      for (const [di, dj, w] of DIRS) {
        const ii = ci + di, jj = cj + dj
        if (ii < 0 || ii >= nx || jj < 0 || jj >= this.ny) continue
        const k = jj * nx + ii
        if (this.block[k]) continue
        if (di && dj && (this.block[cj * nx + ii] || this.block[jj * nx + ci])) continue
        const ng = gc + w * this.cost[k]
        if (ng < (gs.has(k) ? gs.get(k) : 1e18)) {
          gs.set(k, ng); came.set(k, cur)
          heap.push(ng + hyp(ii - gi, jj - gj) * 1.05, k)
        }
      }
    }
    const out = []
    let cur = best
    while (came.has(cur)) { out.push(this.cellCenter(cur % nx, Math.floor(cur / nx))); cur = came.get(cur) }
    out.reverse()
    if (best === g) out.push([goal[0], goal[1]])
    return out.length ? out : [[goal[0], goal[1]]]
  }
}

class MinHeap {
  constructor() { this.k = []; this.v = [] }
  get size() { return this.k.length }
  push(key, val) {
    const k = this.k, v = this.v
    let i = k.length; k.push(key); v.push(val)
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p }
    k[i] = key; v[i] = val
  }
  pop() {
    const k = this.k, v = this.v, top = v[0], lk = k.pop(), lv = v.pop()
    if (k.length) {
      let i = 0; const n = k.length
      for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && k[c + 1] < k[c]) c++; if (k[c] >= lk) break; k[i] = k[c]; v[i] = v[c]; i = c }
      k[i] = lk; v[i] = lv
    }
    return top
  }
}

// ---------------------------------------------------------------- RNG
function mulberry(seed) {
  let a = seed >>> 0
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

// ---------------------------------------------------------------- the bot
export function makeBot(hello, mapFiles, override = {}) {
  const P = { ...DEFAULTS, ...(STRATS[override.strategy || DEFAULTS.strategy] || {}), ...override }
  const cfg = hello.config
  const rnd = mulberry(hello.seed || 1)
  const uni = (a, b) => a + (b - a) * rnd()
  let world = null
  try { world = new World(mapFiles.world, mapFiles.terrain) } catch (e) { (P.log || (() => {}))("map fail " + e) }
  const S = {
    path: [], pathGoal: null, pathT: -99, lastAlive: 16, unexplained: 0, ffa: false,
    strafeDir: 1, strafeT: 0, stuckT: 0, unstickUntil: 0, unstickDir: [1, 0],
    threats: new Map(), lastDamagedT: -99, lastDamageBearing: null, tracked: new Map(),
    rp: null, rpUntil: 0, hist: [], mode: "", label: "",
  }
  S.baseP = JSON.parse(JSON.stringify(P))
  const bot = { name: P.name || "kesh-mech", P, S, world }

  function updateMode(obs) {
    const kills = obs.events.filter((e) => e.type === "kill").length
    const drop = S.lastAlive - obs.alive
    if (drop > kills) { S.unexplained += drop - kills; if (S.unexplained >= 2 && !S.ffa) { S.ffa = true; S.squad = false; Object.assign(P, S.baseP, P.ffa_override || {}) } }
    if (!S.ffa && !S.squad && obs.t > P.squad_after && S.unexplained === 0) { S.squad = true; if (P.squad_override) Object.assign(P, P.squad_override) }
    // late practice: every remaining hunter is coming, so drop back to the cautious base play (fight only what attacks us)
    if (S.squad && !S.ffa && P.late_base_t && obs.t > P.late_base_t && !S.lateBase) { S.lateBase = true; Object.assign(P, S.baseP, P.late_override || {}) }
    S.lastAlive = obs.alive
  }

  function pickUpgrade(offer) {
    let best = 1e9, bi = 0
    offer.choices.forEach((c, i) => { const r = P.upgrade_order.indexOf(c.id); const rr = r < 0 ? 50 : r; if (rr < best) { best = rr; bi = i } })
    return bi
  }

  const wval = (k) => (k === null ? -1 : k === "gun" ? (P.drop_gun ? 1.5 : 99) : (P.weapon_pref[k] || 0))
  function worstSlot(me) {
    let wi = -1, wv = 1e9
    me.weapons.forEach((w, i) => {
      const v = w ? wval(w.kind) : -1
      const charging = w && w.kind === "laser" && (w.charge || 0) > 0
      if (!charging && v < wv) { wv = v; wi = i }
    })
    return [wi, wv]
  }
  function takeLoot(obs, act) {
    const me = obs.self, pos = me.pos, reach = cfg.loot.pickup_radius
    const held = me.weapons.map((w) => (w ? w.kind : null))
    const [wi, wv] = worstSlot(me)
    for (const p of obs.pickups || []) {
      if (dist2(p.pos, pos) < reach - 0.3 && Math.abs(p.pos[2] - pos[2]) < 3.8) {
        const k = p.kind
        if (held.includes(k)) continue
        const v = wval(k)
        if (v <= 0 || wi < 0 || v <= wv) continue
        act.take = p.id
        if (held[wi] !== null) act.drop = wi
        return
      }
    }
  }

  function hostile(m, me, d) {
    // practice squad: passive members leave us alone unless provoked, so only fight the ones coming for us
    if (S.threats.has(m.id) && S.T - S.threats.get(m.id)[0] < 6) return true
    if (m.id === S.targetId || m.id === S.finishId || d < P.hostile_near) return true
    if (S.late) return true
    if (S.hostileT && S.hostileT.has(m.id) && S.T - S.hostileT.get(m.id) < P.hostile_mem) return true
    const hpf = (m.hp ?? 1400) / Math.max(1, m.max_hp ?? 1400)
    let why = hpf < 0.4 && d < 160
    const ux = (me.pos[0] - m.pos[0]) / Math.max(d, 1), uy = (me.pos[1] - m.pos[1]) / Math.max(d, 1)
    if (!why && m.vel && d < 180 && m.vel[0] * ux + m.vel[1] * uy > 3) why = true
    if (!why && m.aim && d < 190 && Math.abs(angDiff(m.aim[0], Math.atan2(uy, ux))) < Math.max(P.hostile_ang, Math.atan2(5, d))) why = true
    if (why) { S.hostileT = S.hostileT || new Map(); S.hostileT.set(m.id, S.T) }
    return why
  }

  function oppOK(m, me, d) {
    // free-for-all opportunist: fight what attacks us, what is nearly dead, or what is busy shooting someone else
    if (S.threats.has(m.id) && S.T - S.threats.get(m.id)[0] < 6) return true
    if (d < 40 || m.id === S.targetId || m.id === S.finishId || S.alive <= P.opp_late) return true
    const hpf = (m.hp ?? 1400) / Math.max(1, m.max_hp ?? 1400), my = me.hp / Math.max(1, me.max_hp)
    if (hpf < 0.45 && d < 160 && my > 0.35) return true
    const toMe = Math.atan2(me.pos[1] - m.pos[1], me.pos[0] - m.pos[0])
    const hasL = me.weapons.some((w) => w && w.kind === "laser")
    if (m.aim && Math.abs(angDiff(m.aim[0], toMe)) > 0.7 && d < P.opp_range && (hasL || my > 0.7) && my > 0.5) return true
    return false
  }

  function losing(me, enemies, target, hpFrac) {
    // short retreat signal: outnumbered while hurt, or clearly out-traded by the one we're fighting
    const near = enemies.filter((m) => dist2(m.pos, me.pos) < 160).length
    let lose = (near >= 2 && hpFrac < 0.55) || (near >= 3 && hpFrac < 0.8)
    if (target) {
      const tf = (target.hp ?? 1400) / Math.max(1, target.max_hp ?? 1400)
      if (hpFrac < 0.35 && tf > hpFrac + 0.1) lose = true
      if (tf < 0.25 && hpFrac > 0.2 && near <= 2) lose = false
    }
    return lose
  }

  function chooseTarget(me, enemies) {
    let best = null, bs = 1e18, cur = null, cs = 1e18
    for (const m of enemies) {
      const d = dist3(m.pos, me.pos)
      if (d > 260) continue
      if (P.hostile_only && S.squad && !hostile(m, me, d)) continue
      if (P.opp && !S.squad && !oppOK(m, me, d)) continue
      const hpf = (m.hp ?? 1400) / Math.max(1, m.max_hp ?? 1400)
      let s = d + hpf * P.tgt_hpw - (hpf < 0.3 ? P.tgt_low : 0)
      if (S.threats.has(m.id)) s -= 60
      const mine = me.weapons.filter(Boolean).map((w) => w.kind), theirs = m.weapons || []
      if (mine.includes("laser") && theirs.includes("mortar")) s -= 40      // cook-off +60%
      if (mine.includes("lightning") && theirs.includes("laser") && d < 50) s -= 40  // short their laser
      if (world && !world.los([me.pos[0], me.pos[1], me.pos[2] + 7], [m.pos[0], m.pos[1], m.pos[2] + 4.5])) { if (P.tgt_need_los && m.id !== S.targetId) continue; s += 120 }
      if (s < bs) { bs = s; best = m }
      if (m.id === S.targetId) { cur = m; cs = s }
    }
    if (S.finishId != null) { const f = enemies.find((m) => m.id === S.finishId); if (f) { S.targetId = f.id; return f } }
    // stickiness: don't thrash between targets (finish what we started)
    if (cur && cs < bs + P.stick) best = cur
    S.targetId = best ? best.id : null
    return best
  }

  function zoneGoal(obs, pos) {
    const z = obs.zone, nc = z.next_center, nr = z.next_radius
    const dx = pos[0] - nc[0], dy = pos[1] - nc[1], d = hyp(dx, dy)
    let keep = nr * P.zone_margin
    if (nr < 30) keep = nr * 0.3
    if (d <= keep) return null
    const f = keep / Math.max(d, 1e-6)
    return [nc[0] + dx * f, nc[1] + dy * f]
  }

  function zoneUrgent(obs, pos) {
    const z = obs.zone, nc = z.next_center, nr = z.next_radius
    const d = dist2(pos, nc)
    const need = d - nr * P.zone_margin
    const left = z.shrink_end - obs.t
    return need > 0 && (need / 10 > left - 15 || !obs.self.in_zone)
  }

  function remember(obs) {
    const t = obs.t
    S.npcMem = S.npcMem || new Map(); S.crateMem = S.crateMem || new Map()
    for (const m of obs.mechs) if (m.kind === "npc") S.npcMem.set(m.id, { pos: m.pos, t, hp: m.hp })
    for (const c of obs.crates || []) S.crateMem.set(c.id, { pos: c.pos, t, hp: c.hp })
    const p = obs.self.pos
    // forget things we should be seeing but aren't (destroyed / moved)
    for (const [k, v] of S.crateMem) if (t - v.t > 60 || (dist2(v.pos, p) < 30 && t - v.t > 1)) S.crateMem.delete(k)
    for (const [k, v] of S.npcMem) if (t - v.t > 90 || (dist2(v.pos, p) < 35 && t - v.t > 2)) S.npcMem.delete(k)
    // weapon pickups stay on the ground until someone takes them: remember them after they leave view
    S.pickMem = S.pickMem || new Map()
    for (const k of obs.pickups || []) S.pickMem.set(k.id, { kind: k.kind, pos: k.pos, t })
    for (const [k, v] of S.pickMem) if (t - v.t > 120 || (dist2(v.pos, p) < 25 && t - v.t > 0.5)) S.pickMem.delete(k)
  }

  function econGoal(obs, me) {
    const pos = me.pos
    let best = null, bs = 1e18
    for (const [k, v] of S.crateMem) {
      if (Math.abs(v.pos[2] - world.height(v.pos[0], v.pos[1])) > 3) continue  // skip rooftop crates
      const d = dist2(v.pos, pos)
      if (d > P.econ_radius) continue
      const s = d / 1.0
      if (s < bs) { bs = s; best = { kind: "crate", v, d } }
    }
    for (const [k, v] of S.npcMem) {
      const d = dist2(v.pos, pos)
      if (d > P.econ_radius) continue
      const s = d / 2.0   // drones are worth 2 cubes
      if (s < bs) { bs = s; best = { kind: "npc", v, d } }
    }
    if (!best) return null
    const stand = best.kind === "npc" ? 55 : 30
    if (best.d <= stand + 5) return [[pos[0], pos[1]], "farm"]
    const [ux, uy] = norm2(pos[0] - best.v.pos[0], pos[1] - best.v.pos[1])
    return [[best.v.pos[0] + ux * stand, best.v.pos[1] + uy * stand], "farm"]
  }

  function track(obs, enemies) {
    const t = obs.t
    for (const m of enemies) {
      const prev = S.tracked.get(m.id), v = m.vel || [0, 0, 0]
      let ev = v
      if (prev && prev.src === "see" && prev.ev && t - prev.t < 0.5) { const k = P.vel_ema; ev = [prev.ev[0] * (1 - k) + v[0] * k, prev.ev[1] * (1 - k) + v[1] * k, v[2]] }
      S.tracked.set(m.id, { pos: m.pos, vel: v, ev, hp: m.hp ?? 1400, max_hp: m.max_hp ?? 1400, t, src: "see", aim: m.aim })
    }
    const me = obs.self.pos
    const dmap = { near: 40, mid: 110, far: 230 }
    let n = 0
    for (const snd of obs.sounds || []) {
      if (!["gun", "laser", "laser_charge", "lightning", "mortar", "step", "boost", "jet", "reload"].includes(snd.kind)) continue
      const d = dmap[snd.dist]
      const p = [me[0] + Math.cos(snd.bearing) * d, me[1] + Math.sin(snd.bearing) * d, me[2]]
      let dup = false
      for (const v of S.tracked.values()) if (v.src === "see" && t - v.t < 1 && dist2(v.pos, p) < 30) { dup = true; break }
      if (dup) continue
      n++
      S.tracked.set("s" + n, { pos: p, vel: [0, 0, 0], hp: 1200, max_hp: 1400, t, src: "snd", kind: snd.kind, dist: snd.dist })
    }
    for (const [k, v] of S.tracked) if (t - v.t > 8) S.tracked.delete(k)
  }
  const known = (t, maxAge) => [...S.tracked.values()].filter((v) => t - v.t <= maxAge)

  function optRange(me) {
    const kinds = me.weapons.filter(Boolean).map((w) => w.kind)
    if (kinds.includes("laser") && kinds.includes("lightning")) return 40
    if (kinds.includes("laser")) return 150
    if (kinds.includes("lightning")) return 35
    if (kinds.includes("mortar")) return 120
    return 90
  }

  function weaponIntel(obs, me, enemies) {
    // per-enemy weapon state from what we hear and see: count gun shots (mag 12, then a 2.4 s reload), reload sounds, laser beams (1.65 s cooldown)
    const t = obs.t, W = (S.ew = S.ew || new Map())
    const get = (id) => { let e = W.get(id); if (!e) { e = { shots: 0, reloadUntil: -1, laserUntil: -1, lastShot: -1 }; W.set(id, e) } return e }
    const gcfg = cfg.weapons.gun, lcfg = cfg.weapons.laser
    const rng = { near: [0, 70], mid: [50, 175], far: [150, 400] }
    const mechs = enemies.filter((m) => m.kind === "mech")
    for (const snd of obs.sounds || []) {
      if (snd.kind !== "gun" && snd.kind !== "reload") continue
      const [lo, hi] = rng[snd.dist] || [0, 400]
      let hit = null, n = 0
      for (const m of mechs) {
        const d = dist2(m.pos, me.pos)
        if (d < lo || d > hi) continue
        if (Math.abs(angDiff(snd.bearing, Math.atan2(m.pos[1] - me.pos[1], m.pos[0] - me.pos[0]))) < 0.21) { hit = m; n++ }
      }
      if (n !== 1) continue
      const e = get(hit.id), at = t - (snd.age || 0)
      if (snd.kind === "reload") { e.reloadUntil = at + gcfg.reload; e.shots = 0; continue }
      if (at < e.reloadUntil - 0.2) continue
      e.shots++; e.lastShot = at
      if (e.shots >= gcfg.mag) { e.reloadUntil = at + gcfg.reload; e.shots = 0 }
    }
    for (const b of obs.beams || []) if (b.kind === "laser" && b.by != null) get(b.by).laserUntil = t - (b.age || 0) + lcfg.cooldown
  }

  function vulnerable(m, t) {
    // the target's gun is empty and its laser (if any) is cooling down or absent
    const e = S.ew && S.ew.get(m.id)
    if (!e) return false
    const hasL = (m.weapons || []).includes("laser")
    return e.reloadUntil > t + 0.3 && (!hasL || e.laserUntil > t + 0.3)
  }

  function prefRange(me, target) {
    const kinds = me.weapons.filter(Boolean).map((w) => w.kind), theirs = target.weapons || []
    let r = P.fr_gun
    if (kinds.includes("lightning") && me.energy > 15) r = P.fr_light
    else if (kinds.includes("laser")) r = P.fr_laser
    if (!kinds.includes("lightning")) {
      if (theirs.includes("lightning")) r = Math.max(r, 62)
      if (theirs.includes("mortar")) r = Math.max(r, 78)
    }
    return r
  }

  function fightPoint(obs, me, target, enemies, hpFrac) {
    // local position search each tick: hold a preferred range, keep the shot, stay out of other mechs' sight, keep moving sideways
    const t = obs.t, pos = me.pos, z = obs.zone
    let pref = S.prefOverride || prefRange(me, target) * (P.ammo_track && vulnerable(target, t) ? 0.7 : 1)
    const tc = [target.pos[0], target.pos[1], target.pos[2] + 4.5]
    const bx = target.pos[0] - pos[0], by = target.pos[1] - pos[1], bd = hyp(bx, by) || 1
    if (t >= (S.fsUntil ?? -1)) { if (!S.fsDir || rnd() < 0.6) S.fsDir = -(S.fsDir || (rnd() < 0.5 ? 1 : -1)); S.fsUntil = t + uni(0.3, 1.0) }
    const sx = -by / bd * S.fsDir, sy = bx / bd * S.fsDir
    const gun = me.weapons[0]
    const reloading = gun && gun.kind === "gun" && ((gun.reload ?? 0) > 0 || gun.ammo === 0)
    const vuln = P.ammo_track && vulnerable(target, t)
    const wantLos = vuln || !(reloading && !weaponReady(me) && hpFrac < 0.5)
    const others = [...S.tracked.entries()].filter(([id, v]) => id !== target.id && v.src === "see" && t - v.t <= 3 && dist2(v.pos, pos) < 200).map(([, v]) => v)
    // an isolated attacker is the cheapest kill on the map: press it at closer range while we are healthy
    if (P.iso_press && !others.length && hpFrac > 0.6) pref *= P.iso_press
    let best = null, bs = -1e18, blockedSide = false
    for (let k = -1; k < 32; k++) {
      let cx = pos[0], cy = pos[1], r = 0, dx = 0, dy = 0
      if (k >= 0) {
        const a = (k % 16) * Math.PI / 8; r = k < 16 ? 6 : 12
        dx = Math.cos(a); dy = Math.sin(a); cx = pos[0] + dx * r; cy = pos[1] + dy * r
        if (world && (world.blockedAt(cx, cy) || !walkClear(pos, [cx, cy]))) { if (k < 16 && dx * sx + dy * sy > 0.9) blockedSide = true; continue }
      }
      const gz = world ? world.height(cx, cy) : pos[2]
      const d = hyp(target.pos[0] - cx, target.pos[1] - cy)
      let sc = -P.fr_range_w * Math.abs(d - pref) - 0.3 * r
      const los = world ? world.los([cx, cy, gz + 7], tc) : true
      sc += (los === wantLos) ? P.fr_los_w : 0
      for (const e of others) {
        if (!world || world.los([e.pos[0], e.pos[1], e.pos[2] + 8], [cx, cy, gz + 5])) {
          sc -= P.fr_expose_w
          // danger by gun direction: standing on another mech's aim line is worse than merely being visible to it
          if (P.fr_aim_w && e.aim && Math.abs(angDiff(e.aim[0], Math.atan2(cy - e.pos[1], cx - e.pos[0]))) < 0.2) sc -= P.fr_aim_w
        }
      }
      const dz = hyp(cx - z.next_center[0], cy - z.next_center[1])
      if (dz > z.next_radius * 0.9) sc -= (dz - z.next_radius * 0.9) * 0.4
      if (hyp(cx - z.center[0], cy - z.center[1]) > z.radius - 4) sc -= 60
      if (world) { let nb = 0; for (const [ox, oy] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) if (world.blockedAt(cx + ox, cy + oy)) nb++; sc -= nb * 3 }
      if (k >= 0) sc += P.fr_strafe_w * (dx * sx + dy * sy)
      else sc -= 6
      if (sc > bs) { bs = sc; best = [cx, cy] }
    }
    if (blockedSide) { S.fsDir = -S.fsDir; S.fsUntil = t + 0.5 }
    S.duelState = "rfight"
    return best || [pos[0], pos[1]]
  }

  function riskPoint(obs, me, target) {
    const t = obs.t, pos = me.pos
    if (S.rp && t < S.rpUntil && dist2(S.rp, pos) > 3) return S.rp
    const z = obs.zone, nc = z.next_center, nr = z.next_radius, cc = z.center, cr = z.radius
    const kn = known(t, 6)
    const myhp = Math.max(me.hp, 1)
    const cands = [[pos[0], pos[1]]]
    for (const r of [12, 25, 40, 60]) for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4 + uni(-0.3, 0.3)
      cands.push([pos[0] + Math.cos(a) * r, pos[1] + Math.sin(a) * r])
    }
    const opt = target ? optRange(me) : null
    let best = null, bs = 1e18
    for (const [x, y] of cands) {
      if (world && world.blockedAt(x, y)) continue
      let risk = 0
      const gz = world ? world.height(x, y) : pos[2]
      const eye = [x, y, gz + 8]
      for (const e of kn) {
        const [ex, ey, ez] = e.pos
        const d2 = Math.max((x - ex) ** 2 + (y - ey) ** 2, 25)
        const ratio = clamp(e.hp / myhp, 0.3, 2)
        const perp = Math.abs(Math.cos(Math.atan2(pos[1] - y, pos[0] - x) - Math.atan2(ey - y, ex - x)))
        risk += ratio * (1 + perp) / d2 * 2e4
        if (e.src === "see" && world && d2 < 240 * 240 && world.los(eye, [ex, ey, ez + 8])) risk += P.expose_w * ratio / (1 + Math.sqrt(d2) / 120)
        if (P.aim_risk && e.aim && d2 < 260 * 260 && Math.abs(angDiff(e.aim[0], Math.atan2(y - ey, x - ex))) < 0.26) risk += P.aim_risk * ratio
        if (P.near_risk) {
          // melee rule: a mech shoots whoever is closest to it, so don't be anyone's nearest target
          let closer = 0
          for (const o of kn) if (o !== e && (o.pos[0] - ex) ** 2 + (o.pos[1] - ey) ** 2 < d2) { closer++; if (closer > 0) break }
          if (!closer) risk += P.near_risk * ratio / (1 + Math.sqrt(d2) / 150)
        }
      }
      const dz = hyp(x - nc[0], y - nc[1])
      if (dz > nr * 0.85) risk += 2 + (dz - nr * 0.85) * 0.05
      if (hyp(x - cc[0], y - cc[1]) > cr - 5) risk += 20
      if (world) {
        const [i, j] = world.cellOf(x, y)
        let walls = 0
        for (const dj of [-2, 0, 2]) for (const di of [-2, 0, 2]) if (world.inb(i + di, j + dj) && world.block[(j + dj) * world.nx + i + di]) walls++
        risk -= P.cover_w * Math.min(walls, 3) * 0.3
      }
      for (const [hx, hy] of S.hist.slice(-6)) risk += 0.4 / Math.max(25, (x - hx) ** 2 + (y - hy) ** 2) * 25
      risk += hyp(x - pos[0], y - pos[1]) * 0.004
      if (target && opt) {
        const td = hyp(x - target.pos[0], y - target.pos[1])
        risk += Math.abs(td - opt) * 0.02
        if (world && !world.los(eye, [target.pos[0], target.pos[1], target.pos[2] + 4.5])) risk += 1.5
      }
      if (risk < bs) { bs = risk; best = [x, y] }
    }
    if (!best) best = [pos[0], pos[1]]
    S.rp = best; S.rpUntil = t + uni(0.6, 1.4)
    S.hist.push([pos[0], pos[1]]); if (S.hist.length > 12) S.hist.shift()
    return best
  }

  function huntTarget(me) {
    let best = null, bs = 1e18, tmax = 0
    for (const v of S.tracked.values()) tmax = Math.max(tmax, v.t)
    for (const v of S.tracked.values()) {
      if (tmax - v.t > 6) continue
      const d = dist2(v.pos, me.pos)
      if (d > 260) continue
      let s = d + v.hp * 0.08
      if (v.src === "snd" && ["gun", "laser", "lightning", "mortar"].includes(v.kind)) s -= 60
      if (s < bs) { bs = s; best = v.pos }
    }
    return best
  }

  function coverPoint(pos, threatPos, bearing) {
    if (!threatPos && bearing != null) threatPos = [pos[0] + Math.cos(bearing) * 80, pos[1] + Math.sin(bearing) * 80, pos[2]]
    if (!threatPos) return [pos[0], pos[1]]
    if (!world) { const [ax, ay] = norm2(pos[0] - threatPos[0], pos[1] - threatPos[1]); return [pos[0] + ax * 40, pos[1] + ay * 40] }
    const tp = [threatPos[0], threatPos[1], threatPos[2] + 8]
    for (const r of [10, 20, 32, 45]) {
      let best = null, bs = 1e18
      for (let k = 0; k < 12; k++) {
        const a = k * Math.PI / 6, x = pos[0] + Math.cos(a) * r, y = pos[1] + Math.sin(a) * r
        if (world.blockedAt(x, y)) continue
        const zz = world.height(x, y)
        if (world.los([x, y, zz + 6], tp)) continue
        const s = r - hyp(x - threatPos[0], y - threatPos[1]) * 0.3
        if (s < bs) { bs = s; best = [x, y] }
      }
      if (best) return best
    }
    const [ax, ay] = norm2(pos[0] - threatPos[0], pos[1] - threatPos[1])
    return [pos[0] + ax * 40, pos[1] + ay * 40]
  }

  function pickRoof(obs, pos) {
    const z = obs.zone, nc = z.next_center, nr = z.next_radius
    let best = null, bs = 1e18
    for (const r of world.roofs) {
      const h = r.top - r.ground
      if (h < P.roof_min_h || h > P.roof_max_h) continue
      const dz = hyp(r.x - nc[0], r.y - nc[1])
      if (dz > nr * 0.8 && nr > 30) continue
      const s = dz * P.roof_center_w + hyp(r.x - pos[0], r.y - pos[1]) - Math.min(r.cells, 300) * 0.1
      if (s < bs) { bs = s; best = r }
    }
    return best
  }
  function onRoofOf(pos) {
    if (!world) return null
    for (const r of world.roofs) if (pos[2] > r.top - 1.5 && pos[2] < r.top + 3 && pip(pos[0], pos[1], r.ring)) return r
    return null
  }
  function roofPlan(obs, me) {
    const pos = me.pos, t = obs.t, z = obs.zone
    if (!S.roof || t > S.roofCheck) {
      const cur = S.roof
      const nc = z.next_center, nr = z.next_radius
      const stillGood = cur && (hyp(cur.x - nc[0], cur.y - nc[1]) < Math.max(nr * 0.8, 10))
      if (!stillGood) S.roof = pickRoof(obs, pos)
      S.roofCheck = t + 2
    }
    const R = S.roof
    if (!R) return null
    const inRing = pip(pos[0], pos[1], R.ring)
    if (inRing && pos[2] > R.top - 1.5) { S.climb = null; return { goal: [R.x, R.y], mode: "roof", direct: true } }
    const g0 = world.height(pos[0], pos[1])
    const onAny = pos[2] > g0 + 4 && world.roofAt(pos[0], pos[1]) !== null
    if (onAny || (S.climb && !me.grounded)) {
      return { goal: [R.x, R.y], mode: "roof_hop", direct: true, jet: R.top > pos[2] + 0.5 }
    }
    // approach the wall: nearest walkable cell to roof spot
    const [ri, rj] = world.cellOf(R.x, R.y)
    if (!S.roofBase || S.roofBase.r !== R) {
      let best = null, bd = 1e18
      for (let dj = -14; dj <= 14; dj++) for (let di = -14; di <= 14; di++) {
        const i = ri + di, j = rj + dj
        if (!world.inb(i, j) || world.block[j * world.nx + i]) continue
        const [x, y] = world.cellCenter(i, j)
        const dd = hyp(x - R.x, y - R.y) + hyp(x - pos[0], y - pos[1]) * 0.15
        if (dd < bd) { bd = dd; best = [x, y] }
      }
      S.roofBase = { r: R, p: best }
    }
    const base = S.roofBase.p
    if (!base) return null
    const db = dist2(base, pos)
    const need = (R.top - pos[2]) / 60 * 100 + 15
    if (!S.climb && db > 3) return { goal: base, mode: "to_roof" }
    if (!S.climb) {
      if (me.energy < Math.min(need, me.max_energy - 1)) return { goal: base, mode: "charge" }
      S.climb = { t0: t }
    }
    if (t - S.climb.t0 > 8) { S.climb = null; S.roofBase = null; S.roof = null; S.roofCheck = 0; return null }
    return { goal: [R.x, R.y], mode: "climb", direct: true, jet: true }
  }

  function planFort(obs, me) {
    const z = obs.zone, nc = z.next_center, nr = z.next_radius, pos = me.pos
    const R = Math.max(10, nr * 0.75)
    let best = null, bs = 1e18
    for (let k = 0; k < 220; k++) {
      const a = uni(0, Math.PI * 2), rr = Math.sqrt(rnd()) * R
      const x = nc[0] + Math.cos(a) * rr, y = nc[1] + Math.sin(a) * rr
      if (world.blockedAt(x, y)) continue
      // must hug a wall
      const [i, j] = world.cellOf(x, y)
      let wall = 0
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (world.inb(i + di, j + dj) && world.block[(j + dj) * world.nx + i + di]) wall++
      if (!wall) continue
      if (Math.abs(world.height(x, y) - pos[2]) > 25) continue
      const e = world.enclosure(x, y)
      if (e.open === 0) continue  // fully boxed in: we could not see them coming
      const s = e.mean * 10 + Math.abs(e.open - P.fort_open) * 0.6 + dist2([x, y], pos) * 0.01 + hyp(x - nc[0], y - nc[1]) / Math.max(nr, 1) * 2
      if (s < bs) { bs = s; best = { x, y, dir: e.dir, open: e.open, mean: e.mean, nc: [nc[0], nc[1]], nr } }
    }
    return best
  }
  function fortGoal(obs, me) {
    const z = obs.zone, t = obs.t
    const F = S.fort
    const stale = !F || hyp(F.x - z.next_center[0], F.y - z.next_center[1]) > z.next_radius * 0.8 || Math.abs(F.nr - z.next_radius) > 1
    if (stale && t > (S.fortPlanT || -99) + 3) { S.fort = planFort(obs, me) || S.fort; S.fortPlanT = t }
    if (!S.fort) return null
    S.fortDir = S.fort.dir
    return [[S.fort.x, S.fort.y], "fort"]
  }

  function movementGoal(obs, me, enemies, target, hpFrac, underFire) {
    const pos = me.pos, t = obs.t
    if (P.roof && world) {
      const zr = !me.in_zone && !onRoofOf(pos)
      const plan = zr ? null : roofPlan(obs, me)
      if (plan) { S.roofPlan = plan; return [plan.goal, plan.mode] }
    }
    S.roofPlan = null
    const zg = zoneGoal(obs, pos)
    if (!me.in_zone || zoneUrgent(obs, pos)) return [zg || obs.zone.next_center, "zone_run"]
    const winning = P.keep_fight && target && dist2(target.pos, pos) < 120 && ((target.hp ?? 1400) < 250 || (target.hp ?? 1400) < 0.5 * me.hp)
    if (P.short_retreat) {
      if (losing(me, enemies, target, hpFrac) && !(P.ammo_track && target && vulnerable(target, t))) S.loseAt = t
      if (S.loseAt != null && t - S.loseAt < P.short_retreat) return [coverPoint(pos, target ? target.pos : null, S.lastDamageBearing), "retreat"]
    } else if (hpFrac < P.retreat_hp && (target || underFire) && !winning) return [coverPoint(pos, target ? target.pos : null, S.lastDamageBearing), "retreat"]
    // outnumbered: break line of sight from the crowd instead of trading shots
    const attackers = [...S.threats.entries()].filter(([id, v]) => t - v[0] < 4).length
    const close = enemies.filter((m) => dist2(m.pos, pos) < 150).length
    if (Math.max(attackers, close) >= P.overwhelm && hpFrac < P.overwhelm_hp) {
      let cx = 0, cy = 0, n = 0
      for (const m of enemies) { cx += m.pos[0]; cy += m.pos[1]; n++ }
      const tp = n ? [cx / n, cy / n, pos[2]] : null
      return [coverPoint(pos, tp, S.lastDamageBearing), "escape"]
    }
    for (const dr of (P.drops ? obs.drops || [] : [])) {
      const dd = dist2(dr.pos, pos)
      if (dd < 140 && dr.lands_in < dd / 11 + 2) {
        const contested = enemies.some((m) => dist2(m.pos, dr.pos) < 30)
        if (!contested || hpFrac > 0.8) {
          if (dd < dr.radius * 0.6) return [[pos[0], pos[1]], "capture"]
          return [[dr.pos[0], dr.pos[1]], "drop"]
        }
      }
    }
    const predator = P.strategy === "predator"
    if (P.grab_cubes && !P.ghost && hpFrac > 0.5) {
      // kill drops: grab nearby cubes even mid-fight (+4% hp/dmg each, more upgrades)
      let best = null, bd = P.grab_cubes
      for (const c of obs.cubes || []) { const d = dist2(c.pos, pos); if (d < bd && Math.abs(c.pos[2] - pos[2]) < 4) { bd = d; best = c } }
      // don't walk a straight line to a cube while someone is lined up on us
      const covered = P.grab_safe && enemies.some((m) => m.aim && dist2(m.pos, pos) < 180 && Math.abs(angDiff(m.aim[0], Math.atan2(pos[1] - m.pos[1], pos[0] - m.pos[0]))) < 0.2)
      if (best && !covered) return [[best.pos[0], best.pos[1]], "grab"]
    }
    if (P.finish && !P.ghost) {
      // chase down a weakened enemy: fleeing mechs show their back (x1.5 damage)
      let fin = null
      for (const m of enemies) {
        const f = (m.hp ?? 1400) / Math.max(1, m.max_hp ?? 1400)
        const d = dist2(m.pos, pos)
        const crowdOK = !P.finish_crowd || enemies.filter((e) => dist2(e.pos, pos) < 160).length <= P.finish_crowd
        if (f < P.finish_hp && d < 200 && hpFrac > P.finish_min_hp && crowdOK && (!fin || f < fin.f)) fin = { m, f, d }
      }
      if (!fin && S.finishId != null) {
        const v = S.tracked.get(S.finishId)
        if (v && t - v.t < 4 && v.hp / v.max_hp < P.finish_hp) fin = { m: { id: S.finishId, pos: v.pos, hp: v.hp, max_hp: v.max_hp }, d: dist2(v.pos, pos), f: v.hp / v.max_hp, ghost: true }
      }
      if (fin) {
        S.finishId = fin.m.id; S.targetId = fin.m.id
        if (P.finish_fm && P.fightmove && !fin.ghost && fin.d < 200) { S.prefOverride = P.finish_fm; const g = fightPoint(obs, me, fin.m, enemies, hpFrac); S.prefOverride = 0; return [g, "rfight"] }
        if (fin.d < 25 && !fin.ghost) return [[pos[0], pos[1]], "finish"]
        return [[fin.m.pos[0], fin.m.pos[1]], "finish"]
      }
      S.finishId = null
    }
    if (target && P.fightmove && (!P.ghost || (P.ghost_fight && t - S.lastDamagedT < 6)) && (dist3(target.pos, pos) < P.engage_range || underFire)) return [fightPoint(obs, me, target, enemies, hpFrac), "rfight"]
    if (target && P.peek && (!P.ghost || t - S.lastDamagedT < 6) && (predator || dist3(target.pos, pos) < P.engage_range || underFire)) {
      return [duelPoint(obs, me, target, hpFrac), S.duelState]
    }
    if (target) {
      const d = dist3(target.pos, pos)
      if (predator && hpFrac >= P.retreat_hp) return [riskPoint(obs, me, target), "fight"]
      if (d < P.engage_range || underFire) {
        if (!P.drift) return [[pos[0], pos[1]], "hold"]
        return [riskPoint(obs, me, null), "hold"]
      }
    } else if (predator && hpFrac >= P.hunt_hp && t >= P.hunt_after) {
      const prey = huntTarget(me)
      if (prey) return [[prey[0], prey[1]], "hunt"]
    }
    const safe = !underFire && enemies.length === 0
    if (safe) {
      let best = null, bd = P.loot_radius
      if (me.cubes < P.cube_cap) for (const c of obs.cubes || []) { const d = dist3(c.pos, pos); if (d < bd && Math.abs(c.pos[2] - pos[2]) < 4) { best = [c.pos[0], c.pos[1]]; bd = d } }
      const held = me.weapons.map((w) => (w ? w.kind : null))
      const wv = worstSlot(me)[1]
      for (const p of obs.pickups || []) {
        if (held.includes(p.kind) || p.kind === "gun") continue
        if (wval(p.kind) <= wv) continue
        const d = dist3(p.pos, pos) * (p.kind === "laser" ? P.loot_radius / P.laser_seek : P.loot_radius / Math.max(P.loot_radius, P.weapon_seek))
        if ((P.weapon_pref[p.kind] || 0) > 0 && d < bd && Math.abs(p.pos[2] - pos[2]) < 4) { best = [p.pos[0], p.pos[1]]; bd = d }
      }
      if (!best && P.pick_mem && S.pickMem) {
        // fetch a remembered weapon: far for an empty slot, nearer for an upgrade over what we hold
        const empty = held.some((k) => k === null)
        let bp = null, bdd = 1e9
        for (const v of S.pickMem.values()) {
          if (held.includes(v.kind) || v.kind === "gun" || wval(v.kind) <= wv || !((P.weapon_pref[v.kind] || 0) > 0)) continue
          const lim = empty ? P.pick_mem_empty : P.pick_mem_swap
          const d = dist2(v.pos, pos)
          if (d < lim && d < bdd && Math.abs(v.pos[2] - (world ? world.height(v.pos[0], v.pos[1]) : v.pos[2])) < 3) { bdd = d; bp = [v.pos[0], v.pos[1]] }
        }
        if (bp) return [bp, "loot"]
      }
      if (best) return [best, "loot"]
      const armed = me.weapons.filter((w) => w && w.kind !== "gun").length >= P.fort_arms
      if (P.econ && world && hpFrac > P.econ_hp && me.cubes < P.econ_cubes && !(P.fortress && armed && t > P.fort_after)) { const eg = econGoal(obs, me); if (eg) return eg }
      for (const c of obs.crates || []) if (dist3(c.pos, pos) < 40 && Math.abs(c.pos[2] - pos[2]) < 6) return [[pos[0], pos[1]], "crate"]
    }
    if (underFire) return [coverPoint(pos, null, S.lastDamageBearing), "evade"]
    if (hpFrac < P.recover_hp && known(t, 8).some((e) => e.src === "see")) {
      // hold still behind cover and regenerate before re-engaging
      if (!S.recoverAt || dist2(S.recoverAt, pos) > 15) S.recoverAt = coverPoint(pos, null, S.lastDamageBearing)
      return [S.recoverAt, "recover"]
    }
    S.recoverAt = null
    if (P.fortress && world && !P.ghost) { const fg = fortGoal(obs, me); if (fg) return fg }
    if (known(t, 6).length && P.drift) return [riskPoint(obs, me, null), "drift"]
    return [zg || [pos[0], pos[1]], "idle"]
  }

  function weaponReady(me) {
    for (const wp of me.weapons) {
      if (!wp) continue
      if (wp.kind === "gun" && (wp.ammo ?? 1) > 0 && !(wp.reload > 0)) return true
      if (wp.kind === "laser" && wp.cooldown <= 0.3) return true
      if (wp.kind === "mortar" && wp.cooldown <= 0.2) return true
    }
    return false
  }

  function duelPoint(obs, me, target, hpFrac) {
    const pos = me.pos, t = obs.t
    const tp = [target.pos[0], target.pos[1], target.pos[2] + 4.5]
    const d = dist2(target.pos, pos)
    const thp = (target.hp ?? 1400) / Math.max(1, target.max_hp ?? 1400)
    const ready = weaponReady(me)
    const lw = me.weapons.find((w) => w && w.kind === "laser")
    const laserCharged = lw && (lw.charge || 0) >= lw.stats.charge * 0.9
    const wantPeek = d < 30 || laserCharged || (ready && (hpFrac > P.peek_hide_hp || thp < hpFrac * 0.8)) || (P.ammo_track && ready && vulnerable(target, t))
    if (P.kite && world && d < P.kite_range) {
      // kite a closing pursuer: back off diagonally while the torso keeps firing at it
      const tv = target.vel || [0, 0, 0], ux = (pos[0] - target.pos[0]) / Math.max(d, 1), uy = (pos[1] - target.pos[1]) / Math.max(d, 1)
      const closing = -(tv[0] * ux + tv[1] * uy)
      if (closing > 2 || d < 35) {
        const side = (S.kiteSide = S.kiteSide || (rnd() < 0.5 ? -1 : 1))
        for (const sd of [side, -side, 0]) {
          const dx = ux - uy * sd * 0.5, dy = uy + ux * sd * 0.5, l = hyp(dx, dy)
          const x = pos[0] + dx / l * 20, y = pos[1] + dy / l * 20
          if (!world.blockedAt(x, y) && walkClear(pos, [x, y])) { S.duelState = "kite"; if (sd !== side) S.kiteSide = sd || side; return [x, y] }
        }
      }
    }
    if (!world) { S.duelState = "duel"; return [pos[0], pos[1]] }
    // cache spots for a short while
    if (!S.duel || t > S.duel.until || dist2(S.duel.tpos, target.pos) > 12) {
      const hide = coverPoint(pos, target.pos, null)
      let peek = null, bs = 1e18
      for (const r of [0, 4, 8, 12, 16]) for (let k = 0; k < (r ? 12 : 1); k++) {
        const a = k * Math.PI / 6, x = pos[0] + Math.cos(a) * r, y = pos[1] + Math.sin(a) * r
        if (world.blockedAt(x, y)) continue
        const gz = world.height(x, y)
        if (!world.los([x, y, gz + 7], tp)) continue
        const s = hyp(x - hide[0], y - hide[1]) * 1.0 + r * 0.5 + Math.abs(hyp(x - tp[0], y - tp[1]) - optRange(me)) * 0.05
        if (s < bs) { bs = s; peek = [x, y] }
      }
      S.duel = { hide, peek: peek || [pos[0], pos[1]], tpos: target.pos, until: t + 1.5 }
    }
    S.duelState = wantPeek ? "peek" : "hide"
    return wantPeek ? S.duel.peek : S.duel.hide
  }

  function walkClear(a, b) {
    const d = dist2(a, b), n = Math.floor(d / 2) + 1
    for (let s = 1; s <= n; s++) { const f = s / n; if (world.blockedAt(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)) return false }
    return true
  }

  function navigate(pos, goal, t) {
    if (!goal) return [0, 0]
    const [gx, gy] = goal
    const d = hyp(gx - pos[0], gy - pos[1])
    if (d < 1.5) return [0, 0]
    if (!world || d < 6 || (S.roofPlan && S.roofPlan.direct)) return norm2(gx - pos[0], gy - pos[1])
    const need = !S.pathGoal || hyp(S.pathGoal[0] - gx, S.pathGoal[1] - gy) > 8 || t - S.pathT > 2 || !S.path.length
    if (need) { S.path = world.path([pos[0], pos[1]], [gx, gy]); S.pathGoal = [gx, gy]; S.pathT = t }
    while (S.path.length > 1 && hyp(S.path[0][0] - pos[0], S.path[0][1] - pos[1]) < 4.5) S.path.shift()
    let wp = S.path[0]
    if (S.path.length > 2 && walkClear(pos, S.path[2])) wp = S.path[2]
    return norm2(wp[0] - pos[0], wp[1] - pos[1])
  }

  function unstick(me, move, t) {
    let jump = false, jet = false
    const want = hyp(move[0], move[1]) > 0.5
    const spd = hyp(me.vel[0], me.vel[1])
    if (want && spd < 2 && me.grounded) S.stuckT += 0.1
    else S.stuckT = Math.max(0, S.stuckT - 0.05)
    if (S.stuckT > 0.8) {
      S.stuckT = 0; S.unstickUntil = t + 1.2
      const a = Math.atan2(move[1], move[0]) + (rnd() < 0.5 ? -1 : 1) * uni(0.6, 1.6)
      S.unstickDir = [Math.cos(a), Math.sin(a)]; S.path = []; jump = true
    }
    if (t < S.unstickUntil) {
      if (t < S.unstickUntil - 0.6) { jump = jump || me.grounded; jet = me.energy > 20 && !me.grounded; return [move, jump, jet] }
      return [S.unstickDir, jump, jet]
    }
    return [move, jump, jet]
  }

  function lead(me, tp, tv, speed, muzzle) {
    const sx = me.pos[0], sy = me.pos[1], sz = me.pos[2] + muzzle
    const L = P.aim_latency
    const tx = tp[0] + tv[0] * L, ty = tp[1] + tv[1] * L, tz = tp[2] + 4.5
    let tt = 0
    for (let i = 0; i < 3; i++) tt = hyp(tx + tv[0] * tt - sx, ty + tv[1] * tt - sy, tz + tv[2] * 0.3 * tt - sz) / speed
    const px = tx + tv[0] * tt, py = ty + tv[1] * tt, pz = tz + tv[2] * 0.3 * tt
    return [Math.atan2(py - sy, px - sx), Math.atan2(pz - sz, hyp(px - sx, py - sy)), hyp(px - sx, py - sy, pz - sz)]
  }

  function mortarPitch(d, dh, v, g) {
    const v2 = v * v, disc = v2 * v2 - g * (g * d * d + 2 * dh * v2)
    if (disc < 0) return null
    return Math.atan((v2 - Math.sqrt(disc)) / (g * d))
  }

  function aimAndFire(obs, me, target, npcs, act, mode) {
    const pos = me.pos, stats = me.stats, muzzle = stats.muzzle_height || 7, weapons = me.weapons
    const fire = [false, false]
    let aim = null
    const eye = [pos[0], pos[1], pos[2] + muzzle]
    let tgt = target, tkind = "mech"
    if (!tgt && npcs.length && P.farm_npcs && mode !== "retreat" && mode !== "zone_run") {
      const nn = [...npcs].sort((a, b) => dist3(a.pos, pos) - dist3(b.pos, pos))
      if (dist3(nn[0].pos, pos) < (mode === "farm" ? 110 : 70)) { tgt = nn[0]; tkind = "npc" }
    }
    let crate = null
    if (!tgt && (mode === "crate" || mode === "idle" || mode === "loot" || mode === "farm")) {
      const cs = [...(obs.crates || [])].sort((a, b) => dist3(a.pos, pos) - dist3(b.pos, pos))
      if (cs.length && dist3(cs[0].pos, pos) < 60) crate = cs[0]
    }
    const [ay, ap] = me.aim
    if (tgt) {
      const gw = weapons[0]
      const gspeed = gw && gw.kind === "gun" ? gw.stats.speed : 252
      let tvel = tgt.vel || [0, 0, 0]
      if (tkind === "mech" && P.vel_ema < 1) { const tr = S.tracked.get(tgt.id); if (tr && tr.ev) tvel = tr.ev }
      tvel = [tvel[0] * P.lead_k, tvel[1] * P.lead_k, tvel[2] * P.lead_k]
      let [yaw, pitch, d] = lead(me, tgt.pos, tvel, gspeed, muzzle)
      if (tkind === "npc") pitch = Math.atan2(tgt.pos[2] + 1.7 - pos[2] - muzzle, dist2(tgt.pos, pos))
      aim = [yaw, pitch]
      const clear = world ? world.los(eye, [tgt.pos[0], tgt.pos[1], tgt.pos[2] + (tkind === "mech" ? 4.5 : 1.7)]) : true
      const err = Math.abs(angDiff(ay, yaw)) + Math.abs(ap - pitch) * 0.5
      const tol = Math.max(0.012, Math.atan2(2, Math.max(d, 1)))
      // the laser is hitscan: aim at where the target is (plus one decision of motion), not at a lead point
      const tv = tgt.vel || [0, 0, 0], hz = tkind === "mech" ? 4.5 : 1.7
      const lpnt = [tgt.pos[0] + tv[0] * 0.12, tgt.pos[1] + tv[1] * 0.12, tgt.pos[2] + hz]
      const lyaw = Math.atan2(lpnt[1] - pos[1], lpnt[0] - pos[0])
      const lpitch = Math.atan2(lpnt[2] - pos[2] - muzzle, hyp(lpnt[0] - pos[0], lpnt[1] - pos[1]))
      const lerr = Math.abs(angDiff(ay, lyaw)) + Math.abs(ap - lpitch) * 0.5
      const ltol = Math.max(0.008, Math.atan2(1.8, Math.max(d, 1)))
      const lw = weapons.find((w) => w && w.kind === "laser")
      if (P.laser_direct && lw && (lw.charge || 0) >= lw.stats.charge * 0.5) aim = [lyaw, lpitch]
      weapons.forEach((wp, i) => {
        if (!wp) return
        const st = wp.stats
        if (wp.kind === "gun") {
          let good = true
          if (P.gun_select && tkind === "mech" && d > P.gun_select_min) {
            // expected sideways wander of the target during bullet flight vs its radius
            const tvv = tgt.vel || [0, 0, 0], ux = (tgt.pos[0] - pos[0]) / Math.max(d, 1), uy = (tgt.pos[1] - pos[1]) / Math.max(d, 1)
            const lat = Math.abs(-uy * tvv[0] + ux * tvv[1])
            const flight = d / st.speed
            const r = 2.5 * (1 + 0.05 * (tgt.cubes || 0))
            good = lat * flight * P.gun_select_k < r + 0.5
          }
          if (clear && d < st.range && err < tol * P.gun_tol && good) fire[i] = true
          if ((wp.ammo ?? 1) === 0 && (wp.reload ?? 0) === 0) act.reload = true
        } else if (wp.kind === "laser") {
          const ch = wp.charge || 0
          const e2 = P.laser_direct ? lerr : err, t2 = P.laser_direct ? ltol : tol
          let full = st.charge * 0.95
          if (P.lethal && tkind === "mech" && ch >= (st.min_charge || 0.15)) {
            // release early when the partial charge already kills: frees the cooldown and denies the target time
            const frac = (st.min_frac ?? 0.35) + (1 - (st.min_frac ?? 0.35)) * Math.min(1, ch / st.charge)
            const mult = 1 + 0.04 * Math.min(me.cubes || 0, 10)
            if (st.damage * frac * mult * P.lethal_k >= (tgt.hp ?? 1400)) full = 0
          }
          if (wp.cooldown <= 0 && d < st.range && clear) fire[i] = ch < full ? true : !(e2 < t2)
          else if (ch > 0) fire[i] = !(e2 < t2 * 2)
        } else if (wp.kind === "lightning") {
          if (d < st.range * 0.95 && Math.abs(angDiff(ay, yaw)) < (st.cone_deg * Math.PI / 180) * 0.8 && clear) fire[i] = me.energy > P.lightning_min_energy
        } else if (wp.kind === "mortar") {
          if (wp.cooldown <= 0 && d > 25 && d < 220) {
            const mp = mortarPitch(dist2(tgt.pos, pos), tgt.pos[2] - pos[2] - (stats.height || 9) - 0.5, st.speed, st.gravity)
            if (mp !== null && !fire[0]) {
              if (Math.abs(angDiff(ay, yaw)) < 0.05 && Math.abs(ap - mp) < 0.06) fire[i] = true
              else if (!clear || (weapons[0] && weapons[0].ammo === 0)) aim = [yaw, mp]
            }
          }
        }
      })
    } else if (crate) {
      const yaw = Math.atan2(crate.pos[1] - pos[1], crate.pos[0] - pos[0])
      const pitch = Math.atan2(crate.pos[2] + 1.2 - pos[2] - muzzle, dist2(crate.pos, pos))
      aim = [yaw, pitch]
      if (weapons[0] && weapons[0].kind === "gun" && Math.abs(angDiff(ay, yaw)) < 0.05 &&
        (!world || world.los(eye, [crate.pos[0], crate.pos[1], crate.pos[2] + 1.2]))) fire[0] = true
    } else {
      const t = obs.t
      const snd = (obs.sounds || []).filter((s) => ["gun", "laser", "laser_charge", "lightning", "step", "boost", "mortar", "jet"].includes(s.kind))
      if (t - S.lastDamagedT < 4 && S.lastDamageBearing != null) aim = [S.lastDamageBearing, 0]
      else if (mode === "fort" && S.fortDir != null && dist2([S.fort.x, S.fort.y], pos) < 6 && !snd.some((x) => x.dist === "near")) aim = [S.fortDir + Math.sin(t * 0.7) * 0.5, 0]
      else if (snd.length) { const r = { near: 0, mid: 1, far: 2 }; snd.sort((a, b) => r[a.dist] - r[b.dist]); aim = [snd[0].bearing, 0] }
      else {
        const mv = act.move || [0, 0]
        aim = hyp(mv[0], mv[1]) > 0.3 ? [Math.atan2(mv[1], mv[0]) + Math.sin(t * 1.3) * 0.9, 0] : [me.aim[0] + 0.25, 0]
      }
    }
    if (aim && P.aim_noise) {
      if (!S.noiseT || obs.t > S.noiseT) { S.noise = [(rnd() * 2 - 1) * P.aim_noise, (rnd() * 2 - 1) * P.aim_noise * 0.5]; S.noiseT = obs.t + 0.8 }
      aim[0] += S.noise[0]; aim[1] += S.noise[1]
    }
    if (aim) { aim[1] = clamp(aim[1], -0.69, 1.29); act.aim = [+aim[0].toFixed(4), +aim[1].toFixed(4)] }
    act.fire = fire
  }

  bot.act = function (obs) {
    const me = obs.self, t = obs.t, pos = me.pos
    const act = { tick: obs.tick }
    if (P.idle) { if (obs.offer) act.pick = 0; S.mode = "idle"; return act }
    updateMode(obs)
    for (const e of obs.events || []) if (e.type === "damaged" && e.bearing != null) {
      S.lastDamagedT = t; S.lastDamageBearing = e.bearing
      if (e.by != null) S.threats.set(e.by, [t, e.bearing])
    }
    if (obs.offer) act.pick = pickUpgrade(obs.offer)
    const enemies = obs.mechs.filter((m) => m.kind === "mech")
    const npcs = obs.mechs.filter((m) => m.kind === "npc")
    const hpFrac = me.hp / Math.max(1, me.max_hp)
    S.T = t
    S.late = obs.zone.next_radius <= 70 || obs.alive <= 3
    S.alive = obs.alive
    track(obs, enemies)
    remember(obs)
    takeLoot(obs, act)
    const target = chooseTarget(me, enemies)
    const underFire = t - S.lastDamagedT < 2
    if (P.ammo_track) weaponIntel(obs, me, enemies)
    let [goal, mode] = movementGoal(obs, me, enemies, target, hpFrac, underFire)
    let move = navigate(pos, goal, t)
    let boost = false
    let dodge = null
    if (P.dodge) {
      for (const m of enemies) {
        if (!m.charging) continue
        const toMe = Math.atan2(pos[1] - m.pos[1], pos[0] - m.pos[0])
        const d = dist2(m.pos, pos)
        if (Math.abs(angDiff(m.aim[0], toMe)) < Math.max(0.06, Math.atan2(6, d)) && d < 290) {
          const side = (S.dodgeSide = S.dodgeSide || (rnd() < 0.5 ? -1 : 1))
          dodge = [-Math.sin(toMe) * side, Math.cos(toMe) * side]
          if (world && world.blockedAt(pos[0] + dodge[0] * 6, pos[1] + dodge[1] * 6)) { S.dodgeSide = -side; dodge = [-dodge[0], -dodge[1]] }
          break
        }
      }
      if (!dodge) S.dodgeSide = 0
      const mg = cfg.weapons.mortar
      for (const p of obs.projectiles || []) {
        if (p.kind !== "mortar") continue
        // predict landing near our height
        const vz = p.vel[2], dz = p.pos[2] - (pos[2] + 2), g = mg.gravity
        const disc = vz * vz + 2 * g * dz
        if (disc < 0) continue
        const tl = (vz + Math.sqrt(disc)) / g
        const lx = p.pos[0] + p.vel[0] * tl, ly = p.pos[1] + p.vel[1] * tl
        const dl = hyp(lx - pos[0], ly - pos[1])
        if (tl < 3 && dl < mg.splash_radius * 1.6) { const [ux, uy] = norm2(pos[0] - lx, pos[1] - ly); dodge = dl < 0.5 ? [1, 0] : [ux, uy]; break }
      }
    }
    if (P.bdodge && !dodge) {
      // sidestep incoming bullets: closest approach of each enemy round to us, boost perpendicular, away from it
      const mv = me.vel || [0, 0, 0]
      if (S.bdodgeUntil != null && t < S.bdodgeUntil) dodge = S.bdodgeDir
      else {
        let worst = null, wt = 1e9
        for (const p of obs.projectiles || []) {
          if (p.kind === "mortar") continue
          const rx = p.pos[0] - pos[0], ry = p.pos[1] - pos[1]
          const vx = p.vel[0] - mv[0], vy = p.vel[1] - mv[1], vv = vx * vx + vy * vy
          if (vv < 100) continue
          const ts = -(rx * vx + ry * vy) / vv
          if (ts < 0.04 || ts > P.bdodge_t) continue
          const cx = rx + vx * ts, cy = ry + vy * ts, miss = hyp(cx, cy)
          const z = p.pos[2] + p.vel[2] * ts - pos[2]
          if (miss > P.bdodge_reach || z < -1 || z > 10) continue
          if (ts < wt) { wt = ts; worst = [vx, vy, cx, cy] }
        }
        if (worst) {
          const [vx, vy, cx, cy] = worst, l = hyp(vx, vy), nx = -vy / l, ny = vx / l
          const cn = cx * nx + cy * ny
          let sg = Math.abs(cn) > 0.3 ? -Math.sign(cn) : (S.bdodgeSide || (rnd() < 0.5 ? -1 : 1))
          let dx = nx * sg, dy = ny * sg
          if (world && world.blockedAt(pos[0] + dx * 5, pos[1] + dy * 5)) { dx = -dx; dy = -dy; sg = -sg }
          S.bdodgeSide = sg; S.bdodgeDir = [dx, dy]; S.bdodgeUntil = t + P.bdodge_hold
          dodge = [dx, dy]
        }
      }
    }
    if (target && (mode === "fight" || mode === "hold") && P.strafe) {
      if (t > S.strafeT) { S.strafeDir = rnd() < 0.5 ? -1 : 1; S.strafeT = t + uni(0.4, 1.1) }
      const [px, py] = norm2(-(target.pos[1] - pos[1]), target.pos[0] - pos[0])
      let sx = px * S.strafeDir, sy = py * S.strafeDir
      if (world && world.blockedAt(pos[0] + sx * 5, pos[1] + sy * 5)) { S.strafeDir *= -1; sx = -sx; sy = -sy }
      move = mode === "hold" && !P.drift ? [sx, sy] : (mode === "hold" ? [sx, sy] : norm2(move[0] * 0.6 + sx * 0.8, move[1] * 0.6 + sy * 0.8))
    }
    if (P.jink && target && (mode === "peek" || mode === "finish" || mode === "grab" || mode === "kite")) {
      // jink while exposed: lateral direction flips faster than a bullet's flight time
      if (t > (S.jinkT ?? -1)) { S.jinkDir = rnd() < 0.5 ? -1 : 1; S.jinkT = t + uni(P.jink_min, P.jink_max) }
      const [px, py] = norm2(-(target.pos[1] - pos[1]), target.pos[0] - pos[0])
      let sx = px * S.jinkDir, sy = py * S.jinkDir
      if (world && world.blockedAt(pos[0] + sx * 4, pos[1] + sy * 4)) { S.jinkDir *= -1; sx = -sx; sy = -sy }
      const mlen = hyp(move[0], move[1])
      move = mlen > 0.2 ? norm2(move[0] + sx * P.jink, move[1] + sy * P.jink) : [sx, sy]
    }
    if (mode === "retreat" || mode === "zone_run" || mode === "escape") boost = me.energy > 15
    S.dodging = !!dodge
    if (dodge) { move = dodge; boost = boost || me.energy > (P.bdodge ? 8 : 20) }
    if (P.fight_boost && (mode === "rfight" || mode === "peek" || mode === "kite")) {
      // keep moving fast while exposed in a fight (hysteresis so the dodge always has energy left)
      S.fbOn = me.energy > 60 ? true : me.energy < 30 ? false : !!S.fbOn
      const charging = me.weapons.some((w) => w && w.kind === "laser" && (w.charge || 0) > 0)
      if (S.fbOn && !charging && me.grounded !== false) boost = true
    }
    if (mode === "finish") boost = me.energy > 30
    if (!me.in_zone) boost = me.energy > 10
    let jump = false, jet = false
    if (S.roofPlan && S.roofPlan.jet) {
      jump = me.grounded
      jet = !me.grounded && me.energy > 1
      if (S.roofPlan.mode === "roof_hop" && me.grounded) jump = true
    } else if (S.roofPlan && S.roofPlan.mode === "roof") {
      // stay put on the roof; small moves only
    } else {
      ;[move, jump, jet] = unstick(me, move, t)
    }
    act.move = [+move[0].toFixed(3), +move[1].toFixed(3)]
    act.boost = !!(boost || jet)
    act.jump = !!jump
    if (P.strategy === "prey" && P.slow_walk && mode === "drift" && !underFire && !S.dodging) { act.move = [act.move[0] * 0.4, act.move[1] * 0.4]; act.boost = false }
    let fireTarget = target
    if (P.strategy === "prey" && target && mode !== "peek" && mode !== "hide" && mode !== "finish" && mode !== "grab" && mode !== "kite" && mode !== "rfight") {
      const d = dist3(target.pos, pos)
      const th = S.threats.get(target.id)
      const hitMe = th && t - th[0] < 6
      const weak = (target.hp ?? 1400) < 0.3 * (target.max_hp ?? 1400)
      if (!(d < P.prey_fire_range || hitMe || weak)) fireTarget = null
    }
    aimAndFire(obs, me, fireTarget, npcs, act, mode)
    if (mode === "hide" && P.precharge) {
      // pre-charge the laser behind cover, then peek to release
      me.weapons.forEach((w, i) => { if (w && w.kind === "laser" && w.cooldown <= 0 && (w.charge || 0) < w.stats.charge * 0.95) act.fire[i] = true })
    }
    if (P.tac_reload && !fireTarget && !(act.fire && (act.fire[0] || act.fire[1]))) {
      const g = me.weapons[0]
      if (g && g.kind === "gun" && !(g.reload > 0) && (g.ammo ?? 99) < g.stats.mag * 0.6 && t - S.lastDamagedT > 1.5) act.reload = true
    }
    if (P.ghost && t - S.lastDamagedT >= 3) act.fire = [false, false]
    if (!P.shoot_crates && mode === "crate") act.fire = [false, false]
    S.mode = mode
    S.label = `${S.ffa ? "FFA" : S.squad ? "SQ" : "??"} ${mode} hp${me.hp | 0} c${me.cubes}`
    return act
  }
  return bot
}
