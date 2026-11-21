// Entry point for the scorer: bun /bot/main.ts
import { readFileSync } from "fs"
import { join } from "path"
import { run } from "./mechfight.ts"
import { makeBot } from "./brain.js"

let params: Record<string, unknown> = {}
try { params = JSON.parse(readFileSync(join(import.meta.dir, "params.json"), "utf8")) } catch {}

run((hello: any) => {
  const dir = hello.map?.dir ?? "/arena"
  const world = JSON.parse(readFileSync(join(dir, "v2", "world.json"), "utf8"))
  const tb = readFileSync(join(dir, "v2", "terrain.i16"))
  const terrain = tb.buffer.slice(tb.byteOffset, tb.byteOffset + tb.byteLength)
  const bot = makeBot(hello, { world, terrain }, params)
  // warm up the JIT so the first real decisions are fast
  try {
    const w: any = bot.world
    for (let i = 0; i < 40; i++) {
      const a = [-300 + i * 15, -200 + i * 9], b = [250 - i * 11, 250 - i * 13]
      w.path(a, b); w.los([a[0], a[1], 5], [b[0], b[1], 5])
    }
  } catch {}
  return { name: String(params.name ?? "kesh-mech"), act: (obs: any) => bot.act(obs) }
})
