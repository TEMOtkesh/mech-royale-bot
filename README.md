# mech-royale-bot

Team Sulertia's bot for the Builders Buildathon Mech Royale track. Runs on bun (`main.ts` + `brain.js`); behaviour is chosen in `params.json`.

## Attribution
- `mechfight.ts` is the official TypeScript protocol wrapper from the Builders starter kit (mechfight-kit.tar.gz).
- `py/mechfight.py` is the official Python wrapper from the same kit (kept for reference).
- Everything else is our own code. MIT licensed (see LICENSE).

## Ideas credited

All code in `brain.js` is our own. Several behaviours were inspired by ideas other teams published in their READMEs and notes (no code taken):

- Laser first, no running from the practice squad, first strike on approaching mechs: tin-buckeye (lukejwaszyn/mech-royale, MIT).
- Laser kiting at long range only while holding a laser, gun lead learned per opponent: zoro (Specz04/zoro, MIT).
- Charging the laser out of sight: andrew-zhouu/builders-mech-royale-2026 (MIT).
- Selective targeting of only the hunters that come for us: youraverageguy-123/mechfight-bot.
