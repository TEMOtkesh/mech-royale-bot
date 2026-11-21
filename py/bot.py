"""Mech Royale bot. Survive, farm max HP, fight smart, never crash."""
import math
import os
import random
import sys
import time

import mechfight as mf
from worldmap import World

# ---- tunables (variants override via env file params.py) ----
P = {
    "retreat_hp": 0.38,        # fraction of max hp to disengage
    "engage_range": 170.0,     # start shooting at mechs within this range
    "loot_radius": 70.0,       # go grab loot this close when safe
    "zone_margin": 0.55,       # how deep inside next circle to sit (fraction of radius)
    "upgrade_order": ["plating", "armor", "nanites", "gun_damage", "laser_damage", "gun_rate",
                      "laser_charge", "sensors", "gyros", "capacitor", "reactor", "jets",
                      "servos", "gun_mag", "gun_velocity", "mortar_reload", "lightning_efficiency",
                      "lightning_range", "lightning_chain", "mortar_splash", "mortar_velocity",
                      "laser_pierce"],
    "weapon_pref": {"laser": 3, "mortar": 2, "lightning": 1},
    "farm_npcs": True,
    "strafe": True,
    "strategy": "prey",        # "prey" or "predator"
    "expose_w": 3.0,           # min-risk: penalty for standing in enemy line of sight
    "cover_w": 0.6,            # min-risk: reward for walls nearby
    "hunt_hp": 0.6,            # predator: only hunt above this hp fraction
    "prey_fire_range": 120.0,  # prey: only shoot back at mechs this close (or that hit us)
    "slow_walk": True,         # prey: walk under step speed when no threat (silent)
}
STRATS = {
    "prey": {},
    "predator": {"retreat_hp": 0.32, "engage_range": 230.0, "expose_w": 1.0, "loot_radius": 90.0},
}
try:
    from params import OVERRIDE  # type: ignore
except Exception:
    OVERRIDE = {}
P.update(STRATS.get(OVERRIDE.get("strategy", P["strategy"]), {}))
P.update(OVERRIDE)
_env = os.environ.get("MECH_STRATEGY")
if _env in STRATS:
    P["strategy"] = _env
    P.update(STRATS[_env])


def ang_diff(a, b):
    d = (a - b + math.pi) % (2 * math.pi) - math.pi
    return d


def norm2(v):
    l = math.hypot(v[0], v[1])
    return (v[0] / l, v[1] / l) if l > 1e-6 else (0.0, 0.0)


class Bot:
    name = "kesh-mech"

    def __init__(self, hello):
        self.cfg = hello["config"]
        self.slot = hello["slot"]
        random.seed(hello.get("seed", 1))
        self.world = None
        try:
            self.world = World(hello["map"]["dir"])
        except Exception as e:
            mf.log("map load failed", e)
        self.path = []
        self.path_goal = None
        self.path_t = -99
        self.last_alive = 16
        self.unexplained = 0
        self.ffa = False
        self.strafe_dir = 1
        self.strafe_t = 0
        self.last_pos = None
        self.stuck_t = 0
        self.unstick_until = 0
        self.unstick_dir = (1, 0)
        self.threats = {}  # id -> (t, bearing)
        self.last_damaged_t = -99
        self.last_damage_bearing = None
        self.tracked = {}  # id -> last mech obs

    # ------------------------------------------------------------------
    def act(self, obs):
        t0 = time.time()
        me = obs["self"]
        t = obs["t"]
        pos = me["pos"]
        act = {"tick": obs["tick"]}
        self._update_mode(obs)

        # events
        for e in obs.get("events", []):
            if e["type"] == "damaged" and e.get("bearing") is not None:
                self.last_damaged_t = t
                self.last_damage_bearing = e["bearing"]
                if e.get("by") is not None:
                    self.threats[e["by"]] = (t, e["bearing"])

        # upgrades
        if obs.get("offer"):
            act["pick"] = self._pick_upgrade(obs["offer"])

        enemies = [m for m in obs["mechs"] if m["kind"] == "mech"]
        npcs = [m for m in obs["mechs"] if m["kind"] == "npc"]
        hp_frac = me["hp"] / max(1, me["max_hp"])
        self._track(obs, enemies)

        # loot taking (always, opportunistic)
        self._take_loot(obs, act)

        # --- choose target
        target = self._choose_target(me, enemies)
        under_fire = (t - self.last_damaged_t) < 2.0

        # --- movement goal
        goal, mode = self._movement_goal(obs, me, enemies, npcs, target, hp_frac, under_fire)
        move = self._navigate(obs, pos, goal, t)
        boost = False

        # combat strafing when engaged
        if target is not None and mode in ("fight", "hold") and P["strafe"]:
            if t > self.strafe_t:
                self.strafe_dir = random.choice((-1, 1))
                self.strafe_t = t + random.uniform(0.4, 1.1)
            tx, ty = target["pos"][0] - pos[0], target["pos"][1] - pos[1]
            px, py = norm2((-ty, tx))
            sx, sy = px * self.strafe_dir, py * self.strafe_dir
            if self.world and self.world.blocked_at(pos[0] + sx * 5, pos[1] + sy * 5):
                self.strafe_dir *= -1
                sx, sy = -sx, -sy
            if mode == "hold":
                move = (sx, sy)
            else:
                move = norm2((move[0] * 0.6 + sx * 0.8, move[1] * 0.6 + sy * 0.8))
        if mode in ("retreat", "zone_run"):
            boost = me["energy"] > 15
        if not me["in_zone"]:
            boost = me["energy"] > 10

        # stuck handling
        move, jump, jet = self._unstick(me, move, t)
        act["move"] = [round(move[0], 3), round(move[1], 3)]
        act["boost"] = bool(boost or jet)
        act["jump"] = bool(jump)

        if P["strategy"] == "prey" and P["slow_walk"] and mode == "drift" and not under_fire:
            act["move"] = [round(act["move"][0] * 0.4, 3), round(act["move"][1] * 0.4, 3)]
            act["boost"] = False

        # --- aiming & firing
        fire_target = target
        if P["strategy"] == "prey" and target is not None:
            d = math.dist(target["pos"], pos)
            th = self.threats.get(target["id"])
            hit_me = th is not None and t - th[0] < 6
            weak = target.get("hp", 1400) < 0.3 * target.get("max_hp", 1400)
            if not (d < P["prey_fire_range"] or hit_me or weak):
                fire_target = None
        self._aim_and_fire(obs, me, fire_target, npcs, act, mode)

        mf.draw.label("%s %s hp%.0f c%d %s" % ("FFA" if self.ffa else "PR", mode, me["hp"], me["cubes"],
                                                  "%.0fms" % ((time.time() - t0) * 1000)))
        return act

    # ------------------------------------------------------------------
    def _update_mode(self, obs):
        alive = obs["alive"]
        kills = sum(1 for e in obs.get("events", []) if e["type"] == "kill")
        drop = self.last_alive - alive
        if drop > kills:
            self.unexplained += drop - kills
            if self.unexplained >= 2:
                self.ffa = True
        self.last_alive = alive

    def _pick_upgrade(self, offer):
        order = P["upgrade_order"]
        best, bi = 1e9, 0
        for i, c in enumerate(offer["choices"]):
            r = order.index(c["id"]) if c["id"] in order else 50
            if r < best:
                best, bi = r, i
        return bi

    def _take_loot(self, obs, act):
        me = obs["self"]
        pos = me["pos"]
        reach = self.cfg["loot"]["pickup_radius"]
        held = [w["kind"] if w else None for w in me["weapons"]]
        for p in obs.get("pickups", []):
            if math.hypot(p["pos"][0] - pos[0], p["pos"][1] - pos[1]) < reach - 0.3 and abs(p["pos"][2] - pos[2]) < 3.8:
                k = p["kind"]
                if k in held:
                    continue
                pref = P["weapon_pref"].get(k, 0)
                if held[1] is None and k != "gun":
                    act["take"] = p["id"]
                    return
                cur = P["weapon_pref"].get(held[1], 0) if held[1] else -1
                charging = me["weapons"][1] and me["weapons"][1].get("charge", 0) > 0
                if pref > cur and not charging:
                    act["take"] = p["id"]
                    act["drop"] = 1
                    return

    def _choose_target(self, me, enemies):
        if not enemies:
            return None
        pos = me["pos"]
        best, bs = None, 1e18
        for m in enemies:
            d = math.dist(m["pos"], pos)
            if d > 260:
                continue
            s = d + m.get("hp", 1400) * 0.06
            if m["id"] in self.threats:
                s -= 60
            if self.world and not self.world.los((pos[0], pos[1], pos[2] + 7), (m["pos"][0], m["pos"][1], m["pos"][2] + 4.5)):
                s += 120
            if s < bs:
                bs, best = s, m
        return best

    def _zone_goal(self, obs, pos):
        z = obs["zone"]
        t = obs["t"]
        # target: inside next circle, toward its center, biased to stay near current position
        nc, nr = z["next_center"], z["next_radius"]
        c, r = z["center"], z["radius"]
        # where the circle will be by shrink_end; move early enough
        dx, dy = pos[0] - nc[0], pos[1] - nc[1]
        d = math.hypot(dx, dy)
        keep = nr * P["zone_margin"]
        if nr < 30:
            keep = nr * 0.3
        if d <= keep:
            return None
        f = keep / max(d, 1e-6)
        return (nc[0] + dx * f, nc[1] + dy * f)

    def _zone_urgent(self, obs, pos):
        z = obs["zone"]
        t = obs["t"]
        nc, nr = z["next_center"], z["next_radius"]
        d = math.hypot(pos[0] - nc[0], pos[1] - nc[1])
        dist_needed = d - nr * P["zone_margin"]
        time_left = z["shrink_end"] - t
        return dist_needed > 0 and (dist_needed / 10.0 > time_left - 15 or not obs["self"]["in_zone"])

    def _movement_goal(self, obs, me, enemies, npcs, target, hp_frac, under_fire):
        pos = me["pos"]
        t = obs["t"]
        zgoal = self._zone_goal(obs, pos)
        if not me["in_zone"] or self._zone_urgent(obs, pos):
            return (zgoal or obs["zone"]["next_center"]), "zone_run"
        # retreat when hurt and fighting
        if hp_frac < P["retreat_hp"] and (target is not None or under_fire):
            threat_pos = target["pos"] if target else None
            g = self._cover_point(pos, threat_pos, self.last_damage_bearing)
            return g, "retreat"
        # supply drop capture
        for dr in obs.get("drops", []):
            dd = math.hypot(dr["pos"][0] - pos[0], dr["pos"][1] - pos[1])
            if dd < 140 and dr["lands_in"] < dd / 11.0 + 2:
                contested = any(math.hypot(m["pos"][0] - dr["pos"][0], m["pos"][1] - dr["pos"][1]) < 30 for m in enemies)
                if not contested or hp_frac > 0.8:
                    if dd < dr["radius"] * 0.6:
                        return (pos[0], pos[1]), "capture"
                    return (dr["pos"][0], dr["pos"][1]), "drop"
        predator = P["strategy"] == "predator"
        if target is not None:
            d = math.dist(target["pos"], pos)
            if predator and hp_frac >= P["retreat_hp"]:
                return self._riskpoint(obs, me, target), "fight"
            if d < P["engage_range"] or under_fire:
                if not P.get("drift", True):
                    return (pos[0], pos[1]), "hold"
                return self._riskpoint(obs, me, None), "hold"
        elif predator and hp_frac >= P["hunt_hp"] and not self.ffa_early(obs):
            prey = self._hunt_target(me)
            if prey is not None:
                return (prey[0], prey[1]), "hunt"
        # loot: cubes, pickups, crates when safe
        safe = not under_fire and not enemies
        if safe:
            best, bd = None, P["loot_radius"]
            for c in obs.get("cubes", []):
                d = math.dist(c["pos"], pos)
                if d < bd and abs(c["pos"][2] - pos[2]) < 4:
                    best, bd = (c["pos"][0], c["pos"][1]), d
            held = [w["kind"] if w else None for w in me["weapons"]]
            for p in obs.get("pickups", []):
                if p["kind"] in held or p["kind"] == "gun":
                    continue
                cur = P["weapon_pref"].get(held[1], 0) if held[1] else -1
                if P["weapon_pref"].get(p["kind"], 0) <= cur:
                    continue
                d = math.dist(p["pos"], pos)
                if d < bd and abs(p["pos"][2] - pos[2]) < 4:
                    best, bd = (p["pos"][0], p["pos"][1]), d
            if best:
                return best, "loot"
            for c in obs.get("crates", []):
                d = math.dist(c["pos"], pos)
                if d < 40 and abs(c["pos"][2] - pos[2]) < 6:
                    return (pos[0], pos[1]), "crate"
        if under_fire:
            g = self._cover_point(pos, None, self.last_damage_bearing)
            return g, "evade"
        if self._known_enemies(t, me, 6.0) and P.get("drift", True):
            return self._riskpoint(obs, me, None), "drift"
        return (zgoal or (pos[0], pos[1])), "idle"

    # ------------------------------------------------------------------
    def ffa_early(self, obs):
        return obs["t"] < P.get("hunt_after", 0)

    def _track(self, obs, enemies):
        t = obs["t"]
        for m in enemies:
            self.tracked[m["id"]] = {"pos": m["pos"], "vel": m.get("vel", (0, 0, 0)), "hp": m.get("hp", 1400),
                                     "max_hp": m.get("max_hp", 1400), "t": t, "src": "see"}
        # sounds of weapons -> pseudo positions (unknown id)
        me = obs["self"]["pos"]
        dmap = {"near": 40.0, "mid": 110.0, "far": 230.0}
        n = 0
        for snd in obs.get("sounds", []):
            if snd["kind"] in ("gun", "laser", "laser_charge", "lightning", "mortar", "step", "boost", "jet", "reload"):
                d = dmap[snd["dist"]]
                p = (me[0] + math.cos(snd["bearing"]) * d, me[1] + math.sin(snd["bearing"]) * d, me[2])
                # skip if near a seen mech
                if any(math.hypot(v["pos"][0] - p[0], v["pos"][1] - p[1]) < 30 and t - v["t"] < 1 for v in self.tracked.values()):
                    continue
                n += 1
                self.tracked["s%d" % n] = {"pos": p, "vel": (0, 0, 0), "hp": 1200, "max_hp": 1400, "t": t,
                                           "src": "snd", "kind": snd["kind"], "dist": snd["dist"]}
        for k in [k for k, v in self.tracked.items() if t - v["t"] > 8]:
            del self.tracked[k]

    def _known_enemies(self, t, me, max_age):
        return [v for v in self.tracked.values() if t - v["t"] <= max_age]

    def _riskpoint(self, obs, me, target):
        """Minimum-risk movement (Robocode melee style), adapted to 3D cover + zone."""
        t = obs["t"]
        pos = me["pos"]
        w = self.world
        if getattr(self, "_rp", None) and t < self._rp_until and math.hypot(self._rp[0] - pos[0], self._rp[1] - pos[1]) > 3:
            return self._rp
        z = obs["zone"]
        nc, nr = z["next_center"], z["next_radius"]
        cc, cr = z["center"], z["radius"]
        known = self._known_enemies(t, me, 6.0)
        myhp = max(me["hp"], 1)
        hist = getattr(self, "_hist", [])
        best, bs = None, 1e18
        cands = [(pos[0], pos[1])]
        for r in (12, 25, 40, 60):
            for k in range(8):
                a = k * math.pi / 4 + random.uniform(-0.3, 0.3)
                cands.append((pos[0] + math.cos(a) * r, pos[1] + math.sin(a) * r))
        opt = None
        if target is not None:
            opt = self._opt_range(me)
        for (x, y) in cands:
            if w and w.blocked_at(x, y):
                continue
            risk = 0.0
            gz = w.height(x, y) if w else pos[2]
            eye = (x, y, gz + 8)
            for e in known:
                ex, ey, ez = e["pos"]
                d2 = max((x - ex) ** 2 + (y - ey) ** 2, 25.0)
                ratio = min(2.0, max(0.3, e["hp"] / myhp))
                a1 = math.atan2(pos[1] - y, pos[0] - x)
                a2 = math.atan2(ey - y, ex - x)
                perp = abs(math.cos(a1 - a2))
                risk += ratio * (1 + perp) / d2 * 2.0e4
                if e["src"] == "see" and w and d2 < 240 ** 2 and w.los(eye, (ex, ey, ez + 8)):
                    risk += P["expose_w"] * ratio / (1 + math.sqrt(d2) / 120)
            # stay deep in zone
            dz = math.hypot(x - nc[0], y - nc[1])
            if dz > nr * 0.85:
                risk += 2.0 + (dz - nr * 0.85) * 0.05
            if math.hypot(x - cc[0], y - cc[1]) > cr - 5:
                risk += 20
            # cover: walls nearby are good
            if w:
                i, j = w.cell_of(x, y)
                walls = 0
                for dj in (-2, 0, 2):
                    for di in (-2, 0, 2):
                        if w.inb(i + di, j + dj) and w.block[(j + dj) * w.nx + i + di]:
                            walls += 1
                risk -= P["cover_w"] * min(walls, 3) * 0.3
            # don't sit still in one place (anti-gravity from own history)
            for hx, hy in hist[-6:]:
                risk += 0.4 / max(25.0, (x - hx) ** 2 + (y - hy) ** 2) * 25
            # travel cost
            risk += math.hypot(x - pos[0], y - pos[1]) * 0.004
            if target is not None and opt:
                td = math.hypot(x - target["pos"][0], y - target["pos"][1])
                risk += abs(td - opt) * 0.02
                if w and not w.los(eye, (target["pos"][0], target["pos"][1], target["pos"][2] + 4.5)):
                    risk += 1.5
            if risk < bs:
                bs, best = risk, (x, y)
        if best is None:
            best = (pos[0], pos[1])
        self._rp = best
        self._rp_until = t + random.uniform(0.6, 1.4)
        hist.append((pos[0], pos[1]))
        self._hist = hist[-12:]
        return best

    def _opt_range(self, me):
        kinds = [wp["kind"] for wp in me["weapons"] if wp]
        if "laser" in kinds:
            return 150.0
        if "lightning" in kinds:
            return 35.0
        if "mortar" in kinds:
            return 120.0
        return 90.0

    def _hunt_target(self, me):
        pos = me["pos"]
        best, bs = None, 1e18
        t = max((v["t"] for v in self.tracked.values()), default=0)
        for k, v in self.tracked.items():
            if t - v["t"] > 6:
                continue
            d = math.hypot(v["pos"][0] - pos[0], v["pos"][1] - pos[1])
            if d > 260:
                continue
            s = d + v["hp"] * 0.08
            if v["src"] == "snd" and v.get("kind") in ("gun", "laser", "lightning", "mortar"):
                s -= 60  # a fight is happening there: third-party it
            if s < bs:
                bs, best = s, v["pos"]
        return best

    def _cover_point(self, pos, threat_pos, bearing):
        """Pick a nearby reachable point with no LOS to the threat."""
        w = self.world
        if threat_pos is None and bearing is not None:
            threat_pos = (pos[0] + math.cos(bearing) * 80, pos[1] + math.sin(bearing) * 80, pos[2])
        if w is None or threat_pos is None:
            if threat_pos is None:
                return (pos[0], pos[1])
            ax, ay = norm2((pos[0] - threat_pos[0], pos[1] - threat_pos[1]))
            return (pos[0] + ax * 40, pos[1] + ay * 40)
        tp = (threat_pos[0], threat_pos[1], threat_pos[2] + 8)
        best, bs = None, 1e18
        for r in (10, 20, 32, 45):
            for k in range(12):
                a = k * math.pi / 6
                x, y = pos[0] + math.cos(a) * r, pos[1] + math.sin(a) * r
                if w.blocked_at(x, y):
                    continue
                z = w.height(x, y)
                if w.los((x, y, z + 6), tp):
                    continue
                dthreat = math.hypot(x - threat_pos[0], y - threat_pos[1])
                s = r - dthreat * 0.3
                if s < bs:
                    bs, best = s, (x, y)
            if best:
                return best
        ax, ay = norm2((pos[0] - threat_pos[0], pos[1] - threat_pos[1]))
        return (pos[0] + ax * 40, pos[1] + ay * 40)

    def _navigate(self, obs, pos, goal, t):
        if goal is None:
            return (0.0, 0.0)
        gx, gy = goal
        dist = math.hypot(gx - pos[0], gy - pos[1])
        if dist < 1.5:
            return (0.0, 0.0)
        w = self.world
        if w is None or dist < 6:
            return norm2((gx - pos[0], gy - pos[1]))
        need = (self.path_goal is None or math.hypot(self.path_goal[0] - gx, self.path_goal[1] - gy) > 8
                or t - self.path_t > 2.0 or not self.path)
        if need:
            self.path = w.path((pos[0], pos[1]), (gx, gy))
            self.path_goal = (gx, gy)
            self.path_t = t
        # advance along path
        while len(self.path) > 1 and math.hypot(self.path[0][0] - pos[0], self.path[0][1] - pos[1]) < 4.5:
            self.path.pop(0)
        # skip ahead if direct line clear
        wp = self.path[0]
        if len(self.path) > 2:
            nxt = self.path[2]
            if self._walk_clear(pos, nxt):
                wp = nxt
        return norm2((wp[0] - pos[0], wp[1] - pos[1]))

    def _walk_clear(self, a, b):
        w = self.world
        d = math.hypot(b[0] - a[0], b[1] - a[1])
        n = int(d / 2) + 1
        for s in range(1, n + 1):
            f = s / n
            if w.blocked_at(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f):
                return False
        return True

    def _unstick(self, me, move, t):
        pos = me["pos"]
        jump = jet = False
        want = math.hypot(*move) > 0.5
        spd = math.hypot(me["vel"][0], me["vel"][1])
        if want and spd < 2.0 and me["grounded"]:
            self.stuck_t += 0.1
        else:
            self.stuck_t = max(0, self.stuck_t - 0.05)
        if self.stuck_t > 0.8:
            self.stuck_t = 0
            self.unstick_until = t + 1.2
            a = math.atan2(move[1], move[0]) + random.choice((-1, 1)) * random.uniform(0.6, 1.6)
            self.unstick_dir = (math.cos(a), math.sin(a))
            self.path = []
            jump = True
        if t < self.unstick_until:
            if t < self.unstick_until - 0.6:
                jump = jump or me["grounded"]
                jet = me["energy"] > 20 and not me["grounded"]
                return move, jump, jet
            return self.unstick_dir, jump, jet
        return move, jump, jet

    # ------------------------------------------------------------------
    def _lead(self, me, tgt_pos, tgt_vel, speed, muzzle_z):
        sx, sy, sz = me["pos"][0], me["pos"][1], me["pos"][2] + muzzle_z
        tx, ty, tz = tgt_pos[0], tgt_pos[1], tgt_pos[2] + 4.5
        vx, vy, vz = tgt_vel
        tt = 0.0
        for _ in range(3):
            px, py, pz = tx + vx * tt, ty + vy * tt, tz + vz * 0.3 * tt
            tt = math.dist((px, py, pz), (sx, sy, sz)) / speed
        px, py, pz = tx + vx * tt, ty + vy * tt, tz + vz * 0.3 * tt
        yaw = math.atan2(py - sy, px - sx)
        pitch = math.atan2(pz - sz, math.hypot(px - sx, py - sy))
        return yaw, pitch, math.dist((px, py, pz), (sx, sy, sz))

    def _mortar_pitch(self, dist, dh, v, g):
        # solve low arc for range dist with height diff dh
        v2 = v * v
        disc = v2 * v2 - g * (g * dist * dist + 2 * dh * v2)
        if disc < 0:
            return None
        return math.atan((v2 - math.sqrt(disc)) / (g * dist))

    def _aim_and_fire(self, obs, me, target, npcs, act, mode):
        pos = me["pos"]
        stats = me["stats"]
        muzzle = stats.get("muzzle_height", 7)
        weapons = me["weapons"]
        fire = [False, False]
        aim = None
        w = self.world
        eye = (pos[0], pos[1], pos[2] + muzzle)
        tgt = target
        tgt_kind = "mech"
        if tgt is None and npcs and P["farm_npcs"] and mode not in ("retreat", "zone_run"):
            # only engage drones that are already hostile or close
            nn = sorted(npcs, key=lambda m: math.dist(m["pos"], pos))
            if nn and math.dist(nn[0]["pos"], pos) < 70:
                tgt, tgt_kind = nn[0], "npc"
        crate = None
        if tgt is None and mode in ("crate", "idle", "loot"):
            cs = sorted(obs.get("crates", []), key=lambda c: math.dist(c["pos"], pos))
            if cs and math.dist(cs[0]["pos"], pos) < 60:
                crate = cs[0]
        if tgt is not None:
            gw = weapons[0]
            gspeed = gw["stats"]["speed"] if gw and gw["kind"] == "gun" else 252
            yaw, pitch, d = self._lead(me, tgt["pos"], tgt.get("vel", (0, 0, 0)), gspeed, muzzle)
            if tgt_kind == "npc":
                pitch = math.atan2(tgt["pos"][2] + 1.7 - pos[2] - muzzle, math.hypot(tgt["pos"][0] - pos[0], tgt["pos"][1] - pos[1]))
            aim = [yaw, pitch]
            clear = w.los(eye, (tgt["pos"][0], tgt["pos"][1], tgt["pos"][2] + (4.5 if tgt_kind == "mech" else 1.7))) if w else True
            ay, ap = me["aim"]
            err = abs(ang_diff(ay, yaw)) + abs(ap - pitch) * 0.5
            tol = max(0.012, math.atan2(2.0, max(d, 1)))
            for i, wp in enumerate(weapons):
                if not wp:
                    continue
                k = wp["kind"]
                st = wp["stats"]
                if k == "gun":
                    if clear and d < st["range"] and err < tol * 1.6:
                        fire[i] = True
                    if wp.get("ammo", 1) == 0 and wp.get("reload", 0) == 0:
                        act["reload"] = True
                elif k == "laser":
                    ch = wp.get("charge", 0)
                    if wp["cooldown"] <= 0 and d < st["range"] and clear:
                        full = st["charge"]
                        if ch < full * 0.95:
                            fire[i] = True  # keep charging
                        else:
                            fire[i] = not (err < tol)  # release when on target
                    elif ch > 0:
                        fire[i] = not (err < tol * 2)  # target lost: release asap if aligned
                elif k == "lightning":
                    if d < st["range"] * 0.95 and abs(ang_diff(ay, yaw)) < math.radians(st["cone_deg"]) * 0.8 and clear:
                        fire[i] = me["energy"] > 25
                elif k == "mortar":
                    if wp["cooldown"] <= 0 and 25 < d < 220:
                        mp = self._mortar_pitch(math.hypot(tgt["pos"][0] - pos[0], tgt["pos"][1] - pos[1]),
                                                tgt["pos"][2] - pos[2] - stats.get("height", 9) - 0.5,
                                                st["speed"], st["gravity"])
                        if mp is not None and not fire[0]:
                            # lob: temporarily aim up then fire when aligned
                            if abs(ang_diff(ay, yaw)) < 0.05 and abs(ap - mp) < 0.06:
                                fire[i] = True
                            elif not clear or (weapons[0] and weapons[0].get("ammo", 1) == 0):
                                aim = [yaw, mp]
        elif crate is not None:
            yaw = math.atan2(crate["pos"][1] - pos[1], crate["pos"][0] - pos[0])
            pitch = math.atan2(crate["pos"][2] + 1.2 - pos[2] - muzzle, math.hypot(crate["pos"][0] - pos[0], crate["pos"][1] - pos[1]))
            aim = [yaw, pitch]
            ay, ap = me["aim"]
            if weapons[0] and weapons[0]["kind"] == "gun" and abs(ang_diff(ay, yaw)) < 0.05 and \
                    (w is None or w.los(eye, (crate["pos"][0], crate["pos"][1], crate["pos"][2] + 1.2))):
                fire[0] = True
        else:
            # face the most recent threat (rear armor + vision), else look where we move / scan
            t = obs["t"]
            snd = [s for s in obs.get("sounds", []) if s["kind"] in ("gun", "laser", "laser_charge", "lightning", "step", "boost", "mortar", "jet")]
            if t - self.last_damaged_t < 4 and self.last_damage_bearing is not None:
                aim = [self.last_damage_bearing, 0.0]
            elif snd:
                near = sorted(snd, key=lambda s: {"near": 0, "mid": 1, "far": 2}[s["dist"]])
                aim = [near[0]["bearing"], 0.0]
            else:
                mv = act.get("move", [0, 0])
                if math.hypot(*mv) > 0.3:
                    aim = [math.atan2(mv[1], mv[0]) + math.sin(t * 1.3) * 0.9, 0.0]
                else:
                    aim = [me["aim"][0] + 0.25, 0.0]
            # keep laser from auto-firing at nothing
        if aim is not None:
            aim[1] = max(-0.69, min(1.29, aim[1]))
            act["aim"] = [round(aim[0], 4), round(aim[1], 4)]
        act["fire"] = fire


if __name__ == "__main__":
    mf.run(Bot)
