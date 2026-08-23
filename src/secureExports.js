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
    new TextEncoder().encode(JSON.stringify({ columns, rows: normalizeRows(rows), csv }))
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
          <div class="report-tools"><p>Unlocked locally in this browser. Keep this file in a private location.</p><button id="csv-download" type="button">Download CSV</button></div>
          <div class="table-wrap"><table><thead id="report-head"></thead><tbody id="report-body"></tbody></table></div>
        </section>
      </div>
    </section>
  </main>
  <script>
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
    document.getElementById('csv-download').addEventListener('click', () => {
      if (!report) return;
      const blob = new Blob(['\\ufeff' + report.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'wenappliances-unlocked-export.csv';
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
