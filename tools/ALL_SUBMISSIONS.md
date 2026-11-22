# Mech Royale — every submission (team Sulertia)

Times are Tbilisi. *Seeds*: `old` = scored on the 48 fixed seeds before the ~10:00 rescore (not comparable with `new`); `new` = 96 fresh random seeds per submission (each run is also a fresh draw, about ±0.15).
**Practice gives only the mean score; the platform publishes no per-match data (how/when/why we died) for practice runs.** Death data exists only from our live bench (see the end).

| # | Time | Build | Bot | Strategy / characteristics | Seeds | Score | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | Sat 23:31 | Prey v1 | own | min-risk movement, cover, silent walking, max-HP farming | old | **3.31** |  |
| 2 | Sat 23:34 | Predator v1 | own | hunt weakest, third-party fights, optimal weapon range | old | **2.63** |  |
| 3 | Sat 23:42 | Experiment | own | turtle (hold position, return fire at all ranges) | old | **2.88** |  |
| 4 | Sat 23:50 | Switch to JS/bun bot (5-10x faster decisions); experiment | own | ghost | old | **2.71** |  |
| 5 | Sun 00:31 | v4.1 ghost until mode known; squad=prey-peek fighter; ffa restores base | own | v4.1 ghost until mode known; squad=prey-peek fighter; ffa restores base | old | **2.94** |  |
| 6 | Sun 00:35 | Experiment | own | idle baseline (stand still, never fire) | old | **0.02** |  |
| 7 | Sun 00:42 | v5 prey-peek squad + finisher (chase weakened hunters) | own | v5 prey-peek squad + finisher (chase weakened hunters) | old | **3.77** |  |
| 8 | Sun 00:50 | v6 prey-peek squad + finisher + cube economy (drones/crates) + damage upgrades | own | v6 prey-peek squad + finisher + cube economy (drones/crates) + damage upgrades | old | **3.50** |  |
| 9 | Sun 01:28 | v7.3 laser+lightning, no cube cap | own | v7.3 laser+lightning, no cube cap | old | **3.48** |  |
| 10 | Sun 01:32 | v8.3 fortress, no cube cap (more cubes = more upgrades) | own | v8.3 fortress, no cube cap (more cubes = more upgrades) | old | **3.27** |  |
| 11 | Sun 01:35 | v9 = v5 params on current brain (dodge, triangle targeting, escape at 3) | own | v9 = v5 params on current brain (dodge, triangle targeting, escape at 3) | old | **3.52** |  |
| 12 | Sun 01:37 | v9 brawler | own | predator, no peek, finisher | old | **3.04** |  |
| 13 | Sun 01:43 | v10 | own | fix laser aim (hitscan: aim at target, not gun lead point); v5 params | old | **3.92** |  |
| 14 | Sun 01:50 | v11a | own | v10 + squad mode from 20s | old | **3.85** |  |
| 15 | Sun 02:29 | v12roof | own | v10 + roof camping in squad mode | old | **2.17** |  |
| 16 | Sun 02:32 | v13tight | own | v10 + tight gun tolerance + aim latency | old | **3.63** |  |
| 17 | Sun 02:37 | v16aggr | own | less cautious squad combat (lower retreat/recover/hide thresholds, full-range fire, grab cubes) | old | **4.10** |  |
| 18 | Sun 02:40 | v16berserk | own | less cautious squad combat (lower retreat/recover/hide thresholds, full-range fire, grab cubes) | old | **4.04** |  |
| 19 | Sun 02:43 | v17nododge | own | v16aggr + one change | old | **3.90** |  |
| 20 | Sun 02:50 | v17noescape | own | v16aggr + one change | old | **4.25** |  |
| 21 | Sun 03:29 | v19bd | own | v17noescape (4.25) + bullet dodge / hostile-only squad targeting | old | **4.63** |  |
| 22 | Sun 03:37 | v22core | own | range-keeping fight movement (local position search); base of the Saturday chain | old | **4.94** |  |
| 23 | Sun 03:45 | v24fb | own | v22 + boost while fighting | old | **4.73** |  |
| 24 | Sun 03:51 | v23ammo | own | v22 + track enemy ammo, push while they reload | old | **4.81** |  |
| 25 | Sun 04:10 | v27open | own | v22 + fix of the opening target choice | old | **4.90** |  |
| 26 | Sun 04:12 | v23pm | own | v22 + peek-movement variant | old | **4.88** |  |
| 27 | Sun 04:30 | v30G | own | another team's public strategy rebuilt in our code (diagnostic) | old | **4.00** |  |
| 28 | Sun 04:39 | v32exec | own | aim execution fix (slew-fire) | old | **4.67** |  |
| 29 | Sun 04:50 | v29prac | own | practice-mode tuning | old | **4.69** |  |
| 30 | Sun 04:54 | v31fix | own | bug-fix bundle | old | **4.50** |  |
| 31 | Sun 05:12 | v34salt1 | own | v22core, different random salt (luck check) | old | **5.06** |  |
| 32 | Sun 05:13 | v36aim | own | aim tweak (tolerance/latency) | old | **4.48** |  |
| 33 | Sun 05:31 | v35strat b | own | strategy variant b | old | **4.98** |  |
| 34 | Sun 05:43 | v28late | own | late game: drop back to cautious play | old | **4.90** |  |
| 35 | Sun 05:51 | v26expose | own | exposure-penalty from bench data | old | **4.73** |  |
| 36 | Sun 05:56 | v38fin | own | finishing changes | old | **4.81** |  |
| 37 | Sun 06:13 | v39drop | own | supply-drop logic | old | **4.98** |  |
| 38 | Sun 06:19 | pb1 | own | screening run 1 (7-factor design) | old | **4.50** |  |
| 39 | Sun 06:32 | v42arm | own | arm up: look for weapons earlier | old | **4.92** |  |
| 40 | Sun 06:44 | v43aware | own | pre-aim at last seen enemies | old | **4.77** |  |
| 41 | Sun 06:51 | v44opennp | own | hostile-only targeting from match start | old | **5.23** |  |
| 42 | Sun 07:03 | v45straynp | own | + hold fire if a passive mech is in the line of fire | new | **4.61** | ★ new best |
| 43 | Sun 08:54 | v47farnp | own | + long range (gun 110 / laser 140) | old | **4.92** |  |
| 44 | Sun 08:56 | v48ttknp | own | + 'am I losing' time-to-kill fight rule | old | **4.08** |  |
| 45 | Sun 10:27 | v48noretnp | own | + never retreat in practice | new | **5.06** | ★ new best |
| 46 | Sun 12:10 | v49errandnp | own | v45 + safe side-trips | new | **4.58** |  |
| 47 | Sun 12:15 | v51err | own | v48 + safe side-trips | new | **4.75** |  |
| 48 | Sun 12:18 | v52watch | own | v48 + overwatch (covered spot, long sightline) | new | **4.95** |  |
| 49 | Sun 13:44 | v53nohide | own | v48 + no hiding at low HP | new | **5.23** | ★ new best |
| 50 | Sun 13:55 | v61laser | own | v48 + laser first (walk to a known laser, even mid-fight) | new | **5.43** | ★ new best |
| 51 | Sun 14:00 | v62lasH | own | laser first + no hiding | new | **4.95** |  |
| 52 | Sun 14:04 | v63lasXH | own | aggressive laser run + no hiding | new | **5.45** | ★ new best |
| 53 | Sun 14:08 | v66blind | own | v61 + turn to an unseen attacker | new | **5.34** |  |
| 54 | Sun 14:10 | v69lasX | own | v61 + aggressive laser run | new | **5.34** |  |
| 55 | Sun 14:48 | b2kite | own | v61 + damage-first upgrades, tac reload, regen hold, long-range kite with boost, target laser carriers | new | **5.26** |  |
| 56 | Sun 15:05 | b6peek | own | b2 + laser peek from cover | new | **5.22** |  |
| 57 | Sun 15:15 | b8seek | own | b2 + go find fights at ≥70% HP | new | **5.06** |  |
| 58 | Sun 15:18 | b9seekP | own | b2 + seek + peek | new | **5.33** |  |
| 59 | Sun 15:31 | c1top | own | v61 + aim at the top of half-covered targets | new | **5.15** |  |
| 60 | Sun 15:44 | c2topX | own | v63 + aim at the top | new | **5.28** |  |
| 61 | Sun 15:55 | m2allX | own | v61 + aggressive laser run + cube piles to 110 m + damage-first upgrades + tac reload + lightning avoidance | new | **5.60** | ★ new best |
| 62 | Sun 16:05 | m7econ | own | m2 + drone/crate farming | new | **5.24** |  |
| 63 | Sun 16:16 | m3allXfar | own | m2 + long range (gun 150 / laser 170) | new | **5.31** |  |
| 64 | Sun 16:19 | m4allXH | own | m2 + no hiding | new | **5.32** |  |
| 65 | Sun 16:32 | m5nofin | own | m2 + no chasing weak targets | new | **5.23** |  |
| 66 | Sun 16:48 | Z1 | zoro-based | zoro (MIT, credited) + damage-first practice upgrades + no low-HP retreat from the squad | new | **5.91** | ★ new best |
| 67 | Sun 17:12 | m1all | own | m2 with the normal laser run | new | **5.39** |  |
| 68 | Sun 17:14 | Z2 | zoro-based | Z1 + never break off a fight against the squad | new | **6.04** | ★ new best |
| 69 | Sun 17:21 | Z5 | zoro-based | Z2 + hunt the squad at a smaller advantage | new | **5.79** |  |
| 70 | Sun 17:24 | Z6 | zoro-based | Z2 + hunt the squad further out | new | **5.86** |  |
| 71 | Sun 17:33 | z10 | zoro-based | Z2 + laser first harder (LaserValue 9, LaserSprint 60) | new | **5.84** |  |
| 72 | Sun 17:48 | Z13 | zoro-based | Z2 + tier-aware house-bot odds (easy early, expert late) | new | **6.04** |  |

Not shown above: builds queued but not yet scored at 18:10 — V1, V2, V3 (zoro line bundles: vision + hunting + cubes, all with the free-for-all clock gate) and F1 (our own final candidate).

## How, when and why we die (only data that exists: 94 live-bench matches, older own versions, free-for-all rooms)

- **When:** 29% died before 60 s, 59% at 60–120 s (bench rooms run the zone at 2× speed).
- **Attackers:** 1 attacker 56%, 2 attackers 34%, 3+ 8% — mostly lost 1v1s.
- **Lost 1v1s:** we were gun-only in 46% (laser 33%, lightning 21%); they carried a laser 46% / lightning 36%; started under 120 m in 82%; our DPS 56 vs theirs 123; they had more HP (1,467 vs 1,200).
- **Won 1v1s:** we held a laser 75%, we opened 85%, the target was already hurt (938 HP).
- **What we were doing when the fatal fight began:** side-trips 62% (zone run 16, chasing a weak target 15, walking to a drop 13, cubes 8).
- **Mode at death:** retreating 63%, running for the zone 24%.
- **Mostly hit from behind:** 15% of deaths.

These findings drove the later builds: never retreat (v48, Z1/Z2), laser first (v61), cube piles (m2), tier-aware odds (Z13).
