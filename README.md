# Sulertia mech bot

A `mechfight/1` bot for the Builders Buildathon **Mech Royale** track, by team Sulertia. Go, standard
library only. Built on the open-source [zoro](https://github.com/Specz04/zoro) bot (MIT, see `LICENSE`).

## What we built

### 1. Tier-aware fight odds against the house squad
The practice squad is 4 easy, 4 medium, 4 hard and 3 expert bots that hunt us weakest first, one at
first and more as we thin them out. That means the number of mechs already dead tells us which tier is
coming next. Our odds model scales a house bot's expected damage by that tier (easy ×0.6, medium ×0.8,
hard ×1.0, expert ×1.2), so the bot takes fights eagerly against the early easy hunters and picks them
more carefully against the late experts (`SquadTiers`, `tierFactor` in `internal/pilot/odds.go`).

### 2. Vision first: seeing hunters at 200 m instead of 45 m
Every hunter walks straight at us. Seen at 200 m, it takes about six laser shots (about 1,600 damage,
more than its 1,400 HP) before it reaches gun range. But a mech only sees 200 m inside the 120° cone its
torso faces, and 45 m everywhere else, so a hunter walking in from outside the cone turns a free kill
into a close-range coin flip. Two changes follow from that:
- Between fights the torso sweeps around the nearest squad member seen in the last 20 s, which is where
  the next hunter comes from (`SquadLook`, `squadBearingOK` in `internal/pilot/ballistics.go`).
- Sensors (+25 m vision, half the sound-bearing error) come right after the drum magazine and the laser
  lens in the practice upgrade order.

### 3. Fight only what comes for us
House bots that are not hunting us stay idle until their turn. Attacking them early wakes stronger
bots sooner. We cut the hunting radius against the squad to nearby mechs only (`SquadHunt`,
`SquadHuntLaser`). In our tests this was the largest single gain (5.85 → 6.24).

### 4. Commit to every fight against the squad
The squad shares vision and follows anyway, so a retreat across open ground only gives away free hits.
Against the squad we never break off a fight and never retreat on low health (`SquadNoRetreat`,
`SquadRetreatHP`). This gained +0.45 in our own earlier bot and +0.13 here.

### 5. Damage before armour in practice
The squad comes one hunter after another, so killing each one faster beats taking less damage: the
drum magazine (+31 % sustained gun damage) and the lens (+18 % laser) beat 8 % armour. Practice
upgrades are taken damage first (`SquadDamageFirst`, `practiceUpgradeOrder` in `internal/pilot/loot.go`).

### 6. Final rounds: free-for-all from the first tick
After the submission cutoff every match is a free-for-all, so from that moment the bot plays its
free-for-all game from the first tick instead of waiting for deaths it did not cause to prove it
(`FFAClock`, `internal/pilot/lobby.go`).

### How we got here
We tested about 80 versions against the practice squad over two days, logging every result
(`tools/LEDGER.md` on our main branch). We also built and tested our own bot from scratch (`brain.js`
on main), and its findings drove most of the changes above: laser first, no retreat, cube collection,
selective targeting. We audited 94 recorded matches of our own for how, when and why we died: most
deaths were close-range one-on-ones with only the gun, started during side-trips or while retreating.

### Credits
The base bot is zoro (Specz04, MIT). Ideas also came from the published notes of tin-buckeye,
andrew-zhouu and youraverageguy-123.

## Technical notes

### Layout

| Path | What it is |
| --- | --- |
| `cmd/zoro` | Protocol loop: answers only the newest observation, never writes anything else to stdout, has a fallback brain if the map cannot be loaded |
| `internal/wire` | `mechfight/1` message types and the command encoder |
| `internal/arena` | Map loading (`/arena/v2`), spatial buckets, terrain, ray casts, line of sight, tree cover |
| `internal/grid` | 2 m walk grid, A*/Dijkstra, connected regions, rooftop regions, top-surface routes, openness map |
| `internal/pilot` | The agent: memory, ballistics and lead, fight odds, dodging, cover, roofs, loot, zone, decision |

## Build

```sh
docker build --platform linux/amd64 -t zoro .
```

To build without Docker (Go 1.25 or newer):

```sh
go build -o zoro ./cmd/zoro
go test ./...
```

To run the kit's conformance check against the image, from the `mechfight-kit` folder:

```sh
python3 check/check.py --map-dir /arena -- docker run --rm -i --network none --cpus 1 --memory 512m \
  --read-only --tmpfs /tmp:rw,size=64m --user 65534:65534 -v "$PWD/arena:/arena:ro" zoro
```

## Runtime

- All map analysis runs before answering `hello`. Decisions take a few milliseconds at most.
- No network access, no files written.
- A panic inside a decision is caught and answered by repeating the previous movement, so the mech
  never goes silent.

## License

MIT. See `LICENSE` (it also carries the notice of the MIT project this was originally derived from).

<!-- build 1 -->

<!-- build 2 -->

<!-- build 3 -->
