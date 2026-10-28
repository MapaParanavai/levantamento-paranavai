// ---------- Medição de prestadores (protótipo) ----------
// Regra por item: medição do mês = mín(qtd contratada, (executado até a data + previsão) × fator + ajuste) − já medido; nunca negativa.
// Histórico das medições fica numa chave própria do aparelho, que a transferência do celular não apaga.
// Estrutura pensada para ir para a nuvem sem mudar: contratos[] com itens[], medicoes[contratoId][] com itens{n:{q,exec,prev,aj,just}}.
"use strict";
(function () {
  const MKEY = "levprod-paranavai-f1-medicoes";
  let MED = { versao: 1, medicoes: {} };
  let CONTRATOS = null;
  const ld = () => { try { const r = localStorage.getItem(MKEY); if (r) { const m = JSON.parse(r); if (m && m.medicoes) MED = m; } } catch (e) {} };
  const sv = () => { MED.atualizadoEm = new Date().toISOString(); try { localStorage.setItem(MKEY, JSON.stringify(MED)); } catch (e) { toast("Não consegui salvar as medições. Salve o backup.", false, true); } };
  ld();

  async function contratos() {
    if (!CONTRATOS) { try { CONTRATOS = await (await fetch("contratos.json")).json(); } catch (e) { CONTRATOS = []; } }
    return CONTRATOS;
  }
  const meds = id => (MED.medicoes[id] = MED.medicoes[id] || []);
  const svcNum = n => S.servicos.find(s => s.num === n);
  const addDias = (d, n) => { const x = new Date(d + "T12:00"); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  const dia25 = d => d.slice(0, 8) + "25";
  const N = v => { const x = Math.round(+v); return isFinite(x) ? x : 0; };
  const ord = k => k + "ª";

  function execAte(num, data) { const s = svcNum(num); if (!s) return 0; return Object.values(marksOf(s.id)).filter(d => d <= data).length; }
  function media(num, data) {
    const s = svcNum(num); if (!s) return 0; const ini = addDias(data, -29);
    const n = Object.values(marksOf(s.id)).filter(d => d >= ini && d <= data).length;
    return n / Math.max(1, uteis(ini, data));
  }

  // calcula a medição: prev = {atv: casas}, aj = {n: {q, just}}
  function calcular(ct, data, prevAte, prev, aj) {
    const tot = LOTS.length, hist = meds(ct.id);
    const atvs = [...new Set(ct.itens.map(i => i.atv).filter(Boolean))].sort((a, b) => a - b);
    const A = {};
    for (const a of atvs) {
      const s = svcNum(a), exec = execAte(a, data);
      const du = prevAte > data ? uteis(addDias(data, 1), prevAte) : 0;
      const sug = Math.max(0, Math.min(tot - exec, Math.round(media(a, data) * du)));
      const p = prev[a] != null ? Math.max(0, Math.min(tot - exec, N(prev[a]))) : sug;
      A[a] = { num: a, nome: s ? s.nome : "Atividade " + a + " (não existe no app)", existe: !!s, exec, sug, prev: p };
    }
    const itens = ct.itens.map(i => {
      const a = i.atv ? A[i.atv] : null, f = i.fator || 1;
      const ja = hist.reduce((t, m) => t + ((m.itens[i.n] || {}).q || 0), 0);
      const exec = a ? a.exec * f : 0, pv = a ? a.prev * f : 0;
      const ajq = aj[i.n] ? N(aj[i.n].q) : 0;
      const alvo = Math.min(i.qtd, exec + pv + ajq);
      const q = Math.max(0, alvo - ja);
      const adiantado = Math.max(0, ja - (exec + pv + ajq));
      return { ...i, ja, exec, prev: pv, aj: ajq, just: aj[i.n] ? aj[i.n].just || "" : "", q, saldo: i.qtd - ja - q, adiantado };
    });
    return { A, atvs, itens, total: itens.reduce((t, i) => t + i.q, 0) };
  }

  // ---------- telas ----------
  async function abrirMedicao() {
    const cts = await contratos();
    openSheet("Medição de prestadores", (cts.length ? cts.map(c => {
      const h = meds(c.id), u = h[h.length - 1];
      return `<button class="item" data-ct="${esc(c.id)}"><span><b>${esc(c.fornecedor)}</b><br><small>${esc(c.descricao)} · ${c.itens.length} itens${c.contrato ? " · " + esc(c.contrato) : ""}</small></span>
        <small>${h.length ? `${h.length} medições<br>última ${fmt(u.data)}` : "sem medições"}</small></button>`;
    }).join("") : `<p class="msg err">Nenhum contrato encontrado. Abra o app com internet uma vez.</p>`) +
      `<p class="msg">A medição usa a produção lançada neste aparelho. No computador, receba antes o arquivo do celular (Ajustes → Transferir e backup).</p>`);
    $("sheetB").querySelectorAll("[data-ct]").forEach(b => b.onclick = () => abrirContrato(b.dataset.ct));
  }

  async function abrirContrato(id) {
    const ct = (await contratos()).find(c => c.id === id); if (!ct) return;
    const h = meds(id);
    const atualizado = S.updatedAt ? new Date(S.updatedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";
    openSheet(ct.fornecedor, `
      <p class="msg">${esc(ct.descricao)} · ${ct.itens.length} itens · contrato ${esc(ct.contrato || "a definir")}<br>Produção deste aparelho atualizada em <b>${atualizado}</b>.</p>
      <div class="row"><button class="btn pri" id="mNova">Nova medição (${ord(h.length + 1)})</button></div>
      ${h.length ? `<div class="grp">Medições fechadas</div><div class="scroll"><table class="res" style="min-width:0"><tr><th>Nº</th><th>Data</th><th>Previsão até</th><th>Casas-item</th></tr>
        ${h.map(m => `<tr><td>${ord(m.num)}</td><td>${fmt(m.data)}</td><td>${fmt(m.prevAte)}</td><td>${Object.values(m.itens).reduce((t, x) => t + x.q, 0)}</td></tr>`).join("")}</table></div>
      <div class="row"><button class="btn" id="mBol">Boletim da ${ord(h.length)}</button><button class="btn" id="mDesf">Desfazer a ${ord(h.length)}</button></div>` : `<p class="msg">Nenhuma medição fechada ainda.</p>`}
      <div class="grp">Backup das medições</div>
      <div class="row"><button class="btn" id="mBk">Salvar backup</button></div>
      <label class="f">Restaurar backup (medicoes_….txt)<input type="file" id="mRest" accept=".txt,.json,text/plain,application/json"></label>
      <p class="msg" id="mMsg"></p>`);
    $("mNova").onclick = () => novaMedicao(ct);
    if (h.length) {
      $("mBol").onclick = () => boletim(ct, h.length);
      $("mDesf").onclick = () => {
        if (!confirm(`Desfazer a ${ord(h.length)} medição de ${fmt(h[h.length - 1].data)}? Os lotes voltam a ficar disponíveis para medir.`)) return;
        h.pop(); sv(); toast("Medição desfeita"); abrirContrato(id);
      };
    }
    $("mBk").onclick = salvarBackup;
    $("mRest").onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      let m; try { m = JSON.parse(await f.text()); if (!m.medicoes) throw 0; } catch (_) { $("mMsg").textContent = "Arquivo inválido."; $("mMsg").classList.add("err"); return; }
      const n = Object.values(m.medicoes).reduce((t, x) => t + x.length, 0);
      if (!confirm(`Substituir as medições deste aparelho pelo backup (${n} medições)?`)) { e.target.value = ""; return; }
      MED = m; sv(); toast("Backup das medições restaurado"); abrirContrato(id);
    };
  }

  function novaMedicao(ct) {
    const h = meds(ct.id), ult = h[h.length - 1];
    let data = hoje(), prevAte = dia25(hoje()); if (prevAte < data) prevAte = data;
    const prev = {}, aj = {};
    openSheet(`${ord(h.length + 1)} medição · ${ct.fornecedor}`, `<style>.mw>*+*{margin-top:10px}</style><div class="mw">
      <div class="row">
        <label class="f" style="flex:1">Data da medição<input type="date" id="nData" value="${data}"></label>
        <label class="f" style="flex:1">Previsão de execução até<input type="date" id="nPrev" value="${prevAte}"></label>
      </div>
      <p class="msg" id="nAviso"></p>
      <div class="kpis"><div class="kpi"><b id="kTot">0</b><span>casas-item nesta medição</span></div><div class="kpi"><b id="kIt">0</b><span>itens com medição</span></div><div class="kpi"><b id="kAd">0</b><span>itens com adiantado</span></div></div>
      <div class="scroll"><table class="res" id="nTab"></table></div>
      <p class="msg">Previsão: sugerida pela produção média dos últimos 30 dias × dias úteis até a data da previsão. Pode editar. Ajuste: só para casos especiais (ex.: ajuda ao empreiteiro), com justificativa.</p>
      <div class="row"><button class="btn" id="nCan">Voltar</button><button class="btn pri" id="nOk">Fechar ${ord(h.length + 1)} medição</button></div></div>`);
    let R = null;
    const desenhar = () => {
      data = $("nData").value || hoje(); prevAte = $("nPrev").value || data;
      R = calcular(ct, data, prevAte, prev, aj);
      const av = [];
      if (ult && data <= ult.data) av.push(`A data precisa ser depois da ${ord(ult.num)} medição (${fmt(ult.data)}).`);
      if (prevAte < data) av.push("A previsão precisa terminar na data da medição ou depois.");
      R.atvs.filter(a => !R.A[a].existe).forEach(a => av.push(`A atividade ${a} não existe na lista do app.`));
      $("nAviso").textContent = av.join(" "); $("nAviso").className = av.length ? "msg err" : "msg";
      $("nOk").disabled = av.length > 0;
      let html = `<tr><th>Item</th><th>Contr.</th><th>Já medido</th><th>Exec.</th><th>Prev.</th><th>Ajuste</th><th>Medição</th><th>Saldo</th></tr>`;
      const grupos = [...R.atvs.map(a => ({ a, its: R.itens.filter(i => i.atv === a) })), { a: null, its: R.itens.filter(i => !i.atv) }].filter(g => g.its.length);
      for (const g of grupos) {
        const A = g.a ? R.A[g.a] : null;
        html += `<tr><td colspan="8" style="text-align:left;background:color-mix(in srgb,var(--navy) 10%,transparent)"><b>${A ? A.num + " · " + esc(A.nome) : "Sem atividade vinculada"}</b>
          ${A ? ` · executado até ${fmtC(data)}: <b>${A.exec}</b> · previsão: <input type="number" min="0" data-prev="${A.num}" value="${A.prev}" style="width:64px;font:inherit;padding:2px 4px"> <small>(sugerida ${A.sug})</small>` : ""}</td></tr>`;
        for (const i of g.its) {
          html += `<tr${i.adiantado ? ` class="parado" title="Adiantado de ${i.adiantado} aguardando execução"` : i.q ? ` class="hoje"` : ""}><td style="text-align:left">${i.n} · ${esc(i.desc)}${i.aj ? `<br><input data-just="${i.n}" placeholder="Justificativa do ajuste" value="${esc(i.just)}" style="width:100%;font:inherit;font-size:12px;padding:2px 4px">` : ""}${i.adiantado ? `<br><small>adiantado de ${i.adiantado} aguardando execução</small>` : ""}</td>
            <td>${i.qtd}</td><td>${i.ja}</td><td>${i.exec}</td><td>${i.prev}</td>
            <td><input type="number" data-aj="${i.n}" value="${i.aj || ""}" style="width:56px;font:inherit;padding:2px 4px"></td><td><b>${i.q}</b></td><td>${i.saldo}</td></tr>`;
        }
      }
      $("nTab").innerHTML = html;
      $("kTot").textContent = R.total; $("kIt").textContent = R.itens.filter(i => i.q).length; $("kAd").textContent = R.itens.filter(i => i.adiantado).length;
      $("nTab").querySelectorAll("[data-prev]").forEach(x => x.onchange = () => { prev[x.dataset.prev] = x.value === "" ? null : +x.value; desenhar(); });
      $("nTab").querySelectorAll("[data-aj]").forEach(x => x.onchange = () => { const n = x.dataset.aj; if (x.value === "" || +x.value === 0) delete aj[n]; else aj[n] = { q: +x.value, just: (aj[n] || {}).just || "" }; desenhar(); });
      $("nTab").querySelectorAll("[data-just]").forEach(x => x.oninput = () => { aj[x.dataset.just].just = x.value; });
    };
    $("nData").onchange = desenhar; $("nPrev").onchange = desenhar;
    $("nCan").onclick = () => abrirContrato(ct.id);
    $("nOk").onclick = async () => {
      const semJust = R.itens.filter(i => i.aj && !(aj[i.n].just || "").trim());
      if (semJust.length) { toast(`Escreva a justificativa do ajuste no item ${semJust[0].n}.`, false, true); return; }
      if (!confirm(`Fechar a ${ord(h.length + 1)} medição de ${fmt(data)} com ${R.total} casas-item? Depois de fechada, ela entra no histórico.`)) return;
      const itens = {};
      R.itens.forEach(i => { itens[i.n] = { q: i.q, exec: i.exec, prev: i.prev, aj: i.aj, just: i.aj ? aj[i.n].just.trim() : "" }; });
      h.push({ num: h.length + 1, data, prevAte, fechadaEm: new Date().toISOString(), listaVer: S.listaVer || 1, itens });
      sv();
      await boletim(ct, h.length); await salvarBackup();
      toast(`${ord(h.length)} medição fechada. Boletim e backup salvos em Downloads.`);
      abrirContrato(ct.id);
    };
    desenhar();
  }

  async function salvarBackup() {
    const f = new File([JSON.stringify({ ...MED, _geradoEm: new Date().toISOString() })], `medicoes_${hoje()}.txt`, { type: "text/plain" });
    await salvar(f);
  }

  // ---------- boletim em Excel (só quantidades) ----------
  async function boletim(ct, ate) {
    const h = meds(ct.id).slice(0, ate), cur = h[h.length - 1];
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
    add([{ v: "CONTRATADA:", s: 7 }, { v: ct.fornecedor + (ct.contrato ? " - " + ct.contrato : " - contrato a definir"), s: 8 }]);
    add([{ v: "MEDIÇÃO:", s: 7 }, { v: `${ord(cur.num)} · data ${fmt(cur.data)} · previsão de execução até ${fmt(cur.prevAte)}`, s: 8 }]);
    add([]);
    const hdr = [{ v: "Código CT", s: 2 }, { v: "Serviços", s: 2 }, { v: "Unid.", s: 2 }, { v: "Quant.", s: 2 }];
    h.forEach(m => hdr.push({ v: `${ord(m.num)} Medição\n${fmt(m.data)}`, s: m === cur ? 9 : 2 }));
    hdr.push({ v: "Total medido", s: 2 }, { v: "Saldo a medir", s: 2 });
    add(hdr);
    let grp = null, totCur = 0;
    for (const i of ct.itens) {
      if (i.grupo !== grp) { grp = i.grupo; const r = [{ v: "", s: 5 }, { v: grp, s: 5 }]; for (let k = 2; k < nCol; k++) r.push({ v: "", s: 5 }); add(r); }
      const qs = h.map(m => (m.itens[i.n] || {}).q || 0), tot = qs.reduce((a, b) => a + b, 0);
      totCur += qs[qs.length - 1];
      const r = [{ v: i.cod, s: 4 }, { v: i.desc, s: 3 }, { v: i.un, s: 4 }, { v: i.qtd, s: 4 }];
      qs.forEach((q, k) => r.push({ v: q || 0, s: k === qs.length - 1 ? 6 : 4 }));
      r.push({ v: tot, s: 4 }, { v: i.qtd - tot, s: 4 });
      add(r);
    }
    add([]);
    add([{ v: "", s: 0 }, { v: `Total da ${ord(cur.num)} medição (casas-item): ${totCur}`, s: 8 }]);
    add([{ v: "", s: 0 }, { v: "Quantidades em casas. Valores, retenções e impostos são lançados no Sienge.", s: 10 }]);
    add([{ v: "", s: 0 }, { v: `Gerado pelo app de levantamento em ${new Date().toLocaleString("pt-BR")}.`, s: 10 }]);
    const sheet = rows.map((r, ri) => `<row r="${ri + 1}"${ri === 6 ? ' ht="30" customHeight="1"' : ri === 0 ? ' ht="36" customHeight="1"' : ""}>` + r.map((c, ci) => {
      const ref = col(ci) + (ri + 1), st = c.s ? ` s="${c.s}"` : "";
      return typeof c.v === "number" ? `<c r="${ref}"${st}><v>${c.v}</v></c>` : `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${X(c.v)}</t></is></c>`;
    }).join("") + `</row>`).join("");
    const widths = [14, 62, 7, 8, ...h.map(() => 12), 12, 12];
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="7" xSplit="2" topLeftCell="C8" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols><sheetData>${sheet}</sheetData><mergeCells count="${merges.length}">${merges.map(m => `<mergeCell ref="${m}"/>`).join("")}</mergeCells><pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup orientation="landscape" fitToHeight="0"/>${logo ? '<drawing r:id="rIdLogo"/>' : ""}</worksheet>`;
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
    z.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="BOLETIM ${ord(cur.num)}" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">'BOLETIM ${ord(cur.num)}'!$7:$7</definedName></definedNames></workbook>`);
    z.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
    z.file("xl/worksheets/sheet1.xml", xml);
    z.file("xl/styles.xml", styles);
    const blob = await z.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const nome = `Medicao_${ord(cur.num).replace("ª", "a")}_${ct.fornecedor.split(" ")[0]}_${cur.data}.xlsx`;
    await salvar(new File([blob], nome, { type: blob.type }));
  }

  window.Medicao = { abrir: abrirMedicao, _calcular: calcular, _boletim: boletim, _MED: () => MED, _contratos: contratos };
})();
