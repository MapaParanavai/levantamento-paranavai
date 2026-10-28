// Gera o Mapa de Produção completo a partir da planilha modelo.
// Copia o XML da aba MODELO para cada serviço (formatação 100% preservada) e grava as datas.
(function (root) {
  const DEC = s => s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const ESC = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const serial = iso => { const [y, m, d] = iso.split('-').map(Number); return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000; };
  const colNum = c => c.split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
  const splitRef = ref => { const m = /^([A-Z]+)(\d+)$/.exec(ref); return [m[1], +m[2]]; };
  const cellRe = ref => new RegExp('<c r="' + ref + '"(?=[\\s>/])([^>]*?)(?:/>|>([\\s\\S]*?)</c>)');

  // grava conteúdo numa célula, preservando o estilo; cria a célula se não existir
  function setCell(xml, ref, kind, val) {
    const re = cellRe(ref);
    const m = re.exec(xml);
    let s = '';
    if (m) { const sm = / s="(\d+)"/.exec(m[1]); if (sm) s = ' s="' + sm[1] + '"'; }
    let novo;
    if (kind === 'n') novo = `<c r="${ref}"${s}><v>${val}</v></c>`;
    else if (kind === 's') novo = `<c r="${ref}"${s} t="inlineStr"><is><t>${ESC(val)}</t></is></c>`;
    else if (kind === 'f') novo = `<c r="${ref}"${s}><f>${ESC(val)}</f></c>`;
    else novo = `<c r="${ref}"${s}/>`;
    if (m) return xml.replace(re, novo);
    if (kind === 'x') return xml;
    // inserir na linha certa, na ordem das colunas
    const [col, row] = splitRef(ref);
    const rowRe = new RegExp('<row r="' + row + '"([^>]*?)(?:/>|>([\\s\\S]*?)</row>)');
    const rm = rowRe.exec(xml);
    if (!rm) {
      // cria a linha antes da próxima linha maior
      const rows = [...xml.matchAll(/<row r="(\d+)"/g)];
      const next = rows.find(x => +x[1] > row);
      const nr = `<row r="${row}">${novo}</row>`;
      if (next) return xml.slice(0, next.index) + nr + xml.slice(next.index);
      return xml.replace('</sheetData>', nr + '</sheetData>');
    }
    let inner = rm[2] || '';
    const cells = [...inner.matchAll(/<c r="([A-Z]+)\d+"/g)];
    const after = cells.find(x => colNum(x[1]) > colNum(col));
    inner = after ? inner.slice(0, after.index) + novo + inner.slice(after.index) : inner + novo;
    return xml.replace(rowRe, `<row r="${row}"${rm[1].replace(/\s*\/$/, '')}>${inner}</row>`);
  }

  function textOf(xml, ref, shared) {
    const m = cellRe(ref).exec(xml); if (!m) return '';
    const inner = m[2] || '';
    if (/t="s"/.test(m[1])) { const v = /<v>(\d+)<\/v>/.exec(inner); return v ? shared[+v[1]] || '' : ''; }
    const ts = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('');
    return DEC(ts);
  }

  async function gerar(JSZip, templateBytes, opts) {
    // opts: { data:'AAAA-MM-DD', servicos:[{num,nome,aba,ant}], lots:[{id,inp}], marks:{aba:{lotId:'AAAA-MM-DD'}} }
    const zip = await JSZip.loadAsync(templateBytes);
    const rd = p => zip.file(p).async('string');
    let wbx = await rd('xl/workbook.xml');
    let rels = await rd('xl/_rels/workbook.xml.rels');
    let ct = await rd('[Content_Types].xml');
    let shared = [];
    if (zip.file('xl/sharedStrings.xml')) {
      const ss = await rd('xl/sharedStrings.xml');
      shared = [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(x => DEC([...x[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(y => y[1]).join('')));
    }
    const relTarget = {};
    for (const m of rels.matchAll(/<Relationship\b([^>]*)\/>/g)) {
      const id = /Id="([^"]+)"/.exec(m[1])[1], t = /Target="([^"]+)"/.exec(m[1])[1];
      relTarget[id] = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
    }
    const sheets = [...wbx.matchAll(/<sheet\b([^>]*?)\/>/g)].map(m => ({
      raw: m[0], name: DEC(/name="([^"]+)"/.exec(m[1])[1]), id: +/sheetId="(\d+)"/.exec(m[1])[1],
      rid: /r:id="([^"]+)"/.exec(m[1])[1]
    }));
    sheets.forEach(s => s.path = relTarget[s.rid]);
    const byName = n => sheets.find(s => s.name.toUpperCase() === n);
    const modelo = byName('MODELO LEVANTAMENTO'), capa = byName('CAPA'), mestre = byName('MAPA MESTRE');
    if (!modelo || !capa) throw new Error('A planilha modelo precisa das abas CAPA e MODELO LEVANTAMENTO.');
    const val = serial(opts.data);
    const usadas = new Set(sheets.map(s => s.name.toUpperCase()));

    // modelo base para as abas de serviço
    let base = await rd(modelo.path);
    base = base.replace(/<legacyDrawing\b[^>]*\/>/g, '').replace(/ tabSelected="1"/g, '');
    base = setCell(base, 'B5', 'n', val);

    // remove abas de serviço que já existam no modelo (serão recriadas com os dados do app)
    const nomesServ = new Set(opts.servicos.map(s => s.aba.toUpperCase()));
    for (const s of sheets.filter(s => nomesServ.has(s.name.toUpperCase()))) {
      wbx = wbx.replace(s.raw, '');
      rels = rels.replace(new RegExp('<Relationship\\b[^>]*Id="' + s.rid + '"[^>]*/>'), '');
      ct = ct.replace(new RegExp('<Override PartName="/' + s.path.replace(/[.]/g, '\\.') + '"[^>]*/>'), '');
      zip.remove(s.path);
      usadas.delete(s.name.toUpperCase());
    }

    let maxId = Math.max(...sheets.map(s => s.id));
    let n = 1; const novos = [];
    const lotInp = Object.fromEntries(opts.lots.map(l => [l.id, l.inp]));
    for (const sv of opts.servicos) {
      if (opts.soComDados && !Object.keys(opts.marks[sv.aba] || {}).length) continue;
      let xml = base;
      const mk = opts.marks[sv.aba] || {};
      for (const [lot, d] of Object.entries(mk)) if (lotInp[lot] && d) xml = setCell(xml, lotInp[lot], 'n', serial(d));
      while (zip.file(`xl/worksheets/serv${n}.xml`)) n++;
      const path = `xl/worksheets/serv${n}.xml`, rid = `rIdServ${n}`; n++;
      zip.file(path, xml);
      maxId++;
      novos.push(`<sheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" name="${ESC(sv.aba)}" sheetId="${maxId}" state="visible" r:id="${rid}"/>`);
      rels = rels.replace('</Relationships>', `<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/${path}" Id="${rid}"/></Relationships>`);
      ct = ct.replace('</Types>', `<Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
    }
    // novas abas logo após o MODELO
    wbx = wbx.replace(modelo.raw, modelo.raw + novos.join(''));
    // índices das abas mudaram: refaz áreas de impressão locais
    const ordem = [...wbx.matchAll(/<sheet\b[^>]*name="([^"]+)"/g)].map(m => DEC(m[1]));
    wbx = wbx.replace(/<definedName name="_xlnm\.Print_Area" localSheetId="\d+">([^<]*)<\/definedName>/g, (all, ref) => {
      const nm = /^'?(.*?)'?!/.exec(DEC(ref)); if (!nm) return all;
      const i = ordem.indexOf(nm[1]); return i < 0 ? '' : `<definedName name="_xlnm.Print_Area" localSheetId="${i}">${ref}</definedName>`;
    });
    wbx = wbx.replace(/activeTab="\d+"/, 'activeTab="0"').replace(/firstSheet="\d+"/, 'firstSheet="0"');
    if (/<calcPr\b/.test(wbx)) wbx = wbx.replace(/<calcPr\b([^>]*?)\/>/, (a, b) => '<calcPr' + b.replace(/\s*fullCalcOnLoad="\d"/, '') + ' fullCalcOnLoad="1"/>');
    else wbx = wbx.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>');
    // a cadeia de cálculo antiga fica inválida: remove
    if (zip.file('xl/calcChain.xml')) {
      zip.remove('xl/calcChain.xml');
      rels = rels.replace(/<Relationship\b[^>]*calcChain[^>]*\/>/, '');
      ct = ct.replace(/<Override PartName="\/xl\/calcChain\.xml"[^>]*\/>/, '');
    }

    // CAPA: data fixa do levantamento + lista de serviços do app
    let cx = await rd(capa.path);
    const hdrRow = 6, cols = {};
    for (const m of cx.matchAll(new RegExp('<c r="([A-Z]+)' + hdrRow + '"', 'g'))) cols[textOf(cx, m[1] + hdrRow, shared).trim().toUpperCase()] = m[1];
    const C = { num: cols['Nº'], nome: cols['SERVIÇOS'], ant: cols['ANTECESSORA (Nº)'], aba: cols['NOME DA ABA'] };
    if (!C.num || !C.nome || !C.aba) throw new Error('Não encontrei os cabeçalhos da CAPA (Nº, SERVIÇOS, NOME DA ABA).');
    // data do levantamento: célula com TODAY() mais acima; demais TODAY() passam a usar essa célula
    const tm = /<c r="([A-Z]+)(\d+)"[^>]*><f>TODAY\(\)<\/f>/.exec(cx);
    if (tm) {
      const ref = tm[1] + tm[2];
      cx = setCell(cx, ref, 'n', val);
      cx = cx.replace(/(<f>[^<]*?)TODAY\(\)/g, (a, b) => b + '$' + tm[1] + '$' + tm[2]).replace(/(<f>[^<]*?)TODAY\(\)/g, (a, b) => b + '$' + tm[1] + '$' + tm[2]);
    }
    // linhas de serviço: da linha 7 até a última com nome de aba
    let last = hdrRow;
    for (const m of cx.matchAll(new RegExp('<c r="' + C.aba + '(\\d+)"', 'g'))) if (+m[1] > hdrRow && textOf(cx, C.aba + m[1], shared)) last = Math.max(last, +m[1]);
    if (opts.servicos.length > last - hdrRow) throw new Error(`A CAPA tem ${last - hdrRow} linhas de serviço e o app tem ${opts.servicos.length}. Inclua linhas na CAPA do modelo.`);
    for (let i = 0; i < last - hdrRow; i++) {
      const r = hdrRow + 1 + i, sv = opts.servicos[i];
      if (sv) {
        cx = setCell(cx, C.num + r, 'n', sv.num);
        cx = setCell(cx, C.nome + r, 'f', `HYPERLINK("#'"&$${C.aba}${r}&"'!A1","${String(sv.nome).replace(/"/g, '""')}")`);
        const an = Array.isArray(sv.ant) ? sv.ant : (sv.ant ? [sv.ant] : []);
        if (C.ant) cx = an.length > 1 ? setCell(cx, C.ant + r, 's', an.join(' E ')) : an.length ? setCell(cx, C.ant + r, 'n', an[0]) : setCell(cx, C.ant + r, 'x');
        cx = setCell(cx, C.aba + r, 's', sv.aba);
      } else {
        [C.num, C.nome, C.ant, C.aba].filter(Boolean).forEach(c => cx = setCell(cx, c + r, 'x'));
      }
    }
    zip.file(capa.path, cx);
    if (mestre) zip.file(mestre.path, setCell(await rd(mestre.path), 'B5', 'n', val));

    zip.file('xl/workbook.xml', wbx);
    zip.file('xl/_rels/workbook.xml.rels', rels);
    zip.file('[Content_Types].xml', ct);
    if (zip.file('docProps/app.xml')) zip.file('docProps/app.xml', '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Excel</Application></Properties>');
    return zip;
  }
  root.MapaExport = { gerar, serial };
  if (typeof module !== 'undefined') module.exports = root.MapaExport;
})(typeof window !== 'undefined' ? window : globalThis);
