# zoro

A `mechfight/1` bot for the Builders Buildathon **Mech Royale** track. It pilots one mech in the
16-mech battle royale: it reads observations as JSON lines on stdin and answers each one with a single
action line on stdout.

Go, standard library only. It recognises practice lobbies and hunts the house squad there; in a
free-for-all it plays a careful, cover-first game.

## Layout

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

## Team Sulertia changes (fork notice)

Based on [zoro](https://github.com/Specz04/zoro) by Specz04, MIT licensed (see `LICENSE`, kept unchanged).
Changes, all limited to practice games against the house squad (free-for-all play is unchanged):

- `SquadDamageFirst`: against the squad, upgrades are taken damage first (drum magazine, lens, tungsten, capacitors, rotary feed) before plating and armor.
- `SquadRetreatHP` 0.2 → 0: no low-health retreat from the squad.
- `SquadNoRetreat` (on)
- no long-range kiting against the squad: never break off a fight against the squad.
