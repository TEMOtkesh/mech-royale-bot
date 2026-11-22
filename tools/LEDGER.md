# Mech Royale submission ledger (96 fresh seeds, from ~10:00 Tbilisi)

Score = mean(16 − place) over 96 practice matches. Rank-32 cutoff: 5.54 (10:28) → 5.91 (14:15) → 5.99 (16:24) → 6.04 (17:13).
Noise from a small behaviour change is about ±0.15; an identical commit re-scores identically.

## Our own bot (`main`, brain.js — 100% our code)

| Build | Change (vs. its base) | Base | Score | Verdict |
|---|---|---|---|---|
| v45straynp | hostile-only from start + stray-shot safety + loot fix | — | 4.61 | base |
| v48noretnp | never retreat in practice | v45 | 5.06 | ✅ +0.45 |
| v49errandnp | safe errands | v45 | 4.58 | ❌ |
| v51err | safe errands | v48 | 4.75 | ❌ |
| v52watch | overwatch spot | v48 | 4.95 | ❌ |
| v53nohide | no hiding at low HP | v48 | 5.23 | ✅ (without laser) |
| v61laser | laser first (laser_run 220) | v48 | 5.43 | ✅ +0.37 |
| v62lasH | laser + no hiding | v53 | 4.95 | ❌ hiding helps with laser |
| v63lasXH | aggressive laser run + no hiding | v53 | 5.45 | ~ |
| v66blind | turn to unseen attacker | v61 | 5.34 | ~ |
| v69lasX | aggressive laser run | v61 | 5.34 | ~ |
| b2kite | bundle: dmg upgrades, reload, regen, kite+boost, target laser carriers | v61 | 5.26 | ❌ |
| b6peek | b2 + laser peek | v61 | 5.22 | ❌ |
| b8seek | b2 + seek fights at 70% HP | v61 | 5.06 | ❌ |
| b9seekP | b2 + seek + peek | v61 | 5.33 | ~ |
| c1top | aim at top over low cover | v61 | 5.15 | ❌ |
| c2topX | aim at top over low cover | v63 | 5.28 | ❌ |
| **m2allX** | aggressive laser + cube piles 110 m + damage-first + tac reload + lightning avoid | v61 | **5.60** | ✅ own best |
| m7econ | + drone/crate farming | m2 | 5.24 | ❌ |
| m3allXfar | + long range (gun 150 / laser 170) | m2 | 5.31 | ❌ |
| m4allXH | + no hiding | m2 | 5.32 | ❌ |
| m5nofin | + no chasing weak targets | m2 | 5.23 | ❌ |
| m1all | normal laser run | m2 | 5.39 | ❌ |
| q1laskite | + long range with laser only (160) | m2 | queued | |
| q2laskiteW | + q1 with stronger range keeping | m2 | queued | |
| q3lead | + gun lead learned per opponent | m2 | queued | |

## zoro line (branch `zoro`; Specz04/zoro, MIT, credited)

| Build | Change | Base | Score | Verdict |
|---|---|---|---|---|
| Z1 | practice damage-first upgrades + no low-HP retreat vs squad | zoro | 5.91 | ✅ |
| **Z2** | + never break off a fight vs squad | Z1 | **6.04** | ✅ best (rank 33) |
| Z5 | + hunt at smaller advantage (0.7) | Z2 | 5.79 | ❌ |
| Z6 | + hunt further out (240/260) | Z2 | 5.86 | ❌ |
| Z10 | + laser first harder (LaserValue 9, LaserSprint 60) | Z2 | 5.84 | ❌ |
| Z11 | + hunt only nearby (SquadHunt 80 / laser 100) | Z2 | queued 17:48 | |
| Z12 | + hunt only with a clear advantage (SquadEngage 1.3) | Z2 | queued | |
| Z7 | + no fight seeking | Z2 | queued | |
| Z8 | + wider cube economy (LootRadius 300, WantCubes 15) | Z2 | queued | |
| Z9 | + no long-range kiting vs squad | Z2 | queued | |

## Lessons

- Against the squad, commitment wins: no retreat (+0.45 own, +0.13 zoro); cautious variants lose (also reported by three other teams).
- Laser first is the biggest single gain (+0.37); hiding helps while holding a laser.
- Cube piles from kills matter; drone/crate farming does not.
- zoro: hunting more (Z5, Z6) lost → testing hunting less (Z11, Z12, Z7): idle house bots only come when it is their turn.
- Our long-range positioning has failed three times; seeking fights failed; top-aim failed twice.
