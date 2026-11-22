// practice submitter: submits queued commits on the track page, one per free slot; skips anything already listed
(async () => {
  const RAW = 'https://raw.githubusercontent.com/TEMOtkesh/mech-royale-bot/main/tools/queue.json?ts=' + Date.now()
  if (window.AS3 && window.AS3.worker) { try { AS3.worker.terminate() } catch (e) {} }
  const AS3 = window.AS3 = { queue: [], attempts: {}, lastSubmit: 0, log: [], running: false, runSince: 0, stats: { loops: 0, subs: 0, errs: 0 }, _sp: {}, _sid: 0 }
  try { AS3.queue = (await (await fetch(RAW)).json()).map(([label, sha]) => ({ label, sha })) } catch (e) { AS3.err = 'queue ' + e }
  AS3.sw = new Worker(URL.createObjectURL(new Blob(['onmessage=e=>setTimeout(()=>postMessage(e.data.id),e.data.ms)'], { type: 'text/javascript' })))
  AS3.sw.onmessage = (e) => { const r = AS3._sp[e.data]; delete AS3._sp[e.data]; if (r) r() }
  AS3.sleep = (ms) => new Promise((r) => { const id = ++AS3._sid; AS3._sp[id] = r; AS3.sw.postMessage({ id, ms }) })
  AS3.frame = document.createElement('iframe')
  AS3.frame.style.cssText = 'width:900px;height:600px;position:fixed;bottom:0;right:0;opacity:0.01;pointer-events:none'
  document.body.appendChild(AS3.frame)
  AS3.load = () => new Promise((res) => {
    let done = false; const fin = () => { if (!done) { done = true; res() } }
    AS3.sleep(25000).then(fin)
    AS3.frame.onload = async () => {
      for (let i = 0; i < 60; i++) { try { const t = AS3.frame.contentDocument.body.innerText; if (/\d+\s+of\s+\d+\s+left this hour/i.test(t) && /Your team's submissions/.test(t)) break } catch (e) {} await AS3.sleep(250) }
      fin()
    }
    AS3.frame.src = '/buildathon/tracks/builders?ts=' + Date.now()
  })
  AS3.parse = () => {
    const t = AS3.frame.contentDocument.body.innerText
    const m = t.match(/(\d+)\s+of\s+(\d+)\s+left this hour/i)
    const i = t.indexOf("Your team's submissions"); const s = t.slice(i, i + 14000)
    const blocks = s.split(/\n(?=BB-[0-9A-F]{8}\n)/).slice(1)
    return { left: m ? +m[1] : -1, blocks: blocks.map((b) => ({ sha: (b.match(/@ ([0-9a-f]{12})/) || [])[1], status: b.split('\n')[1], score: (b.match(/\n([\d.]+)\n/) || [])[1] })) }
  }
  AS3.parseWait = async () => { let p = AS3.parse(); for (let k = 0; k < 20 && (p.left < 0 || !p.blocks.length); k++) { await AS3.sleep(500); p = AS3.parse() } return p }
  AS3.submit = async (sha) => {
    for (let k = 0; k < 30; k++) { const d = AS3.frame.contentDocument; const inp = [...d.querySelectorAll('input')].find((x) => /40-character/i.test(x.placeholder || '')); if (inp && Object.keys(inp).some((x) => x.startsWith('__react'))) break; await AS3.sleep(500) }
    await AS3.sleep(1200)
    const doc = AS3.frame.contentDocument, w = AS3.frame.contentWindow
    const before = (doc.body.innerText.match(/receipt is (BB-[0-9A-F]+)/) || [])[1]
    const inputs = [...doc.querySelectorAll('input')]
    const repo = inputs.find((x) => /github/i.test(x.placeholder || '')), commit = inputs.find((x) => /40-character/i.test(x.placeholder || ''))
    if (!repo || !commit) throw new Error('form inputs not found')
    const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set
    setter.call(repo, 'https://github.com/TEMOtkesh/mech-royale-bot'); repo.dispatchEvent(new w.Event('input', { bubbles: true }))
    setter.call(commit, sha); commit.dispatchEvent(new w.Event('input', { bubbles: true }))
    await AS3.sleep(600); repo.closest('form').requestSubmit()
    let after = null
    for (let k = 0; k < 16; k++) { await AS3.sleep(500); after = (AS3.frame.contentDocument.body.innerText.match(/receipt is (BB-[0-9A-F]+)/) || [])[1]; if (after && after !== before) break }
    if (!after || after === before) { delete AS3.attempts[sha]; AS3.lastSubmit = 0; AS3.log.push('no receipt for ' + sha.slice(0, 7) + ' ' + new Date().toTimeString().slice(0, 8)) } else AS3.log.push('receipt ' + after)
  }
  AS3.loop = async () => {
    if (AS3.running && Date.now() - AS3.runSince < 120000) return
    AS3.running = true; AS3.runSince = Date.now(); AS3.stats.loops++
    try {
      await AS3.load(); const p = await AS3.parseWait()
      const shas = p.blocks.map((b) => b.sha)
      const fetching = p.blocks[0] && /Fetching|Building|Checking/.test(p.blocks[0].status || '')
      while (AS3.queue.length && shas.includes(AS3.queue[0].sha.slice(0, 12))) { const it = AS3.queue.shift(); AS3.log.push('on page ' + it.label + ' ' + new Date().toTimeString().slice(0, 8)); AS3.stats.subs++ }
      AS3.state = { left: p.left, fetching, n: AS3.queue.length, at: new Date().toTimeString().slice(0, 8) }
      const it = AS3.queue[0]
      if (it && p.left > 0 && !fetching && Date.now() - AS3.lastSubmit > 45000 && Date.now() - (AS3.attempts[it.sha] || 0) > 300000) {
        AS3.attempts[it.sha] = Date.now(); AS3.lastSubmit = Date.now()
        await AS3.submit(it.sha); AS3.log.push('try ' + it.label + ' ' + new Date().toTimeString().slice(0, 8))
      }
    } catch (e) { AS3.stats.errs++; AS3.err = String(e) } finally { AS3.running = false }
  }
  AS3.worker = new Worker(URL.createObjectURL(new Blob(['setInterval(()=>postMessage(1),15000)'], { type: 'text/javascript' })))
  AS3.worker.onmessage = () => AS3.loop()
  AS3.loop()
})()
