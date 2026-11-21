// Squad-emulator worker: runs one private room at a time on the real game server.
const TIERS = ['easy','easy','easy','easy','medium','medium','medium','medium','hard','hard','hard','hard','expert','expert','expert'];
let TIERP = { easy: { aim_noise: 0.09, peek: false, dodge: false, finish: false }, medium: { aim_noise: 0.045, peek: true, dodge: false, finish: true }, hard: { aim_noise: 0.02, peek: true, dodge: true, finish: true }, expert: { aim_noise: 0.008, peek: true, dodge: true, finish: true } };
let HUNTER = { strategy: 'predator', retreat_hp: 0.25, engage_range: 260, hunt_hp: 0, expose_w: 1, farm_npcs: false, shoot_crates: false, weapon_pref: { laser: 3, lightning: 2, mortar: 1 }, squad_after: 1e9, overwhelm: 99, dodge: false };
let LATE = 0.55;
const brains = {};
let MAP = null, HB = null;
self.window = self;
async function loadBrain(sha) {
  if (brains[sha]) return brains[sha];
  const src = await (await fetch('https://raw.githubusercontent.com/TEMOtkesh/mech-royale-bot/' + sha + '/harness_brain.js')).text();
  (0, eval)(src); brains[sha] = self.Brain; return self.Brain;
}
const mkSid = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
const api = async (path) => await (await fetch('https://play.joinbuilders.org' + path)).json();
async function runRoom(job) {
  const TB = await loadBrain(job.sha);
  const room = { clients: [], testSlot: null, kills: 0, testSelf: null, done: false, cur: null };
  const hostSid = mkSid(); const r = await api('/mm/code/new?sid=' + hostSid);
  if (!r || r.error) return { error: 'room ' + JSON.stringify(r) };
  return await new Promise(async (resolve) => {
    const finish = (res) => { if (room.done) return; room.done = true; setTimeout(() => room.clients.forEach(c => { try { c.ws.close() } catch (e) {} }), 300); resolve(res) };
    setTimeout(() => finish({ error: 'timeout', partial: room.cur }), 330000);
    const open = (sid, idx, isHost) => new Promise((res) => {
      const ws = new WebSocket('wss://play.joinbuilders.org/r/' + r.room + '/play?token=&sid=' + sid + '&name=' + (isHost ? 'T' : 'h') + idx + '&code=' + r.code);
      const C = { idx, ws, isHost, bot: null, tier: isHost ? 'test' : TIERS[(idx - 1) % 15] };
      const send = (m) => { try { ws.send(JSON.stringify(m)) } catch (e) {} }; C.send = send;
      ws.onopen = () => { send({ type: 'ready', name: (isHost ? 'T' : 'h') + idx }); res(C) };
      ws.onerror = () => res(C);
      ws.onmessage = (ev) => {
        const s = ev.data; if (typeof s !== 'string') return;
        try {
          if (s.startsWith('{"type":"obs"')) {
            if (!C.bot) return;
            if (!isHost) {
              const o = JSON.parse(s);
              const active = o.t > (C.dur || 240) * LATE || (C.idx - 1) < 1 + room.kills;
              if (!active) { const z = o.zone, p = o.self.pos; const dx = z.next_center[0] - p[0], dy = z.next_center[1] - p[1], dd = Math.hypot(dx, dy) || 1; const go = dd > z.next_radius * 0.4; ws.send(JSON.stringify({ tick: o.tick, move: go ? [dx / dd, dy / dd] : [0, 0], boost: !o.self.in_zone && o.self.energy > 10 })); return }
              o.mechs = o.mechs.filter(m => m.kind !== 'mech' || m.id === room.testSlot);
              if (room.testSelf && !o.mechs.some(m => m.id === room.testSlot)) o.mechs.push(room.testSelf);
              ws.send(JSON.stringify(C.bot.act(o))); return;
            }
            const o = JSON.parse(s);
            room.testSelf = { id: C.slot, kind: 'mech', pos: o.self.pos, vel: o.self.vel, aim: o.self.aim, hp: o.self.hp, max_hp: o.self.max_hp, cubes: o.self.cubes, weapons: o.self.weapons.filter(Boolean).map(w => w.kind), charging: false };
            for (const e of o.events) { if (e.type === 'kill') { room.kills++; room.cur.kills++ } if (e.type === 'hit') room.cur.dealt += e.amount; if (e.type === 'damaged') room.cur.taken += e.amount }
            room.cur.t = o.t; room.cur.cubes = o.self.cubes; room.cur.w = o.self.weapons.map(w => w && w.kind).join('+');
            ws.send(JSON.stringify(C.bot.act(o)));
          } else if (s.startsWith('{"type":"hello"')) {
            const hello = JSON.parse(s); C.slot = hello.slot; C.dur = hello.config.match.duration_s;
            if (isHost) { room.testSlot = hello.slot; C.bot = TB.makeBot(hello, MAP, job.params); room.cur = { label: job.label, kills: 0, dealt: 0, taken: 0, t: 0 } }
            else C.bot = HB.makeBot(hello, MAP, { ...HUNTER, ...TIERP[C.tier] });
            setTimeout(() => send({ type: 'loaded' }), 300);
          } else if (s.startsWith('{"type":"end"')) {
            if (isHost && room.cur && room.cur.place == null) { const c = room.cur; c.place = JSON.parse(s).place; c.score = 16 - c.place; c.dealt = Math.round(c.dealt); c.taken = Math.round(c.taken); c.t = Math.round(c.t); finish(c) }
          }
        } catch (e) { self.postMessage({ type: 'log', msg: 'err ' + e }) }
      };
    });
    const host = await open(hostSid, 0, true); room.clients.push(host);
    for (let i = 1; i <= 15; i++) { const sid = mkSid(); const jr = await api('/mm/code/join?c=' + r.code + '&sid=' + sid); if (!jr || jr.error) { self.postMessage({ type: 'log', msg: 'join ' + JSON.stringify(jr) }); continue } room.clients.push(await open(sid, i, false)); await new Promise(z => setTimeout(z, 80)) }
    setTimeout(() => host.send({ type: 'start' }), 2000);
  });
}
self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    MAP = { world: data.world, terrain: data.terrain };
    HB = await loadBrain(data.hunterSha);
    if (data.tierp) TIERP = data.tierp; if (data.hunter) HUNTER = data.hunter; if (data.late) LATE = data.late;
    self.postMessage({ type: 'ready' });
  } else if (data.type === 'job') {
    let res; try { res = await runRoom(data.job) } catch (e) { res = { error: String(e) } }
    self.postMessage({ type: 'result', job: data.job, res });
  }
};
