window.Brain=(function(){
const CELL = 4.0
const TAU = Math.PI * 2
const hyp = Math.hypot
const angDiff = (a, b) => ((a - b + Math.PI) % TAU + TAU) % TAU - Math.PI
const norm2 = (x, y) => { const l = hyp(x, y); return l > 1e-6 ? [x / l, y / l] : [0, 0] }
const dist3 = (a, b) => hyp(a[0] - b[0], a[1] - b[1], (a[2] || 0) - (b[2] || 0))
const dist2 = (a, b) => hyp(a[0] - b[0], a[1] - b[1])
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const DEFAULTS = {
strategy: "prey",
retreat_hp: 0.38,
engage_range: 170,
loot_radius: 70,
zone_margin: 0.55,
upgrade_order: ["plating", "armor", "nanites", "gun_damage", "laser_damage", "gun_rate", "laser_charge", "sensors",
"gyros", "capacitor", "reactor", "jets", "servos", "gun_mag", "gun_velocity", "mortar_reload",
"lightning_efficiency", "lightning_range", "lightning_chain", "mortar_splash", "mortar_velocity", "laser_pierce"],
weapon_pref: { laser: 3, mortar: 2, lightning: 1 },
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
stick: 70,           // experiment: stand still, never fire
ghost: false,          // never fire unless we were hit in the last 3 s
shoot_crates: true,
}
const STRATS = {
prey: {},
predator: { retreat_hp: 0.32, engage_range: 230, expose_w: 1.0, loot_radius: 90 },
}
function pip(x, y, ring) {
let inside = false
const n = ring.length >> 1
for (let i = 0, j = n - 1; i < n; j = i++) {
const xi = ring[2 * i], yi = ring[2 * i + 1], xj = ring[2 * j], yj = ring[2 * j + 1]
if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi) inside = !inside
}
return inside
}
class World {
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
function mulberry(seed) {
let a = seed >>> 0
return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
function makeBot(hello, mapFiles, override = {}) {
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
const bot = { name: P.name || "kesh-mech", P, S, world }
function updateMode(obs) {
const kills = obs.events.filter((e) => e.type === "kill").length
const drop = S.lastAlive - obs.alive
if (drop > kills) { S.unexplained += drop - kills; if (S.unexplained >= 2) S.ffa = true }
S.lastAlive = obs.alive
}
function pickUpgrade(offer) {
let best = 1e9, bi = 0
offer.choices.forEach((c, i) => { const r = P.upgrade_order.indexOf(c.id); const rr = r < 0 ? 50 : r; if (rr < best) { best = rr; bi = i } })
return bi
}
function takeLoot(obs, act) {
const me = obs.self, pos = me.pos, reach = cfg.loot.pickup_radius
const held = me.weapons.map((w) => (w ? w.kind : null))
for (const p of obs.pickups || []) {
if (dist2(p.pos, pos) < reach - 0.3 && Math.abs(p.pos[2] - pos[2]) < 3.8) {
const k = p.kind
if (held.includes(k)) continue
const pref = P.weapon_pref[k] || 0
if (held[1] === null && k !== "gun") { act.take = p.id; return }
const cur = held[1] ? (P.weapon_pref[held[1]] || 0) : -1
const charging = me.weapons[1] && (me.weapons[1].charge || 0) > 0
if (pref > cur && !charging) { act.take = p.id; act.drop = 1; return }
}
}
}
function chooseTarget(me, enemies) {
let best = null, bs = 1e18, cur = null, cs = 1e18
for (const m of enemies) {
const d = dist3(m.pos, me.pos)
if (d > 260) continue
const hpf = (m.hp ?? 1400) / Math.max(1, m.max_hp ?? 1400)
let s = d + hpf * 90
if (S.threats.has(m.id)) s -= 60
if (world && !world.los([me.pos[0], me.pos[1], me.pos[2] + 7], [m.pos[0], m.pos[1], m.pos[2] + 4.5])) s += 120
if (s < bs) { bs = s; best = m }
if (m.id === S.targetId) { cur = m; cs = s }
}
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
function track(obs, enemies) {
const t = obs.t
for (const m of enemies) S.tracked.set(m.id, { pos: m.pos, vel: m.vel || [0, 0, 0], hp: m.hp ?? 1400, max_hp: m.max_hp ?? 1400, t, src: "see" })
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
if (kinds.includes("laser")) return 150
if (kinds.includes("lightning")) return 35
if (kinds.includes("mortar")) return 120
return 90
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
if (hpFrac < P.retreat_hp && (target || underFire)) return [coverPoint(pos, target ? target.pos : null, S.lastDamageBearing), "retreat"]
for (const dr of obs.drops || []) {
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
if (target && P.peek && (predator || dist3(target.pos, pos) < P.engage_range || underFire)) {
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
for (const c of obs.cubes || []) { const d = dist3(c.pos, pos); if (d < bd && Math.abs(c.pos[2] - pos[2]) < 4) { best = [c.pos[0], c.pos[1]]; bd = d } }
const held = me.weapons.map((w) => (w ? w.kind : null))
for (const p of obs.pickups || []) {
if (held.includes(p.kind) || p.kind === "gun") continue
const cur = held[1] ? (P.weapon_pref[held[1]] || 0) : -1
if ((P.weapon_pref[p.kind] || 0) <= cur) continue
const d = dist3(p.pos, pos)
if (d < bd && Math.abs(p.pos[2] - pos[2]) < 4) { best = [p.pos[0], p.pos[1]]; bd = d }
}
if (best) return [best, "loot"]
for (const c of obs.crates || []) if (dist3(c.pos, pos) < 40 && Math.abs(c.pos[2] - pos[2]) < 6) return [[pos[0], pos[1]], "crate"]
}
if (underFire) return [coverPoint(pos, null, S.lastDamageBearing), "evade"]
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
const wantPeek = d < 30 || (ready && (hpFrac > P.peek_hide_hp || thp < hpFrac * 0.8))
if (!world) { S.duelState = "duel"; return [pos[0], pos[1]] }
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
const tx = tp[0], ty = tp[1], tz = tp[2] + 4.5
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
if (dist3(nn[0].pos, pos) < 70) { tgt = nn[0]; tkind = "npc" }
}
let crate = null
if (!tgt && (mode === "crate" || mode === "idle" || mode === "loot")) {
const cs = [...(obs.crates || [])].sort((a, b) => dist3(a.pos, pos) - dist3(b.pos, pos))
if (cs.length && dist3(cs[0].pos, pos) < 60) crate = cs[0]
}
const [ay, ap] = me.aim
if (tgt) {
const gw = weapons[0]
const gspeed = gw && gw.kind === "gun" ? gw.stats.speed : 252
let [yaw, pitch, d] = lead(me, tgt.pos, tgt.vel || [0, 0, 0], gspeed, muzzle)
if (tkind === "npc") pitch = Math.atan2(tgt.pos[2] + 1.7 - pos[2] - muzzle, dist2(tgt.pos, pos))
aim = [yaw, pitch]
const clear = world ? world.los(eye, [tgt.pos[0], tgt.pos[1], tgt.pos[2] + (tkind === "mech" ? 4.5 : 1.7)]) : true
const err = Math.abs(angDiff(ay, yaw)) + Math.abs(ap - pitch) * 0.5
const tol = Math.max(0.012, Math.atan2(2, Math.max(d, 1)))
weapons.forEach((wp, i) => {
if (!wp) return
const st = wp.stats
if (wp.kind === "gun") {
if (clear && d < st.range && err < tol * 1.6) fire[i] = true
if ((wp.ammo ?? 1) === 0 && (wp.reload ?? 0) === 0) act.reload = true
} else if (wp.kind === "laser") {
const ch = wp.charge || 0
if (wp.cooldown <= 0 && d < st.range && clear) fire[i] = ch < st.charge * 0.95 ? true : !(err < tol)
else if (ch > 0) fire[i] = !(err < tol * 2)
} else if (wp.kind === "lightning") {
if (d < st.range * 0.95 && Math.abs(angDiff(ay, yaw)) < (st.cone_deg * Math.PI / 180) * 0.8 && clear) fire[i] = me.energy > 25
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
else if (snd.length) { const r = { near: 0, mid: 1, far: 2 }; snd.sort((a, b) => r[a.dist] - r[b.dist]); aim = [snd[0].bearing, 0] }
else {
const mv = act.move || [0, 0]
aim = hyp(mv[0], mv[1]) > 0.3 ? [Math.atan2(mv[1], mv[0]) + Math.sin(t * 1.3) * 0.9, 0] : [me.aim[0] + 0.25, 0]
}
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
track(obs, enemies)
takeLoot(obs, act)
const target = chooseTarget(me, enemies)
const underFire = t - S.lastDamagedT < 2
let [goal, mode] = movementGoal(obs, me, enemies, target, hpFrac, underFire)
let move = navigate(pos, goal, t)
let boost = false
if (target && (mode === "fight" || mode === "hold") && P.strafe) {
if (t > S.strafeT) { S.strafeDir = rnd() < 0.5 ? -1 : 1; S.strafeT = t + uni(0.4, 1.1) }
const [px, py] = norm2(-(target.pos[1] - pos[1]), target.pos[0] - pos[0])
let sx = px * S.strafeDir, sy = py * S.strafeDir
if (world && world.blockedAt(pos[0] + sx * 5, pos[1] + sy * 5)) { S.strafeDir *= -1; sx = -sx; sy = -sy }
move = mode === "hold" && !P.drift ? [sx, sy] : (mode === "hold" ? [sx, sy] : norm2(move[0] * 0.6 + sx * 0.8, move[1] * 0.6 + sy * 0.8))
}
if (mode === "retreat" || mode === "zone_run") boost = me.energy > 15
if (!me.in_zone) boost = me.energy > 10
let jump = false, jet = false
if (S.roofPlan && S.roofPlan.jet) {
jump = me.grounded
jet = !me.grounded && me.energy > 1
if (S.roofPlan.mode === "roof_hop" && me.grounded) jump = true
} else if (S.roofPlan && S.roofPlan.mode === "roof") {
} else {
;[move, jump, jet] = unstick(me, move, t)
}
act.move = [+move[0].toFixed(3), +move[1].toFixed(3)]
act.boost = !!(boost || jet)
act.jump = !!jump
if (P.strategy === "prey" && P.slow_walk && mode === "drift" && !underFire) { act.move = [act.move[0] * 0.4, act.move[1] * 0.4]; act.boost = false }
let fireTarget = target
if (P.strategy === "prey" && target && mode !== "peek" && mode !== "hide") {
const d = dist3(target.pos, pos)
const th = S.threats.get(target.id)
const hitMe = th && t - th[0] < 6
const weak = (target.hp ?? 1400) < 0.3 * (target.max_hp ?? 1400)
if (!(d < P.prey_fire_range || hitMe || weak)) fireTarget = null
}
aimAndFire(obs, me, fireTarget, npcs, act, mode)
if (P.ghost && t - S.lastDamagedT >= 3) act.fire = [false, false]
if (!P.shoot_crates && mode === "crate") act.fire = [false, false]
S.mode = mode
S.label = `${S.ffa ? "FFA" : "PR"} ${mode} hp${me.hp | 0} c${me.cubes}`
return act
}
return bot
}
return {makeBot, DEFAULTS, STRATS}
})();
"brain loaded "+Object.keys(window.Brain.DEFAULTS).length