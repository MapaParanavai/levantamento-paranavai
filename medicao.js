// ---------- Medição de prestadores ----------
// Escopo de contrato (itens padrão, sem prestador) vem de contratos.json.
// No app, cada escopo recebe prestadores: nome, nº do contrato, quadras e nº de casas.
// Quadra de dois prestadores do mesmo escopo = dividida: ao marcar um lote nela, o app pergunta quem executou.
// Medição por prestador: medição atual = mín(contratado, executado acumulado do prestador + previsão) − medido acumulado; nunca negativa.
// Prestadores e "quem executou" ficam em S (vão junto na transferência); histórico das medições numa chave própria.
"use strict";
(function () {
  const MKEY = "levprod-paranavai-f1-medicoes";
  let MED = { versao: 2, medicoes: {} };
  let ESC = null;
  const ld = () => { try { const r = localStorage.getItem(MKEY); if (r) { const m = JSON.parse(r); if (m && m.medicoes) MED = m; } } catch (e) {} };
  const sv = () => { MED.atualizadoEm = new Date().toISOString(); try { localStorage.setItem(MKEY, JSON.stringify(MED)); } catch (e) { toast("Não consegui salvar as medições. Salve o backup.", false, true); } };
  ld();

  async function escopos() {
    if (!ESC) {
      try {
        const j = await (await fetch("contratos.json")).json();
        ESC = Array.isArray(j) ? j.map(c => ({ id: c.id === "kvc-hidro" ? "hidro" : c.id, descricao: c.descricao, itens: c.itens })) : (j.escopos || []);
      } catch (e) { ESC = []; }
      migra();
    }
    return ESC;
  }
  // prestadores por escopo (em S, para ir junto com o celular)
  const P = () => (S.prest = S.prest || {});
  const Q = () => (S.quem = S.quem || {});
  function migra() { // primeira vez: a KVC vira prestador do escopo hidrossanitário, com todas as quadras
    if (S.prest) return;
    const qs = quadras().map(x => x.q);
    S.prest = { hidro: [{ id: "kvc", nome: "KVC DA SILVA CONSTRUÇÕES", contrato: "", quadras: qs, casas: LOTS.length, ativo: true }] };
    if (MED.medicoes["kvc-hidro"] && !MED.medicoes["hidro:kvc"]) { MED.medicoes["hidro:kvc"] = MED.medicoes["kvc-hidro"]; delete MED.medicoes["kvc-hidro"]; sv(); }
    save();
  }
  const quadras = () => { const m = {}; LOTS.forEach(l => (m[l.q] = (m[l.q] || 0) + 1)); return Object.keys(m).sort().map(q => ({ q, n: m[q] })); };
  const prestDe = eid => (P()[eid] || []);
  const ativosDe = eid => prestDe(eid).filter(p => p.ativo !== false);
  const donosDaQuadra = (eid, q) => ativosDe(eid).filter(p => (p.quadras || []).includes(q));
  const ckey = (eid, pid) => eid + ":" + pid;
  const meds = id => (MED.medicoes[id] = MED.medicoes[id] || []);
  const svcNum = n => S.servicos.find(s => s.num === n);
  const N = v => { const x = Math.round(+v); return isFinite(x) ? x : 0; };
  const ord = k => k + "ª";
  const casasSugeridas = (eid, qs, pid) => quadras().filter(x => qs.includes(x.q)).reduce((t, x) => {
    const outros = ativosDe(eid).filter(p => p.id !== pid && (p.quadras || []).includes(x.q)).length;
    return t + Math.round(x.n / (outros + 1));
  }, 0);

  // lotes executados pelo prestador na atividade, até a data
  function execAte(eid, pr, num, data) {
    const s = svcNum(num); if (!s) return { n: 0, sem: 0 };
    const quem = ((Q()[eid] || {})[num]) || {};
    let n = 0, sem = 0;
    for (const [lot, d] of Object.entries(marksOf(s.id))) {
      if (d > data) continue;
      const l = LOTIDX[lot]; if (!l || !(pr.quadras || []).includes(l.q)) continue;
      if (donosDaQuadra(eid, l.q).length > 1) { if (quem[lot] === pr.id) n++; else if (!quem[lot]) sem++; }
      else n++;
    }
    return { n, sem };
  }

  function calcular(es, pr, data, prev, prevItem, manual) {
    const hist = meds(ckey(es.id, pr.id)), cont = N(pr.casas);
    const atvs = [...new Set(es.itens.map(i => i.atv).filter(Boolean))].sort((a, b) => a - b);
    const A = {};
    for (const a of atvs) {
      const s = svcNum(a), e = execAte(es.id, pr, a, data);
      const p = Math.max(0, Math.min(cont - e.n, N(prev[a] || 0)));
      A[a] = { num: a, nome: s ? s.nome : "Atividade " + a + " (não existe no app)", existe: !!s, exec: e.n, sem: e.sem, prev: p };
    }
    const itens = es.itens.map(i => {
      const a = i.atv ? A[i.atv] : null, f = i.fator || 1, semCota = i.un !== "cs", qtd = semCota ? null : cont * f;
      const ja = hist.reduce((t, m) => t + ((m.itens[i.n] || {}).q || 0), 0);
      if (i.manual || !a) { // lançamento manual: digita a quantidade do mês
        const v = Math.max(0, +(manual[i.n] || 0) || 0), q = qtd == null ? v : Math.min(v, Math.max(0, qtd - ja));
        return { ...i, qtd, ja, exec: null, prev: null, q, saldo: qtd == null ? null : qtd - ja - q, devendo: 0, manual: true };
      }
      const exec = a.exec * f, pv = prevItem[i.n] != null ? Math.max(0, N(prevItem[i.n])) : a.prev * f;
      const q = Math.max(0, Math.min(qtd, exec + pv) - ja);
      const devendo = Math.max(0, ja - (exec + pv));
      return { ...i, qtd, ja, exec, prev: pv, prevOver: prevItem[i.n] != null, q, saldo: qtd - ja - q, devendo };
    });
    return { A, atvs, itens, semDono: atvs.reduce((t, a) => t + A[a].sem, 0) };
  }

  // ---------- "quem executou?" no lançamento ----------
  function aposMarcar(svc, lotId) {
    if (!ESC) return;
    const l = LOTIDX[lotId]; if (!l) return;
    const pend = ESC.filter(es => es.itens.some(i => i.atv === svc.num)).map(es => ({ es, ps: donosDaQuadra(es.id, l.q) })).filter(x => x.ps.length > 1);
    if (!pend.length) return;
    const x = pend[0], d = dia(), mem = (S.lembra = S.lembra || {}), mk = `${x.es.id}|${svc.num}|${l.q}`;
    const grava = pid => { const q = Q(); q[x.es.id] = q[x.es.id] || {}; q[x.es.id][svc.num] = q[x.es.id][svc.num] || {}; q[x.es.id][svc.num][lotId] = pid; };
    const lem = mem[mk];
    if (lem && lem.data === d && x.ps.some(p => p.id === lem.pid)) { // mesma frente, mesmo dia: repete a resposta
      grava(lem.pid); save(); toast(`${l.q} lote ${l.n}: executado por ${x.ps.find(p => p.id === lem.pid).nome} (mesma frente). Para trocar, desmarque e marque de novo.`);
      if (pend.length > 1) aposMarcar(svc, lotId); return;
    }
    openSheet("Quem executou?", `<p class="msg"><b>${esc(svc.nome)}</b> · ${esc(l.q)} lote ${l.n}<br>Esta quadra é dividida entre prestadores de ${esc(x.es.descricao)}.</p>
      ${x.ps.map(p => `<button class="item" data-p="${esc(p.id)}"><span><b>${esc(p.nome)}</b></span></button>`).join("")}
      <label class="f" style="grid-template-columns:auto 1fr;align-items:center;font-size:14px;color:var(--ink)"><input type="checkbox" id="qLem" checked> Usar para os próximos lotes desta quadra hoje</label>
      <p class="msg">Se fechar sem escolher, o lote fica sem executor e não entra na medição até ser definido.</p>`);
    $("sheetB").querySelectorAll("[data-p]").forEach(b => b.onclick = () => {
      grava(b.dataset.p); if ($("qLem").checked) mem[mk] = { pid: b.dataset.p, data: d }; else delete mem[mk];
      save(); closeSheet(); toast(`Executado por ${x.ps.find(p => p.id === b.dataset.p).nome}`);
      if (pend.length > 1) aposMarcar(svc, lotId);
    });
  }
  function aoDesmarcar(svc, lotId) { const q = Q(), l = LOTIDX[lotId]; for (const e in q) if (q[e][svc.num]) delete q[e][svc.num][lotId]; if (l && S.lembra) for (const k in S.lembra) if (k.endsWith(`|${svc.num}|${l.q}`)) delete S.lembra[k]; }

  // ---------- telas ----------
  async function abrirMedicao() {
    const es = await escopos();
    openSheet("Medição de prestadores", (es.length ? es.map(e => `<div class="grp">${esc(e.descricao)} · ${e.itens.length} itens</div>
      ${prestDe(e.id).map(p => { const h = meds(ckey(e.id, p.id)), u = h[h.length - 1];
        return `<div class="ed${p.ativo === false ? " off" : ""}"><span></span><div><b>${esc(p.nome)}</b><small>${p.contrato ? esc(p.contrato) + " · " : ""}${N(p.casas)} casas · ${(p.quadras || []).length} quadras${h.length ? ` · ${h.length} medições, última ${fmt(u.data)}` : ""}${p.ativo === false ? " · desativado" : ""}</small></div>
          <div class="acts"><button data-ed="${esc(e.id)}|${esc(p.id)}">Editar</button><button data-med="${esc(e.id)}|${esc(p.id)}"><b>Medir</b></button></div></div>`; }).join("") || `<p class="msg">Nenhum prestador vinculado.</p>`}
      <div class="row"><button class="btn" data-novo="${esc(e.id)}">+ Vincular prestador</button></div>`).join("") : `<p class="msg err">Nenhum escopo encontrado. Abra o app com internet uma vez.</p>`) +
      `<p class="msg">A medição usa a produção lançada neste aparelho. No computador, receba antes o arquivo do celular (Ações → Transferir e backup). Cadastre os prestadores no celular do levantamento, ou transfira depois para ele: é lá que o app pergunta quem executou nas quadras divididas.</p>`);
    const B = $("sheetB");
    B.querySelectorAll("[data-med]").forEach(b => b.onclick = () => { const [e, p] = b.dataset.med.split("|"); abrirContrato(e, p); });
    B.querySelectorAll("[data-ed]").forEach(b => b.onclick = () => { const [e, p] = b.dataset.ed.split("|"); editarPrest(e, p); });
    B.querySelectorAll("[data-novo]").forEach(b => b.onclick = () => editarPrest(b.dataset.novo, null));
  }

  function editarPrest(eid, pid) {
    const es = ESC.find(e => e.id === eid); const lista = (P()[eid] = P()[eid] || []);
    const p = pid ? lista.find(x => x.id === pid) : { id: "p" + Date.now().toString(36), nome: "", contrato: "", quadras: [], casas: 0, ativo: true };
    let sel = new Set(pid ? (p.quadras || []) : quadras().map(x => x.q)), casasEdit = !!pid;
    const nomes = [...new Set([...(S.efCad?.empresas || []), ...Object.values(P()).flat().map(x => x.nome)])];
    const qs = quadras();
    openSheet(pid ? "Editar prestador" : "Vincular prestador", `<p class="msg">${esc(es.descricao)}</p>
      <label class="f">Prestador (razão social)<input id="pNome" list="pNomes" value="${esc(p.nome)}"><datalist id="pNomes">${nomes.map(n => `<option value="${esc(n)}">`).join("")}</datalist></label>
      <label class="f">Nº do contrato (opcional)<input id="pCt" value="${esc(p.contrato)}"></label>
      <div class="grp">Quadras deste prestador</div>
      <div class="row"><button class="btn" id="pTodas" style="flex:0 0 auto">Todas</button><button class="btn" id="pNenhuma" style="flex:0 0 auto">Nenhuma</button></div>
      <div id="pQs" style="display:flex;flex-wrap:wrap;gap:6px"></div>
      <label class="f">Nº de casas contratadas<input id="pCasas" type="number" min="0" inputmode="numeric" value="${N(p.casas)}"></label>
      <p class="msg" id="pDica"></p>
      <label class="f" style="grid-template-columns:auto 1fr;align-items:center;font-size:14px;color:var(--ink)"><input type="checkbox" id="pAt" ${p.ativo !== false ? "checked" : ""}> Ativo (desativar mantém o histórico)</label>
      <p class="msg err" id="pErr" hidden></p>
      <div class="row"><button class="btn" id="pCan">Cancelar</button><button class="btn pri" id="pOk">Salvar</button></div>`);
    const desenha = () => {
      $("pQs").innerHTML = qs.map(x => { const outros = ativosDe(eid).filter(o => o.id !== p.id && (o.quadras || []).includes(x.q)).map(o => o.nome);
        const on = sel.has(x.q);
        return `<button data-q="${x.q}" title="${outros.length ? "Também com: " + esc(outros.join(", ")) : ""}" style="border:1px solid ${on ? "var(--navy)" : "var(--line)"};background:${on ? "var(--navy)" : "var(--surface)"};color:${on ? "var(--surface)" : "var(--ink)"};border-radius:8px;padding:6px 8px;min-width:58px;cursor:pointer;font:600 14px var(--f-display)">${x.q}${outros.length ? " ⇄" : ""}<br><small style="font-weight:400">${x.n} cs</small></button>`; }).join("");
      $("pQs").querySelectorAll("[data-q]").forEach(b => b.onclick = () => { sel.has(b.dataset.q) ? sel.delete(b.dataset.q) : sel.add(b.dataset.q); desenha(); });
      const sug = casasSugeridas(eid, [...sel], p.id), div = [...sel].filter(q => ativosDe(eid).some(o => o.id !== p.id && (o.quadras || []).includes(q))).length;
      if (!casasEdit) $("pCasas").value = sug;
      $("pDica").textContent = `${sel.size} quadras · sugestão: ${sug} casas` + (div ? ` · ${div} quadra(s) dividida(s) ⇄: nelas o app vai perguntar quem executou` : "");
    };
    $("pCasas").oninput = () => { casasEdit = true; };
    $("pTodas").onclick = () => { sel = new Set(qs.map(x => x.q)); desenha(); };
    $("pNenhuma").onclick = () => { sel = new Set(); desenha(); };
    $("pCan").onclick = abrirMedicao;
    $("pOk").onclick = () => {
      const nome = $("pNome").value.trim(), err = t => { $("pErr").textContent = t; $("pErr").hidden = false; };
      if (!nome) return err("Informe o prestador.");
      if (!sel.size) return err("Escolha ao menos uma quadra.");
      if (lista.some(x => x.id !== p.id && x.nome.toLowerCase() === nome.toLowerCase())) return err("Esse prestador já está vinculado a este escopo.");
      Object.assign(p, { nome, contrato: $("pCt").value.trim(), quadras: [...sel].sort(), casas: N($("pCasas").value), ativo: $("pAt").checked });
      if (!pid) lista.push(p);
      save(); toast("Prestador salvo"); abrirMedicao();
    };
    desenha();
  }

  async function abrirContrato(eid, pid) {
    const es = (await escopos()).find(e => e.id === eid), pr = prestDe(eid).find(p => p.id === pid); if (!es || !pr) return;
    const id = ckey(eid, pid), h = meds(id);
    const atualizado = S.updatedAt ? new Date(S.updatedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";
    openSheet(pr.nome, `
      <p class="msg">${esc(es.descricao)} · ${es.itens.length} itens · contrato ${esc(pr.contrato || "a definir")} · ${N(pr.casas)} casas<br>Produção deste aparelho atualizada em <b>${atualizado}</b>.</p>
      <div class="row"><button class="btn pri" id="mNova">Nova medição (${ord(h.length + 1)})</button></div>
      ${h.length ? `<div class="grp">Medições fechadas</div><div class="scroll"><table class="res" style="min-width:0"><tr><th>Nº</th><th>Data</th><th>Itens medidos</th></tr>
        ${h.map(m => `<tr><td>${ord(m.num)}</td><td>${fmt(m.data)}</td><td>${Object.values(m.itens).filter(x => x.q).length}</td></tr>`).join("")}</table></div>
      <div class="row"><button class="btn" id="mBol">Baixar boletim da ${ord(h.length)}</button><button class="btn" id="mDesf">Desfazer a ${ord(h.length)}</button></div>` : `<p class="msg">Nenhuma medição fechada ainda.</p>`}
      <div class="grp">Backup das medições</div>
      <div class="row"><button class="btn" id="mBk">Baixar backup</button><button class="btn" id="mVolta">Voltar</button></div>
      <label class="f">Restaurar backup (medicoes_….txt)<input type="file" id="mRest" accept=".txt,.json,text/plain,application/json"></label>
      <p class="msg" id="mMsg"></p>`);
    $("mNova").onclick = () => novaMedicao(es, pr);
    $("mVolta").onclick = abrirMedicao;
    if (h.length) {
      $("mBol").onclick = async () => salvar(await boletim(es, pr, h.length));
      $("mDesf").onclick = () => { const b = $("mDesf"); if (!b.dataset.ok) { b.dataset.ok = 1; b.textContent = "Toque de novo para desfazer"; return; } h.pop(); sv(); toast("Medição desfeita"); abrirContrato(eid, pid); };
    }
    $("mBk").onclick = () => salvar(arquivoBackup());
    $("mRest").onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      let m; try { m = JSON.parse(await f.text()); if (!m.medicoes) throw 0; } catch (_) { $("mMsg").textContent = "Arquivo inválido."; $("mMsg").classList.add("err"); return; }
      if (m.medicoes["kvc-hidro"] && !m.medicoes["hidro:kvc"]) { m.medicoes["hidro:kvc"] = m.medicoes["kvc-hidro"]; delete m.medicoes["kvc-hidro"]; }
      MED = m; sv(); toast("Backup das medições restaurado"); abrirContrato(eid, pid);
    };
  }

  function novaMedicao(es, pr) {
    const h = meds(ckey(es.id, pr.id)), ult = h[h.length - 1];
    let data = hoje();
    const prev = {}, prevItem = {}, manual = {};
    openSheet(`${ord(h.length + 1)} medição · ${pr.nome}`, `<style>.mw>*+*{margin-top:10px}.mw input.pv{width:64px;font:inherit;padding:2px 4px}</style><div class="mw">
      <label class="f" style="max-width:260px">Data da medição (executado acumulado até esta data)<input type="date" id="nData" value="${data}"></label>
      <p class="msg" id="nAviso"></p>
      <div class="kpis" style="grid-template-columns:repeat(2,minmax(0,1fr))"><div class="kpi"><b id="kIt">0</b><span>itens com medição</span></div><div class="kpi"><b id="kAd">0</b><span>itens devendo</span></div></div>
      <p class="msg"><b>Medição atual</b> = executado acumulado − medido acumulado + previsão. Se der negativo, fica 0. Nunca passa do contratado (${N(pr.casas)} casas). A <b>previsão</b> é opcional: casas que você prevê executar até o fechamento (dia 25). A da linha da atividade vale para todos os itens; a de cada item ajusta só aquele item, para mais ou para menos. Itens <b>manuais</b>: digite a quantidade do mês em Medição atual.</p>
      <div class="scroll"><table class="res" id="nTab"></table></div>
      <div class="row"><button class="btn" id="nCan">Voltar</button><button class="btn pri" id="nOk">Fechar ${ord(h.length + 1)} medição</button></div></div>`);
    let R = null;
    const desenhar = () => {
      data = $("nData").value || hoje();
      R = calcular(es, pr, data, prev, prevItem, manual);
      const av = [];
      if (ult && data <= ult.data) av.push(`A data precisa ser depois da ${ord(ult.num)} medição (${fmt(ult.data)}).`);
      R.atvs.filter(a => !R.A[a].existe).forEach(a => av.push(`A atividade ${a} não existe na lista do app.`));
      const bloq = av.length > 0;
      if (R.semDono) av.push(`${R.semDono} lançamento(s) em quadras divididas estão sem executor definido e não entram nesta medição.`);
      $("nAviso").textContent = av.join(" "); $("nAviso").className = av.length ? "msg err" : "msg";
      $("nOk").disabled = bloq;
      let html = `<tr><th>Item</th><th>Contratado</th><th>Executado acumulado</th><th>Medido acumulado</th><th>Previsão</th><th>Medição atual</th><th>Saldo</th></tr>`;
      const grupos = [...R.atvs.map(a => ({ a, its: R.itens.filter(i => i.atv === a) })), { a: null, its: R.itens.filter(i => !i.atv) }].filter(g => g.its.length);
      for (const g of grupos) {
        const A = g.a ? R.A[g.a] : null;
        html += `<tr><td colspan="4" style="text-align:left;background:color-mix(in srgb,var(--navy) 10%,transparent)"><b>${A ? A.num + " · " + esc(A.nome) : "Sem atividade vinculada"}</b></td>
          <td style="background:color-mix(in srgb,var(--navy) 10%,transparent)">${A ? `<input class="pv" type="number" min="0" data-prev="${A.num}" value="${A.prev || ""}" placeholder="0" aria-label="Previsão ${esc(A.nome)}">` : ""}</td>
          <td colspan="2" style="background:color-mix(in srgb,var(--navy) 10%,transparent)"></td></tr>`;
        for (const i of g.its) {
          const un = i.un !== "cs" ? ` ${esc(i.un)}` : "";
          html += i.manual
            ? `<tr${i.q ? ` class="hoje"` : ""}><td style="text-align:left">${i.n} · ${esc(i.desc)}<br><small>Lançamento manual${un ? " (" + esc(i.un) + ")" : ""}</small></td>
              <td>${i.qtd == null ? "—" : i.qtd}</td><td>—</td><td>${i.ja}${un}</td><td>—</td><td><input class="pv" type="number" min="0" step="any" data-man="${i.n}" value="${manual[i.n] ?? ""}" placeholder="0" aria-label="Medição atual ${esc(i.desc)}"></td><td>${i.saldo == null ? "—" : i.saldo}</td></tr>`
            : `<tr${i.devendo ? ` class="parado"` : i.q ? ` class="hoje"` : ""}><td style="text-align:left">${i.n} · ${esc(i.desc)}${i.devendo ? `<br><small><b>Devendo ${i.devendo} casas</b>: não mede até o executado alcançar o medido</small>` : ""}</td>
              <td>${i.qtd}</td><td>${i.exec}</td><td>${i.ja}</td><td><input class="pv" type="number" min="0" data-pi="${i.n}" value="${i.prev}" aria-label="Previsão do item ${i.n}" style="${i.prevOver ? "border-color:var(--warn);font-weight:700" : ""}"></td><td><b>${i.q}</b></td><td>${i.saldo}</td></tr>`;
        }
      }
      $("nTab").innerHTML = html;
      $("kIt").textContent = R.itens.filter(i => i.q).length; $("kAd").textContent = R.itens.filter(i => i.devendo).length;
      $("nTab").querySelectorAll("[data-prev]").forEach(x => x.onchange = () => { const a = +x.dataset.prev; prev[a] = x.value === "" ? 0 : +x.value; es.itens.filter(i => i.atv === a).forEach(i => delete prevItem[i.n]); desenhar(); });
      $("nTab").querySelectorAll("[data-pi]").forEach(x => x.onchange = () => { if (x.value === "") delete prevItem[x.dataset.pi]; else prevItem[x.dataset.pi] = +x.value; desenhar(); });
      $("nTab").querySelectorAll("[data-man]").forEach(x => x.onchange = () => { manual[x.dataset.man] = x.value; desenhar(); });
    };
    $("nData").onchange = desenhar;
    $("nCan").onclick = () => abrirContrato(es.id, pr.id);
    $("nOk").onclick = () => {
      const b = $("nOk");
      if (!b.dataset.ok) { b.dataset.ok = 1; b.textContent = `Confirmar: fechar a ${ord(h.length + 1)} medição de ${fmt(data)}`; return; }
      const itens = {};
      R.itens.forEach(i => { itens[i.n] = { q: i.q, exec: i.exec, prev: i.prev, manual: !!i.manual }; });
      h.push({ num: h.length + 1, data, fechadaEm: new Date().toISOString(), listaVer: S.listaVer || 1, casas: N(pr.casas), itens });
      sv();
      fechada(es, pr, h.length);
    };
    desenhar();
  }

  // depois de fechar: um botão para cada arquivo (o navegador bloqueia downloads automáticos em sequência)
  async function fechada(es, pr, num) {
    const bol = await boletim(es, pr, num), bk = arquivoBackup();
    openSheet(`${ord(num)} medição fechada`, `<p class="msg"><b>${esc(pr.nome)}</b> · ${esc(es.descricao)}<br>Baixe os dois arquivos e guarde na pasta da obra.</p>
      <div class="row"><button class="btn pri" id="fBol">1. Baixar boletim (Excel)</button></div>
      <div class="row"><button class="btn pri" id="fBk">2. Baixar backup das medições</button></div>
      <div class="row"><button class="btn" id="fVolta">Concluir</button></div>`);
    $("fBol").onclick = async () => { await salvar(bol); $("fBol").textContent = "Boletim baixado ✓"; $("fBol").classList.remove("pri"); };
    $("fBk").onclick = async () => { await salvar(bk); $("fBk").textContent = "Backup baixado ✓"; $("fBk").classList.remove("pri"); };
    $("fVolta").onclick = () => abrirContrato(es.id, pr.id);
  }

  const arquivoBackup = () => new File([JSON.stringify({ ...MED, prest: S.prest, quem: S.quem, _geradoEm: new Date().toISOString() })], `medicoes_${hoje()}.txt`, { type: "text/plain" });
  const fornecedores = async () => { await escopos(); return [...new Set(Object.values(P()).flat().filter(p => p.ativo !== false).map(p => p.nome))]; };

  // ---------- boletim em Excel (só quantidades) ----------
  async function boletim(es, pr, ate) {
    const h = meds(ckey(es.id, pr.id)).slice(0, ate), cur = h[h.length - 1];
    const casas = cur.casas || N(pr.casas);
    let logo = null;
    try { const buf = await (await fetch("logo.png")).arrayBuffer(); const im = await createImageBitmap(new Blob([buf])); logo = { buf, w: im.width, h: im.height }; } catch (e) {}
    const X = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const col = i => { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - 1 - m) / 26 | 0; } return s; };
    const rows = []; const merges = [];
    const nCol = 4 + h.length + 2;
    const add = cells => rows.push(cells);
    add([]);
    add([{ v: "PLANILHA DE SERVIÇOS CONTRATADOS · BOLETIM DE MEDIÇÃO (QUANTIDADES)", s: 1 }]); merges.push(`A2:${col(nCol - 1)}2`);
    add([{ v: "OBRA:", s: 7 }, { v: "Paranavaí · Fase 1", s: 8 }]);
    add([{ v: "CONTRATADA:", s: 7 }, { v: pr.nome + (pr.contrato ? " - " + pr.contrato : " - contrato a definir"), s: 8 }]);
    add([{ v: "ESCOPO:", s: 7 }, { v: es.descricao, s: 8 }]);
    add([{ v: "MEDIÇÃO:", s: 7 }, { v: `${ord(cur.num)} · data ${fmt(cur.data)}`, s: 8 }]);
    add([]);
    const hdr = [{ v: "Código CT", s: 2 }, { v: "Serviços", s: 2 }, { v: "Unid.", s: 2 }, { v: "Quant.", s: 2 }];
    h.forEach(m => hdr.push({ v: `${ord(m.num)} Medição\n${fmt(m.data)}`, s: m === cur ? 9 : 2 }));
    hdr.push({ v: "Total medido", s: 2 }, { v: "Saldo a medir", s: 2 });
    add(hdr);
    let grp = null;
    for (const i0 of es.itens) {
      const i = { ...i0, qtd: i0.un !== "cs" ? "" : casas * (i0.fator || 1) };
      if (i.grupo !== grp) { grp = i.grupo; const r = [{ v: "", s: 5 }, { v: grp, s: 5 }]; for (let k = 2; k < nCol; k++) r.push({ v: "", s: 5 }); add(r); }
      const qs = h.map(m => (m.itens[i.n] || {}).q || 0), tot = qs.reduce((a, b) => a + b, 0);
      const r = [{ v: i.cod, s: 4 }, { v: i.desc, s: 3 }, { v: i.un, s: 4 }, { v: i.qtd, s: 4 }];
      qs.forEach((q, k) => r.push({ v: q || 0, s: k === qs.length - 1 ? 6 : 4 }));
      r.push({ v: tot, s: 4 }, { v: i.qtd === "" ? "" : i.qtd - tot, s: 4 });
      add(r);
    }
    add([]);
    add([{ v: "", s: 0 }, { v: "Quantidades em casas. Valores, retenções e impostos são lançados no Sienge.", s: 10 }]);
    add([{ v: "", s: 0 }, { v: `Gerado pelo app de levantamento em ${new Date().toLocaleString("pt-BR")}.`, s: 10 }]);
    const sheet = rows.map((r, ri) => `<row r="${ri + 1}"${ri === 7 ? ' ht="30" customHeight="1"' : ri === 0 ? ' ht="36" customHeight="1"' : ""}>` + r.map((c, ci) => {
      const ref = col(ci) + (ri + 1), st = c.s ? ` s="${c.s}"` : "";
      return typeof c.v === "number" ? `<c r="${ref}"${st}><v>${c.v}</v></c>` : `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${X(c.v)}</t></is></c>`;
    }).join("") + `</row>`).join("");
    const widths = [14, 62, 7, 8, ...h.map(() => 12), 12, 12];
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="8" xSplit="2" topLeftCell="C9" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols><sheetData>${sheet}</sheetData><mergeCells count="${merges.length}">${merges.map(m => `<mergeCell ref="${m}"/>`).join("")}</mergeCells><pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup orientation="landscape" fitToHeight="0"/>${logo ? '<drawing r:id="rIdLogo"/>' : ""}</worksheet>`;
    const b = `<border><left style="thin"><color rgb="FFBFC7D5"/></left><right style="thin"><color rgb="FFBFC7D5"/></right><top style="thin"><color rgb="FFBFC7D5"/></top><bottom style="thin"><color rgb="FFBFC7D5"/></bottom><diagonal/></border>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="6"><font><sz val="9"/><name val="Arial"/></font><font><b/><sz val="13"/><color rgb="FF013244"/><name val="Arial"/></font><font><b/><sz val="9"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><b/><sz val="9"/><name val="Arial"/></font><font><i/><sz val="8"/><color rgb="FF595959"/><name val="Arial"/></font><font><b/><sz val="9"/><color rgb="FF44546A"/><name val="Arial"/></font></fonts>
<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF013244"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7ECF5"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFC6EFCE"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>${b}</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="11">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="1" fontId="3" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
    const z = new JSZip();
    if (logo) {
      const W = Math.round(34 * logo.w / logo.h) * 9525, Hh = 34 * 9525;
      z.file("xl/media/logo.png", logo.buf);
      z.file("xl/worksheets/_rels/sheet1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`);
      z.file("xl/drawings/_rels/drawing1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo.png"/></Relationships>`);
      z.file("xl/drawings/drawing1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>38100</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>38100</xdr:rowOff></xdr:from><xdr:ext cx="${W}" cy="${Hh}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Logo Pacaembu"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${W}" cy="${Hh}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`);
    }
    z.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${logo ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : ""}</Types>`);
    z.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
    z.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="BOLETIM ${ord(cur.num)}" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">'BOLETIM ${ord(cur.num)}'!$8:$8</definedName></definedNames></workbook>`);
    z.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
    z.file("xl/worksheets/sheet1.xml", xml);
    z.file("xl/styles.xml", styles);
    const blob = await z.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const nome = `Medicao_${ord(cur.num).replace("ª", "a")}_${pr.nome.split(" ")[0]}_${es.id}_${cur.data}.xlsx`;
    return new File([blob], nome, { type: blob.type });
  }

  window.Medicao = { abrir: abrirMedicao, aposMarcar, aoDesmarcar, fornecedores, carregar: escopos, _calcular: calcular, _boletim: boletim, _MED: () => MED };
  setTimeout(() => { if (typeof LOTS !== "undefined" && LOTS.length) escopos(); }, 1500);
})();
