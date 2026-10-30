// ---------- Efetivo diário ----------
// Lançado de manhã. O dia começa copiando o último dia lançado; só se ajusta com − / + o que mudou.
// Empresas = fornecedores dos contratos (automático) + empresas cadastradas em Ações (ex.: infra). Só terceiros.
// Máquinas por dono (empresa terceira ou Pacaembu). Imagem em cartões para o WhatsApp.
// Dados: S.efetivo[data] = {eq:[{emp,svc,n}], mq:[{dono,tipo,n}]}; cadastros em S.efCad.
"use strict";
(function () {
  const PACA = "PACAEMBU";
  const PADRAO = {
    empresas: [],
    servicos: ["Rede de água", "Rede de esgoto", "Drenagem", "Terraplenagem", "Pavimentação", "Calçadas e rampas", "Ligações de água e esgoto", "Limpeza de obra"],
    maquinas: ["Retroescavadeira", "Escavadeira", "Miniescavadeira", "Pá carregadeira", "Mini carregadeira", "Manipuladora", "Motoniveladora", "Rolo compactador", "Caminhão carga seca", "Caminhão basculante", "Caminhão-pipa", "Caminhão munck"]
  };
  let CONTR = [];
  const carregaContratos = async () => {
    try { CONTR = window.Medicao ? await Medicao.fornecedores() : []; } catch (e) { CONTR = []; }
  };
  const cad = () => {
    if (!S.efCad) S.efCad = JSON.parse(JSON.stringify(PADRAO));
    if (!S.efCad.maqV2) { // inclui as máquinas novas da lista padrão sem apagar as já cadastradas
      PADRAO.maquinas.forEach(m => { if (!S.efCad.maquinas.some(x => x.toLowerCase() === m.toLowerCase())) S.efCad.maquinas.push(m); });
      S.efCad.maqV2 = true;
    }
    return S.efCad;
  };
  const empresas = () => [...new Set([...CONTR, ...cad().empresas])].filter(n => n.toLowerCase() !== PACA.toLowerCase()).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const X = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const somaDias = (d, n) => { const x = new Date(d + "T12:00"); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };

  // dados no formato atual; converte o formato do primeiro protótipo (equipes × pessoas)
  const ef = () => {
    const E = (S.efetivo = S.efetivo || {});
    for (const d in E) {
      const e = E[d];
      (e.mq || []).forEach(x => { if (String(x.dono).toLowerCase() === "pacaembu") x.dono = PACA; });
      if (e.equipes || e.maquinas) {
        E[d] = { eq: (e.equipes || []).map(x => ({ emp: x.emp, svc: x.svc, n: (+x.eq || 0) * (+x.pes || 0) })),
                 mq: (e.maquinas || []).map(x => ({ dono: x.dono, tipo: x.tipo, n: +x.qtd || 0 })) };
      }
    }
    return E;
  };
  const tot = d => { const e = ef()[d]; if (!e) return { p: 0, e: 0, m: 0 };
    return { p: e.eq.reduce((t, x) => t + (x.svc ? x.n : 0), 0), e: new Set(e.eq.filter(x => x.n && x.svc).map(x => x.emp)).size, m: e.mq.reduce((t, x) => t + x.n, 0) }; };
  const anterior = d => Object.keys(ef()).filter(k => k < d && ((ef()[k].eq || []).length || (ef()[k].mq || []).length)).sort().pop();
  let base = null; // de onde o dia foi copiado, para marcar "alterado"

  const CSS = `<style>
    .efw{display:grid;grid-template-columns:minmax(0,1fr);gap:10px}
    .efw .dia{display:flex;align-items:center;gap:6px}.efw .dia button{width:36px;height:36px;border:1px solid var(--line);border-radius:8px;background:var(--surface);cursor:pointer;font-size:18px}
    .efw .dia b{font:700 18px var(--f-display);flex:1}
    .efw .kpi small{display:block;font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
    .efw .emp{border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--surface)}
    .efw .emp h3{margin:0;padding:9px 12px;background:color-mix(in srgb,var(--navy) 9%,var(--surface));display:flex;justify-content:space-between;gap:8px;font:600 17px var(--f-display)}
    .efw .emp.paca h3{background:color-mix(in srgb,var(--yellow) 22%,var(--surface))}
    .efw .emp h3 em{font-style:normal;font-variant-numeric:tabular-nums;color:var(--navy)}
    .efw .ln{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px;padding:7px 12px;border-top:1px solid var(--line)}
    .efw .ln .nm{min-width:0;overflow-wrap:anywhere}.efw .ln.zero .nm{color:var(--muted);text-decoration:line-through}
    .efw .ln.mud .nm::after{content:" · alterado";color:var(--warn);font-size:12px;font-weight:600}
    .efw .cnt{display:flex;align-items:center;gap:4px}.efw .cnt button{width:40px;height:40px;border-radius:50%;border:1px solid var(--line);background:var(--surface);font-size:22px;line-height:1;cursor:pointer}
    .efw .cnt button.mais{background:var(--navy);border-color:var(--navy);color:var(--surface)}.efw .cnt b{min-width:32px;text-align:center;font:700 22px var(--f-display);font-variant-numeric:tabular-nums}
    .efw .add{display:flex;gap:6px;padding:8px 12px;border-top:1px solid var(--line)}
    .efw .add select{flex:1;min-width:0;font:inherit;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink)}
    .efw .add.solta{border:1px dashed var(--line);border-radius:12px}
  </style>`;

  function mudaDia(n) { const i = $("dia"); i.value = somaDias(dia(), n); i.dispatchEvent(new Event("change")); base = null; tela(); }

  async function abrir() { await carregaContratos(); base = null; tela(); }

  function tela() {
    const d = dia(), e = ef()[d];
    const topo = `<div class="dia"><button id="fAnt" aria-label="Dia anterior">‹</button><b>${fmt(d)}</b><button id="fProx" aria-label="Próximo dia">›</button></div>`;
    if (!e) {
      const a = anterior(d), t = a ? tot(a) : null;
      openSheet("Efetivo do dia", `${CSS}<div class="efw">${topo}
        <p class="msg"><b>Nenhum efetivo lançado neste dia.</b>${a ? `<br>Último lançamento: ${fmt(a)} · ${t.p} pessoas · ${t.e} empresas · ${t.m} máquinas` : ""}</p>
        <div class="row">${a ? `<button class="btn pri" id="fCopia">Copiar ${fmt(a).slice(0, 5)} e ajustar</button>` : ""}</div>
        <div class="row"><button class="btn${a ? "" : " pri"}" id="fVazio">Começar vazio</button></div></div>`);
      if (a) $("fCopia").onclick = () => { ef()[d] = JSON.parse(JSON.stringify(ef()[a])); ef()[d].eq = ef()[d].eq.filter(x => x.n && x.svc); ef()[d].mq = ef()[d].mq.filter(x => x.n); base = JSON.parse(JSON.stringify(ef()[d])); save(); tela(); };
      $("fVazio").onclick = () => { ef()[d] = { eq: [], mq: [] }; base = null; save(); tela(); };
      $("fAnt").onclick = () => mudaDia(-1); $("fProx").onclick = () => mudaDia(1);
      return;
    }
    const t = tot(d), a = anterior(d), ta = a ? tot(a) : null;
    const dif = (v, w) => ta ? (v === w ? "igual ao anterior" : (v > w ? "+" : "") + (v - w) + " vs. anterior") : "";
    const pe = {}; e.eq.forEach((x, i) => (pe[x.emp] = pe[x.emp] || []).push(i));
    const pm = {}; e.mq.forEach((x, i) => (pm[x.dono] = pm[x.dono] || []).push(i));
    const mudou = (k, x) => base && !(base[k] || []).some(y => (k === "eq" ? y.emp === x.emp && y.svc === x.svc : y.dono === x.dono && y.tipo === x.tipo) && y.n === x.n);
    const linha = (k, i, nome) => { const x = e[k][i];
      return `<div class="ln${x.n ? "" : " zero"}${mudou(k, x) ? " mud" : ""}"><span class="nm">${X(nome)}</span><span class="cnt">
        <button data-k="${k}" data-i="${i}" data-d="-1" aria-label="Menos ${X(nome)}">−</button><b>${x.n}</b><button class="mais" data-k="${k}" data-i="${i}" data-d="1" aria-label="Mais ${X(nome)}">+</button></span></div>`; };
    const optServ = emp => { const ja = e.eq.filter(x => x.emp === emp).map(x => x.svc);
      return `<option value="">+ frente de serviço…</option><optgroup label="Habitação (lista padrão)">${ativos().filter(s => !ja.includes(s.nome)).map(s => `<option>${X(s.nome)}</option>`).join("")}</optgroup>
        <optgroup label="Infra e outros">${cad().servicos.filter(n => !ja.includes(n)).map(n => `<option>${X(n)}</option>`).join("")}</optgroup>`; };
    const optMaq = dono => { const ja = e.mq.filter(x => x.dono === dono).map(x => x.tipo); return `<option value="">+ máquina…</option>` + cad().maquinas.filter(n => !ja.includes(n)).map(n => `<option>${X(n)}</option>`).join("") + `<option value="__outra">Outra máquina (digitar)…</option>`; };
    const empSem = empresas().filter(n => !pe[n]), donoSem = [...empresas(), PACA].filter(n => !pm[n]);
    const somaGrupo = (k, idx) => idx.reduce((s, i) => s + e[k][i].n, 0);
    openSheet("Efetivo do dia", `${CSS}<div class="efw">${topo}
      <div class="kpis"><div class="kpi"><b>${t.p}</b><span>pessoas</span><small>${dif(t.p, ta?.p)}</small></div><div class="kpi"><b>${t.e}</b><span>empresas</span><small>${dif(t.e, ta?.e)}</small></div><div class="kpi"><b>${t.m}</b><span>máquinas</span><small>${dif(t.m, ta?.m)}</small></div></div>
      <div class="grp">Equipes · toque em − ou + só no que mudou</div>
      ${Object.keys(pe).map(emp => `<section class="emp"><h3><span>${X(emp)}</span><em>${somaGrupo("eq", pe[emp].filter(i => e.eq[i].svc))}</em></h3>
        ${pe[emp].filter(i => e.eq[i].svc).map(i => linha("eq", i, e.eq[i].svc)).join("")}
        <div class="add"><select data-novo="${X(emp)}" aria-label="Nova frente de ${X(emp)}">${optServ(emp)}</select></div></section>`).join("")}
      ${empSem.length ? `<div class="add solta"><select id="fEmp" aria-label="Nova empresa"><option value="">+ empresa…</option>${empSem.map(n => `<option>${X(n)}</option>`).join("")}</select></div>` : `<p class="msg">Para incluir empresas sem contrato no app, use Ações → Efetivo: cadastros.</p>`}
      <div class="grp">Máquinas ativas</div>
      ${Object.keys(pm).sort((x, y) => (x === PACA) - (y === PACA)).map(dn => `<section class="emp${dn === PACA ? " paca" : ""}"><h3><span>${X(dn)}</span><em>${somaGrupo("mq", pm[dn])}</em></h3>
        ${pm[dn].map(i => linha("mq", i, e.mq[i].tipo)).join("")}
        <div class="add"><select data-novam="${X(dn)}" aria-label="Nova máquina de ${X(dn)}">${optMaq(dn)}</select></div></section>`).join("")}
      ${donoSem.length ? `<div class="add solta"><select id="fDono" aria-label="Novo dono de máquina"><option value="">+ dono de máquina…</option>${donoSem.map(n => `<option>${X(n)}</option>`).join("")}</select></div>` : ""}
      <p class="msg">Linha em 0 não entra na imagem e não é copiada para o dia seguinte. Os números são de pessoas.</p>
      <div class="row"><button class="btn" id="fRefaz">Refazer o dia</button><button class="btn pri" id="fImg">Gerar imagem</button></div></div>`);
    const B = $("sheetB");
    $("fAnt").onclick = () => mudaDia(-1); $("fProx").onclick = () => mudaDia(1);
    B.querySelectorAll("[data-d]").forEach(b => b.onclick = () => { const x = e[b.dataset.k][+b.dataset.i]; x.n = Math.max(0, x.n + +b.dataset.d); save(); const st = B.scrollTop; tela(); $("sheetB").scrollTop = st; });
    B.querySelectorAll("[data-novo]").forEach(s => s.onchange = () => { if (!s.value) return; const ph = e.eq.find(x => x.emp === s.dataset.novo && !x.svc); if (ph) { ph.svc = s.value; ph.n = 1; } else e.eq.push({ emp: s.dataset.novo, svc: s.value, n: 1 }); save(); const st = B.scrollTop; tela(); $("sheetB").scrollTop = st; });
    B.querySelectorAll("[data-novam]").forEach(s => s.onchange = () => {
      if (!s.value) return;
      if (s.value === "__outra") {
        const box = s.parentElement;
        box.innerHTML = `<input class="search" placeholder="Nome da máquina" aria-label="Nome da máquina nova" style="flex:1;min-width:0"><button class="btn pri" style="flex:0 0 auto">OK</button>`;
        const inp = box.querySelector("input"), ok = box.querySelector("button"); inp.focus();
        const add = () => { const v = inp.value.trim(); if (!v) { inp.focus(); return; }
          if (!cad().maquinas.some(m => m.toLowerCase() === v.toLowerCase())) cad().maquinas.push(v);
          e.mq.push({ dono: s.dataset.novam, tipo: v, n: 1 }); save(); const st = B.scrollTop; tela(); $("sheetB").scrollTop = st; toast(`"${v}" incluída e salva na lista de máquinas`); };
        ok.onclick = add; inp.onkeydown = ev => { if (ev.key === "Enter") add(); };
        return;
      }
      e.mq.push({ dono: s.dataset.novam, tipo: s.value, n: 1 }); save(); const st = B.scrollTop; tela(); $("sheetB").scrollTop = st; });
    if ($("fEmp")) $("fEmp").onchange = ev => { const v = ev.target.value; if (!v) return; e.eq.push({ emp: v, svc: "", n: 0 }); save(); const st = B.scrollTop; tela(); $("sheetB").scrollTop = st; const s = document.querySelector(`[data-novo="${window.CSS.escape(v)}"]`); if (s) s.focus(); };
    if ($("fDono")) $("fDono").onchange = ev => { const v = ev.target.value; if (!v) return; e.mq.push({ dono: v, tipo: cad().maquinas[0] || "Máquina", n: 1 }); save(); const st = B.scrollTop; tela(); $("sheetB").scrollTop = st; };
    $("fRefaz").onclick = () => { const c = $("fRefaz"); if (c.dataset.ok) { delete ef()[d]; base = null; save(); tela(); } else { c.dataset.ok = 1; c.textContent = "Toque de novo para apagar o dia"; } };
    $("fImg").onclick = () => enviar(d);
  }

  // ---------- imagem em cartões ----------
  function cartoes(info) {
    const NAVY = "#013244", RED = "#DF062F", YEL = "#F8B706", SOFT = "#EEF2F7", AMB = "#FFF4D6", GR = "#5d6878";
    const FD = "'Barlow Condensed','Arial Narrow',Arial,sans-serif", FB = "Barlow,Arial,sans-serif";
    const W = 620, M = 16, GAP = 12, cw = (W - 2 * M - GAP) / 2;
    const tt = e => e.s.reduce((a, b) => a + b[1], 0);
    const TP = info.emp.reduce((a, e) => a + tt(e), 0), TM = info.maq.reduce((a, e) => a + tt(e), 0);
    const ch = e => 48 + e.s.length * 22 + 10;
    const alt = l => { const hs = []; for (let r = 0; r < Math.ceil(l.length / 2); r++) hs.push(Math.max(...l.slice(r * 2, r * 2 + 2).map(ch))); return hs; };
    const hE = alt(info.emp), hM = alt(info.maq), soma = hs => hs.reduce((a, b) => a + b + GAP, 0);
    const H = M + 48 + 64 + (info.emp.length ? soma(hE) : 30) + (info.maq.length ? 30 + soma(hM) : 0) + 24;
    const c = document.createElement("canvas"); c.width = W * 2; c.height = H * 2; const g = c.getContext("2d"); g.scale(2, 2); g.fillStyle = "#fff"; g.fillRect(0, 0, W, H); g.textBaseline = "middle";
    const lg = typeof LOGO !== "undefined" && LOGO.complete && LOGO.naturalWidth ? Math.round(34 * LOGO.naturalWidth / LOGO.naturalHeight) : 0;
    if (lg) g.drawImage(LOGO, M, M, lg, 34);
    const xT = M + (lg ? lg + 10 : 0), wT = W - M - xT;
    g.fillStyle = NAVY; g.fillRect(xT, M, wT, 30); g.fillStyle = YEL; g.fillRect(xT, M + 30, wT * .04, 4); g.fillStyle = RED; g.fillRect(xT + wT * .04, M + 30, wT * .96, 4);
    g.fillStyle = "#fff"; g.font = `700 18px ${FD}`; g.textAlign = "center"; g.fillText(info.titulo, xT + wT / 2, M + 15);
    let y = M + 48;
    [["DATA", info.data], ["PESSOAS", TP], ["EMPRESAS", info.emp.length], ["MÁQUINAS", TM]].forEach(([k, v], i) => { const x = M + i * (W - 2 * M) / 4; g.textAlign = "left"; g.fillStyle = GR; g.font = `600 11px ${FB}`; g.fillText(k, x, y + 10); g.fillStyle = i ? NAVY : "#0000FF"; g.font = `700 ${i ? 28 : 20}px ${FD}`; g.fillText(String(v), x, y + 36); });
    y += 64;
    const rr = (x, yy, w, h, r, fill, stroke) => { g.beginPath(); g.roundRect(x, yy, w, h, r); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1; g.stroke(); } };
    const corta = (t, w) => { while (g.measureText(t).width > w && t.length > 3) t = t.slice(0, -2) + "…"; return t; };
    const bloco = (lista, hs, cab) => { lista.forEach((e, i) => { const col = i % 2, r = Math.floor(i / 2), x = M + col * (cw + GAP), yy = y + soma(hs.slice(0, r)), h = hs[r];
        rr(x, yy, cw, h, 10, "#fff", "#D3DAE4"); g.beginPath(); g.roundRect(x, yy, cw, 40, [10, 10, 0, 0]); g.fillStyle = cab(e); g.fill();
        g.textAlign = "left"; g.fillStyle = NAVY; g.font = `700 16px ${FD}`; g.fillText(corta(e.n, cw - 70), x + 12, yy + 20);
        g.textAlign = "right"; g.font = `700 24px ${FD}`; g.fillText(tt(e), x + cw - 12, yy + 20);
        e.s.forEach(([s, n], k) => { const ly = yy + 56 + k * 22; g.textAlign = "left"; g.fillStyle = "#222"; g.font = `400 13px ${FB}`; g.fillText(corta(s, cw - 60), x + 12, ly); g.textAlign = "right"; g.font = `600 14px ${FB}`; g.fillText(n, x + cw - 12, ly); }); });
      y += soma(hs); };
    if (info.emp.length) bloco(info.emp, hE, () => SOFT); else { g.fillStyle = GR; g.font = `italic 13px ${FB}`; g.textAlign = "left"; g.fillText("Nenhuma equipe lançada.", M, y + 10); y += 30; }
    if (info.maq.length) { g.textAlign = "left"; g.fillStyle = GR; g.font = `700 13px ${FD}`; g.fillText("MÁQUINAS ATIVAS", M, y + 8); y += 24; bloco(info.maq, hM, e => e.paca ? AMB : SOFT); }
    return new Promise(r => c.toBlob(r, "image/png"));
  }
  function imagem(d) {
    const e = ef()[d], eq = e.eq.filter(x => x.n && x.svc), mq = e.mq.filter(x => x.n);
    const pe = {}; eq.forEach(x => (pe[x.emp] = pe[x.emp] || []).push([x.svc, x.n]));
    const pm = {}; mq.forEach(x => (pm[x.dono] = pm[x.dono] || []).push([x.tipo, x.n]));
    const tt = a => a.reduce((s, b) => s + b[1], 0);
    const emp = Object.keys(pe).sort((a, b) => tt(pe[b]) - tt(pe[a])).map(n => ({ n, s: pe[n] }));
    const maq = Object.keys(pm).sort((a, b) => (a === PACA) - (b === PACA) || tt(pm[b]) - tt(pm[a])).map(n => ({ n, s: pm[n], paca: n === PACA }));
    const obra = (document.getElementById("obra")?.textContent || "").toUpperCase();
    return cartoes({ titulo: `EFETIVO DIÁRIO · ${obra}`, data: fmt(d), emp, maq });
  }

  async function enviar(d) {
    const blob = await imagem(d), f = new File([blob], `Efetivo_${d}.png`, { type: "image/png" }), url = URL.createObjectURL(blob);
    const pode = !!(navigator.canShare && navigator.canShare({ files: [f] }));
    openSheet("Efetivo do dia", `<div class="row"><button class="btn pri" id="gSh">Enviar pelo WhatsApp</button></div>
      <div class="row"><button class="btn" id="gCp">Copiar imagem</button><button class="btn" id="gSv">Salvar imagem</button></div>
      <div class="row"><button class="btn" id="gEd">Voltar e editar</button></div>
      <img class="preview" src="${url}" alt="Efetivo do dia ${fmt(d)}">`);
    $("gSh").onclick = async () => { if (!pode) { toast("Compartilhar indisponível aqui. Use Salvar imagem.", false, true); return; }
      try { await navigator.share({ files: [f], text: `Efetivo ${fmt(d)}` }); } catch (e) { if (e.name !== "AbortError") toast("Não abriu o compartilhamento. Use Salvar imagem.", false, true); } };
    $("gCp").onclick = async () => { try { await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); toast("Imagem copiada. Cole no WhatsApp ou no e-mail."); } catch (e) { toast("Este aparelho não permite copiar imagem. Use Salvar imagem.", false, true); } };
    $("gSv").onclick = () => salvar(f);
    $("gEd").onclick = tela;
  }

  // ---------- cadastros (em Ações) ----------
  async function cadastros() {
    await carregaContratos();
    const C = cad(), ta = (id, l, v, h) => `<label class="f">${l}<textarea id="${id}" rows="${Math.min(10, Math.max(3, v.length + 1))}">${X(v.join("\n"))}</textarea></label>${h ? `<p class="msg">${h}</p>` : ""}`;
    openSheet("Efetivo: cadastros", `<p class="msg">Um nome por linha. Tirar um nome não apaga os dias já lançados.</p>
      <p class="msg"><b>Já aparecem sozinhas (contratos do app):</b> ${CONTR.length ? CONTR.map(X).join(", ") : "nenhuma"}.</p>
      ${ta("cE", "Outras empresas terceiras (sem contrato no app)", C.empresas, "Ex.: empresa de infra. A PACAEMBU não entra aqui: ela aparece só como dona de máquinas.")}
      ${ta("cS", "Outros serviços (fora da lista padrão)", C.servicos, "Os serviços de habitação vêm da lista padrão do app.")}
      ${ta("cM", "Tipos de máquina", C.maquinas, "")}
      <div class="row"><button class="btn" id="cCan">Cancelar</button><button class="btn pri" id="cOk">Salvar</button></div>`);
    const lst = id => [...new Set($(id).value.split("\n").map(s => s.trim()).filter(Boolean))];
    $("cCan").onclick = abrirAjustes;
    $("cOk").onclick = () => { S.efCad = { empresas: lst("cE").filter(n => n.toLowerCase() !== PACA.toLowerCase()), servicos: lst("cS"), maquinas: lst("cM"), maqV2: true }; save(); toast("Cadastros do efetivo salvos"); abrirAjustes(); };
  }

  window.Efetivo = { abrir, cadastros, _imagem: imagem };
})();
