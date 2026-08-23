const EXPORT_ITERATIONS = 250000;

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const safeJsonForScript = (value) => JSON.stringify(value)
  .replaceAll('<', '\\u003c')
  .replaceAll('>', '\\u003e')
  .replaceAll('&', '\\u0026');

const csvCell = (value) => {
  const text = String(value ?? '');
  const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
};

const normalizeRows = (rows) => (Array.isArray(rows) ? rows : []).map((row) => ({ ...row }));

const buildXlsxBlob = ({ title, columns, rows, generatedAt = new Date() }) => {
  const xmlEscape = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

  const toExcelColumn = (index) => {
    let value = index + 1;
    let result = '';
    while (value > 0) {
      const remainder = (value - 1) % 26;
      result = String.fromCharCode(65 + remainder) + result;
      value = Math.floor((value - 1) / 26);
    }
    return result;
  };

  const isDateColumn = (key) => /(^|_)(created|updated|joined|placed|date|time)(_|$)/i.test(String(key || ''));
  const toExcelDate = (value) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return (date.getTime() - Date.UTC(1899, 11, 30)) / 86400000;
  };

  const safeCellValue = (value) => {
    const text = String(value ?? '');
    return /^[=+\-@]/.test(text) ? `'${text}` : text;
  };

  const cellXml = (reference, value, styleId, dateValue = false) => {
    if (value === null || value === undefined || value === '') return `<c r="${reference}" s="${styleId}"/>`;
    if (dateValue && typeof value === 'number' && Number.isFinite(value)) return `<c r="${reference}" s="${styleId}" t="n"><v>${value}</v></c>`;
    if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${reference}" s="${styleId}" t="n"><v>${value}</v></c>`;
    if (typeof value === 'boolean') return `<c r="${reference}" s="${styleId}" t="b"><v>${value ? 1 : 0}</v></c>`;
    return `<c r="${reference}" s="${styleId}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(safeCellValue(value))}</t></is></c>`;
  };

  const rowXml = (rowNumber, cells) => `<row r="${rowNumber}">${cells.join('')}</row>`;
  const normalizedColumns = Array.isArray(columns) && columns.length ? columns : [{ key: 'value', label: 'Value' }];
  const normalizedRows = normalizeRows(rows);
  const lastColumn = toExcelColumn(normalizedColumns.length - 1);
  const lastRow = 8 + normalizedRows.length;
  const createdLabel = generatedAt instanceof Date ? generatedAt.toLocaleString() : String(generatedAt || '');
  const safeSheetName = String(title || 'WenAppliances Export').replace(/[\\/*?:\[\]]/g, '-').slice(0, 31) || 'Export';
  const titleText = `WenAppliances - ${String(title || 'Administrative Export').replace(/\s+records?$/i, '')}`;

  const metadataRows = [
    rowXml(1, [cellXml('A1', titleText, 1)]),
    rowXml(2, [cellXml('A2', 'CONFIDENTIAL ADMINISTRATIVE EXPORT', 2)]),
    rowXml(3, []),
    rowXml(4, [cellXml('A4', 'Report', 3), cellXml('B4', title, 4)]),
    rowXml(5, [cellXml('A5', 'Generated', 3), cellXml('B5', createdLabel, 4)]),
    rowXml(6, [cellXml('A6', 'Watermark', 3), cellXml('B6', 'WENAPPLIANCES', 2)]),
    rowXml(7, [])
  ];

  const headerCells = normalizedColumns.map((column, index) => cellXml(`${toExcelColumn(index)}8`, column.label, 5));
  const dataRows = normalizedRows.map((row, rowIndex) => {
    const rowNumber = rowIndex + 9;
    const alternate = rowIndex % 2 === 1;
    const cells = normalizedColumns.map((column, columnIndex) => {
      const key = column.key;
      const rawValue = row?.[key];
      const dateValue = isDateColumn(key) && rawValue;
      const excelDate = dateValue ? toExcelDate(rawValue) : null;
      const value = excelDate === null ? rawValue : excelDate;
      const numeric = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)));
      const currency = /price|amount|total|cost|revenue|value/i.test(String(key || ''));
      const styleId = dateValue && excelDate !== null ? 9 : currency && numeric ? (alternate ? 11 : 8) : numeric ? (alternate ? 12 : 7) : (alternate ? 10 : 6);
      return cellXml(`${toExcelColumn(columnIndex)}${rowNumber}`, value, styleId, dateValue && excelDate !== null);
    });
    return rowXml(rowNumber, cells);
  });

  const widths = normalizedColumns.map((column) => {
    const longestValue = normalizedRows.reduce((longest, row) => Math.max(longest, String(row?.[column.key] ?? '').length), String(column.label || '').length);
    return Math.min(36, Math.max(14, longestValue + 3));
  });
  const colsXml = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('');
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
  <dimension ref="A1:${lastColumn}${lastRow}"/>
  <sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="8" topLeftCell="A9" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A9" sqref="A9"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="20"/>
  <cols>${colsXml}</cols>
  <sheetData>${metadataRows.join('')}${rowXml(8, headerCells)}${dataRows.join('')}</sheetData>
  <autoFilter ref="A8:${lastColumn}${lastRow}"/>
  <mergeCells count="1"><mergeCell ref="A1:${lastColumn}1"/></mergeCells>
  <pageMargins left="0.35" right="0.35" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
  <headerFooter><oddFooter>&amp;C WenAppliances - CONFIDENTIAL</oddFooter></headerFooter>
</worksheet>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm"/></numFmts>
  <fonts count="4"><font><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="16"/><color rgb="FFFFFFFF"/><name val="Aptos Display"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font></fonts>
  <fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF192734"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF9C6644"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF4EBE2"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="2"><border/><border><left style="thin"><color rgb="FFE0D8CF"/></left><right style="thin"><color rgb="FFE0D8CF"/></right><top style="thin"><color rgb="FFE0D8CF"/></top><bottom style="thin"><color rgb="FFE0D8CF"/></bottom></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="13">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="0" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="2" borderId="0" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="4" borderId="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="4" borderId="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="3" fontId="0" fillId="0" borderId="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="4" borderId="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="4" borderId="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="3" fontId="0" fillId="4" borderId="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="${xmlEscape(safeSheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>WenAppliances</Application></Properties>`;
  const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xmlEscape(title || 'WenAppliances Export')}</dc:title><dc:creator>WenAppliances</dc:creator></cp:coreProperties>`;

  const encoder = new TextEncoder();
  const concatBytes = (chunks) => {
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const output = new Uint8Array(total);
    let offset = 0;
    chunks.forEach((chunk) => {
      output.set(chunk, offset);
      offset += chunk.length;
    });
    return output;
  };
  const u16 = (value) => new Uint8Array([value & 255, (value >>> 8) & 255]);
  const u32 = (value) => new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]);
  const crc32 = (bytes) => {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [
    ['[Content_Types].xml', contentTypesXml],
    ['_rels/.rels', rootRelsXml],
    ['docProps/app.xml', appXml],
    ['docProps/core.xml', coreXml],
    ['xl/workbook.xml', workbookXml],
    ['xl/_rels/workbook.xml.rels', workbookRelsXml],
    ['xl/styles.xml', stylesXml],
    ['xl/worksheets/sheet1.xml', sheetXml]
  ].map(([name, content]) => ({ name, nameBytes: encoder.encode(name), bytes: encoder.encode(content) }));
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;
  parts.forEach((part) => {
    const checksum = crc32(part.bytes);
    const localHeader = concatBytes([u32(0x04034b50), u16(20), u16(0), u16(0), u16(dosTime), u16(dosDate), u32(checksum), u32(part.bytes.length), u32(part.bytes.length), u16(part.nameBytes.length), u16(0), part.nameBytes]);
    localChunks.push(localHeader, part.bytes);
    const centralHeader = concatBytes([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(dosTime), u16(dosDate), u32(checksum), u32(part.bytes.length), u32(part.bytes.length), u16(part.nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), part.nameBytes]);
    centralChunks.push(centralHeader);
    offset += localHeader.length + part.bytes.length;
  });
  const centralDirectory = concatBytes(centralChunks);
  const endRecord = concatBytes([u32(0x06054b50), u16(0), u16(0), u16(parts.length), u16(parts.length), u32(centralDirectory.length), u32(offset), u16(0)]);
  return new Blob([concatBytes([...localChunks, centralDirectory, endRecord])], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
};

export { buildXlsxBlob };

export const buildCsv = ({ title, columns, rows, generatedAt = new Date() }) => {
  const metadata = [
    ['WenAppliances'],
    ['CONFIDENTIAL ADMINISTRATIVE EXPORT'],
    ['Report', title],
    ['Generated', generatedAt.toLocaleString()],
    ['Watermark', 'WENAPPLIANCES'],
    []
  ];
  const csvRows = [
    ...metadata,
    columns.map((column) => column.label),
    ...normalizeRows(rows).map((row) => columns.map((column) => row[column.key]))
  ];
  return csvRows.map((row) => row.map(csvCell).join(',')).join('\n');
};

const downloadBlob = (filename, blob) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const downloadCsvExport = ({ filename, title, columns, rows }) => {
  const csv = buildCsv({ title, columns, rows });
  downloadBlob(filename, new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }));
};

export const downloadXlsxExport = ({ filename, title, columns, rows }) => {
  downloadBlob(filename, buildXlsxBlob({ title, columns, rows }));
};

const bytesToBase64 = (bytes) => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
};

const bufferToBase64 = (buffer) => bytesToBase64(new Uint8Array(buffer));

const deriveKey = async (pin, salt, usage) => {
  if (!globalThis.crypto?.subtle) {
    throw new Error('This browser cannot create an encrypted report. Please use an up-to-date browser.');
  }

  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: EXPORT_ITERATIONS,
      hash: 'SHA-256'
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage]
  );
};

const logoMarkup = `
  <div class="brand-lockup" aria-label="WenAppliances">
    <span class="brand-mark">W</span>
    <span class="brand-name"><strong>Wen</strong>Appliances</span>
  </div>
`;

export const buildProtectedReport = async ({ title, columns, rows, pin, generatedAt = new Date() }) => {
  const csv = buildCsv({ title, columns, rows, generatedAt });
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pin, salt, 'encrypt');
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify({ title, generatedAt: generatedAt instanceof Date ? generatedAt.toLocaleString() : String(generatedAt || ''), columns, rows: normalizeRows(rows), csv }))
  );

  const payload = {
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bufferToBase64(encrypted),
    iterations: EXPORT_ITERATIONS
  };
  const createdLabel = generatedAt.toLocaleString();
  const payloadLiteral = safeJsonForScript(payload);
  const safeTitle = escapeHtml(title);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>WenAppliances — ${safeTitle}</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #18202a; background: #f5f3ef; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: linear-gradient(135deg, #f7f5f1, #ece7df); }
    body::before { content: "WENAPPLIANCES  •  CONFIDENTIAL"; position: fixed; inset: 35% -10%; z-index: 0; transform: rotate(-24deg); color: rgba(156, 102, 68, .09); font-size: clamp(2rem, 8vw, 6rem); font-weight: 800; letter-spacing: .18em; white-space: nowrap; pointer-events: none; }
    .shell { position: relative; z-index: 1; width: min(1120px, calc(100% - 32px)); margin: 32px auto; }
    .card { border: 1px solid #ded8cf; border-radius: 20px; background: rgba(255, 255, 255, .92); box-shadow: 0 18px 50px rgba(37, 32, 28, .12); overflow: hidden; }
    .header { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 26px 30px; border-bottom: 1px solid #e9e4dc; }
    .brand-lockup { display: inline-flex; align-items: center; gap: 10px; }
    .brand-mark { display: inline-grid; place-items: center; width: 38px; height: 38px; border-radius: 11px; background: #9c6644; color: #fff; font-family: Georgia, serif; font-size: 1.45rem; }
    .brand-name { font-size: 1.25rem; color: #9c6644; letter-spacing: -.03em; }
    .brand-name strong { color: #18202a; }
    .eyebrow { margin: 0 0 6px; color: #9c6644; font-size: .76rem; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
    h1 { margin: 0; font-size: clamp(1.35rem, 3vw, 2rem); letter-spacing: -.04em; }
    .date { margin: 4px 0 0; color: #687487; font-size: .9rem; }
    .body { padding: 30px; }
    .unlock { width: min(460px, 100%); margin: 34px auto 24px; text-align: center; }
    .lock { display: grid; place-items: center; width: 56px; height: 56px; margin: 0 auto 18px; border-radius: 17px; background: #f2e6dc; color: #9c6644; font-size: 1.6rem; }
    .unlock h2 { margin: 0; font-size: 1.3rem; }
    .unlock p { color: #687487; line-height: 1.6; }
    form { display: flex; gap: 10px; margin-top: 20px; }
    input { min-width: 0; flex: 1; border: 1px solid #cfc8bd; border-radius: 10px; padding: 13px 14px; color: #18202a; background: #fff; font: inherit; }
    input:focus { outline: 3px solid rgba(156, 102, 68, .18); border-color: #9c6644; }
    button { border: 0; border-radius: 10px; padding: 13px 18px; background: #18202a; color: #fff; font: inherit; font-weight: 750; cursor: pointer; transition: transform .2s ease, box-shadow .2s ease, background .2s ease; }
    button:hover { transform: translateY(-1px); box-shadow: 0 8px 18px rgba(24, 32, 42, .18); background: #9c6644; }
    .error { min-height: 22px; margin: 12px 0 0; color: #b42318; font-size: .9rem; }
    .report-tools { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; margin-bottom: 20px; }
    .report-tools p { margin: 0; color: #687487; }
    .table-wrap { overflow-x: auto; border: 1px solid #e1dbd2; border-radius: 12px; }
    table { width: 100%; min-width: 700px; border-collapse: collapse; font-size: .9rem; }
    th, td { padding: 13px 15px; border-bottom: 1px solid #eee9e2; text-align: left; vertical-align: top; }
    th { background: #f3eee8; color: #59677a; font-size: .73rem; letter-spacing: .09em; text-transform: uppercase; }
    tr:last-child td { border-bottom: 0; }
    .hidden { display: none !important; }
    @media (max-width: 640px) { .shell { width: min(100% - 16px, 1120px); margin: 8px auto; } .header, .body { padding: 20px; } .header { align-items: flex-start; flex-direction: column; } form { flex-direction: column; } button { width: 100%; } }
  </style>
</head>
<body>
  <main class="shell">
    <section class="card">
      <header class="header">
        <div>${logoMarkup}<p class="eyebrow" style="margin-top: 16px">Secure administrative report</p><h1>${safeTitle}</h1><p class="date">Generated ${escapeHtml(createdLabel)}</p></div>
      </header>
      <div class="body">
        <section id="unlock-panel" class="unlock">
          <div class="lock" aria-hidden="true">🔒</div>
          <h2>Enter the export PIN</h2>
          <p>This report is encrypted. Enter the same PIN used when the report was downloaded to unlock the records.</p>
          <form id="unlock-form">
            <label for="export-pin" class="hidden">Export PIN</label>
            <input id="export-pin" type="password" autocomplete="off" inputmode="numeric" placeholder="Enter PIN or password" required>
            <button type="submit">Unlock report</button>
          </form>
          <p id="unlock-error" class="error" role="alert"></p>
        </section>
        <section id="report-panel" class="hidden">
          <div class="report-tools"><p>Unlocked locally in this browser. Keep this file in a private location.</p><button id="xlsx-download" type="button">Download XLSX</button></div>
          <div class="table-wrap"><table><thead id="report-head"></thead><tbody id="report-body"></tbody></table></div>
        </section>
      </div>
    </section>
  </main>
  <script>
    const buildXlsxBlob = ${buildXlsxBlob.toString()};
    const payload = ${payloadLiteral};
    const decodeBase64 = (value) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
    const deriveKey = async (pin, salt) => {
      const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
      return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: payload.iterations, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    };
    const form = document.getElementById('unlock-form');
    const pinInput = document.getElementById('export-pin');
    const error = document.getElementById('unlock-error');
    const unlockPanel = document.getElementById('unlock-panel');
    const reportPanel = document.getElementById('report-panel');
    let report;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      error.textContent = '';
      try {
        const key = await deriveKey(pinInput.value, decodeBase64(payload.salt));
        const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decodeBase64(payload.iv) }, key, decodeBase64(payload.ciphertext));
        report = JSON.parse(new TextDecoder().decode(clear));
        const head = document.getElementById('report-head');
        const body = document.getElementById('report-body');
        head.innerHTML = '';
        body.innerHTML = '';
        const headRow = document.createElement('tr');
        report.columns.forEach((column) => { const cell = document.createElement('th'); cell.textContent = column.label; headRow.appendChild(cell); });
        head.appendChild(headRow);
        report.rows.forEach((row) => { const tableRow = document.createElement('tr'); report.columns.forEach((column) => { const cell = document.createElement('td'); cell.textContent = row[column.key] ?? ''; tableRow.appendChild(cell); }); body.appendChild(tableRow); });
        unlockPanel.classList.add('hidden');
        reportPanel.classList.remove('hidden');
      } catch (unlockError) {
        error.textContent = 'That PIN could not unlock this report. Please try again.';
      }
    });
    document.getElementById('xlsx-download').addEventListener('click', () => {
      if (!report) return;
      const blob = buildXlsxBlob({ title: report.title || 'WenAppliances Export', generatedAt: report.generatedAt || new Date().toISOString(), columns: report.columns, rows: report.rows });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'wenappliances-unlocked-export.xlsx';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  </script>
</body>
</html>`;
};

export const downloadProtectedExport = async ({ filename, title, columns, rows, pin }) => {
  const html = await buildProtectedReport({ title, columns, rows, pin });
  downloadBlob(filename, new Blob([html], { type: 'text/html;charset=utf-8' }));
};
