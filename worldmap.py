"""Static map model: a coarse occupancy grid for pathing and line-of-sight."""
import heapq
import json
import math
import os
import struct

CELL = 4.0


class World:
    def __init__(self, map_dir):
        with open(os.path.join(map_dir, "v2", "world.json")) as f:
            w = json.load(f)
        t = w["terrain"]
        self.tnx, self.tny = t["nx"], t["ny"]
        self.tminx, self.tminy, self.tstep = t["minX"], t["minY"], t["step"]
        with open(os.path.join(map_dir, "v2", t.get("file", "terrain.i16")), "rb") as f:
            raw = f.read()
        n = self.tnx * self.tny
        self.terr = struct.unpack("<%dh" % n, raw[: 2 * n])
        b = w["bounds"]
        self.minx, self.miny = b["minX"], b["minY"]
        self.maxx, self.maxy = b["maxX"], b["maxY"]
        self.nx = int((self.maxx - self.minx) / CELL) + 1
        self.ny = int((self.maxy - self.miny) / CELL) + 1
        N = self.nx * self.ny
        self.ground = [0.0] * N
        for j in range(self.ny):
            for i in range(self.nx):
                x, y = self.cell_center(i, j)
                self.ground[j * self.nx + i] = self.height(x, y)
        # building occupancy: top / base heights (absolute z); 0-length means free
        self.btop = [-1e9] * N
        self.bbase = [1e9] * N
        self.block = bytearray(N)  # 1 = cannot walk
        for p in w["prisms"]:
            ring = p["ring"]
            xs, ys = ring[0::2], ring[1::2]
            holes = p.get("holes") or []
            i0, j0 = self.cell_of(min(xs), min(ys))
            i1, j1 = self.cell_of(max(xs), max(ys))
            for j in range(max(0, j0), min(self.ny - 1, j1) + 1):
                for i in range(max(0, i0), min(self.nx - 1, i1) + 1):
                    cx, cy = self.cell_center(i, j)
                    if not _pip(cx, cy, ring):
                        continue
                    if any(_pip(cx, cy, h) for h in holes if h):
                        continue
                    k = j * self.nx + i
                    if p["top"] > self.btop[k]:
                        self.btop[k] = p["top"]
                    if p["base"] < self.bbase[k]:
                        self.bbase[k] = p["base"]
                    g = self.ground[k]
                    if p["base"] < g + 9.5 and p["top"] > g + 1.2:
                        self.block[k] = 1
        # cost near walls so paths keep clearance
        self.cost = [1.0] * N
        for j in range(self.ny):
            for i in range(self.nx):
                k = j * self.nx + i
                if self.block[k]:
                    continue
                c = 1.0
                for dj in (-1, 0, 1):
                    for di in (-1, 0, 1):
                        ii, jj = i + di, j + dj
                        if 0 <= ii < self.nx and 0 <= jj < self.ny and self.block[jj * self.nx + ii]:
                            c = 2.5
                self.cost[k] = c

    # --- geometry helpers
    def cell_of(self, x, y):
        return int((x - self.minx) / CELL), int((y - self.miny) / CELL)

    def cell_center(self, i, j):
        return self.minx + (i + 0.5) * CELL, self.miny + (j + 0.5) * CELL

    def inb(self, i, j):
        return 0 <= i < self.nx and 0 <= j < self.ny

    def height(self, x, y):
        fx = (x - self.tminx) / self.tstep
        fy = (y - self.tminy) / self.tstep
        i = min(max(int(fx), 0), self.tnx - 2)
        j = min(max(int(fy), 0), self.tny - 2)
        ax, ay = min(max(fx - i, 0), 1), min(max(fy - j, 0), 1)
        t = self.terr
        n = self.tnx
        h00, h10 = t[j * n + i], t[j * n + i + 1]
        h01, h11 = t[(j + 1) * n + i], t[(j + 1) * n + i + 1]
        return ((h00 * (1 - ax) + h10 * ax) * (1 - ay) + (h01 * (1 - ax) + h11 * ax) * ay) * 0.01

    def blocked_at(self, x, y):
        i, j = self.cell_of(x, y)
        if not self.inb(i, j):
            return True
        return self.block[j * self.nx + i] == 1

    def los(self, a, b):
        """True if no building blocks the 3D segment a->b (coarse)."""
        dx, dy, dz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
        d = math.hypot(dx, dy)
        steps = int(d / (CELL * 0.7)) + 1
        nx = self.nx
        for s in range(1, steps):
            f = s / steps
            x, y, z = a[0] + dx * f, a[1] + dy * f, a[2] + dz * f
            i, j = int((x - self.minx) / CELL), int((y - self.miny) / CELL)
            if not (0 <= i < nx and 0 <= j < self.ny):
                return False
            k = j * nx + i
            if self.bbase[k] < z < self.btop[k]:
                return False
            if z < self.ground[k] - 0.5:
                return False
        return True

    def nearest_free(self, i, j):
        if self.inb(i, j) and not self.block[j * self.nx + i]:
            return i, j
        for r in range(1, 12):
            for dj in range(-r, r + 1):
                for di in range(-r, r + 1):
                    ii, jj = i + di, j + dj
                    if self.inb(ii, jj) and not self.block[jj * self.nx + ii]:
                        return ii, jj
        return i, j

    def path(self, start, goal, max_exp=3500):
        """A* on the grid. Returns list of world (x,y) waypoints (may be partial)."""
        si, sj = self.nearest_free(*self.cell_of(*start))
        gi, gj = self.nearest_free(*self.cell_of(*goal))
        nx = self.nx
        s, g = sj * nx + si, gj * nx + gi
        if s == g:
            return [tuple(goal[:2])]
        openh = [(0.0, s)]
        gs = {s: 0.0}
        came = {}
        best, bestd = s, 1e18
        exp = 0
        cost, block = self.cost, self.block
        SQ2 = 1.4142
        while openh and exp < max_exp:
            _, cur = heapq.heappop(openh)
            if cur == g:
                best = g
                break
            exp += 1
            ci, cj = cur % nx, cur // nx
            hd = math.hypot(ci - gi, cj - gj)
            if hd < bestd:
                bestd, best = hd, cur
            gc = gs[cur]
            for di, dj, w in ((1, 0, 1), (-1, 0, 1), (0, 1, 1), (0, -1, 1),
                              (1, 1, SQ2), (1, -1, SQ2), (-1, 1, SQ2), (-1, -1, SQ2)):
                ii, jj = ci + di, cj + dj
                if not (0 <= ii < nx and 0 <= jj < self.ny):
                    continue
                k = jj * nx + ii
                if block[k]:
                    continue
                if di and dj and (block[cj * nx + ii] or block[jj * nx + ci]):
                    continue
                ng = gc + w * cost[k]
                if ng < gs.get(k, 1e18):
                    gs[k] = ng
                    came[k] = cur
                    heapq.heappush(openh, (ng + math.hypot(ii - gi, jj - gj) * 1.05, k))
        out = []
        cur = best
        while cur in came:
            out.append(self.cell_center(cur % nx, cur // nx))
            cur = came[cur]
        out.reverse()
        if best == g:
            out.append(tuple(goal[:2]))
        return out or [tuple(goal[:2])]


def _pip(x, y, ring):
    inside = False
    n = len(ring) // 2
    j = n - 1
    for i in range(n):
        xi, yi = ring[2 * i], ring[2 * i + 1]
        xj, yj = ring[2 * j], ring[2 * j + 1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi:
            inside = not inside
        j = i
    return inside
