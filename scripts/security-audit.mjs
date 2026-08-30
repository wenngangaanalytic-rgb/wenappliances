#!/usr/bin/env node

/**
 * Low-impact security audit for the public WenAppliances deployments.
 *
 * This tool intentionally uses GET requests only. It does not brute-force,
 * fuzz, exploit, mutate data, test credentials, or attempt SQL injection.
 */

const DEFAULT_TARGETS = [
  'https://wenappliances.net',
  'https://www.wenappliances.net',
  'https://wenappliances-admin.vercel.app'
];

const ALLOWED_HOSTS = new Set([
  'wenappliances.net',
  'www.wenappliances.net',
  'wenappliances.vercel.app',
  'wenappliances-admin.vercel.app'
]);

const REQUEST_TIMEOUT_MS = 12_000;
const REQUEST_DELAY_MS = 120;
const MAX_BODY_BYTES = 512 * 1024;

const SENSITIVE_PATHS = [
  '/.env',
  '/.git/HEAD',
  '/package.json',
  '/src/',
  '/node_modules/',
  '/supabase/'
];

const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const usage = () => `
WenAppliances low-impact security audit

Usage:
  npm run security:audit
  npm run security:audit -- --target https://wenappliances.net
  npm run security:audit -- --target https://wenappliances.net --target https://wenappliances-admin.vercel.app
  npm run security:audit -- --json

Only WenAppliances-owned hosts are accepted. The audit sends GET requests only.
`;

const parseArgs = () => {
  const args = process.argv.slice(2);
  const targets = [];
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') {
      console.log(usage());
      process.exit(0);
    }
    if (argument === '--json') {
      json = true;
      continue;
    }
    if (argument === '--target') {
      const value = args[index + 1];
      if (!value) throw new Error('--target requires a URL.');
      targets.push(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  return { targets: targets.length ? targets : DEFAULT_TARGETS, json };
};

const normalizeTarget = (value) => {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error(`Only HTTPS targets are allowed: ${value}`);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`Targets cannot contain credentials, query strings, or fragments: ${value}`);
  }
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error(`Target is outside the WenAppliances allowlist: ${url.hostname}`);
  }
  return url.origin;
};

const headerMap = (headers) => Object.fromEntries(
  [...headers.entries()].map(([name, value]) => [name.toLowerCase(), value])
);

const readResponseBody = async (response) => {
  const buffer = new Uint8Array(await response.arrayBuffer());
  const limited = buffer.slice(0, MAX_BODY_BYTES);
  return {
    bytes: buffer.byteLength,
    truncated: buffer.byteLength > MAX_BODY_BYTES,
    text: new TextDecoder().decode(limited)
  };
};

const request = async (url, options = {}) => {
  await sleep(REQUEST_DELAY_MS);
  const response = await fetch(url, {
    method: 'GET',
    redirect: options.redirect || 'manual',
    headers: {
      accept: 'text/html,application/json,text/plain,*/*',
      'user-agent': 'WenAppliances-SecurityAudit/1.0 (authorized low-impact audit)'
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  const body = await readResponseBody(response);
  return {
    status: response.status,
    headers: headerMap(response.headers),
    body,
    url
  };
};

const looksLikeSpaFallback = (result) => {
  const contentType = result.headers['content-type'] || '';
  return contentType.includes('text/html') && /<!doctype html|<html[\s>]/i.test(result.body.text);
};

const addFinding = (report, severity, code, message, evidence = '') => {
  report.findings.push({ severity, code, message, evidence });
};

const checkSecurityHeaders = (report, result) => {
  const headers = result.headers;
  const csp = headers['content-security-policy'] || '';
  const frameProtected = Boolean(headers['x-frame-options']) || /(?:^|;)\s*frame-ancestors\s+/i.test(csp);

  if (!headers['strict-transport-security']) {
    addFinding(report, 'medium', 'HSTS-MISSING', 'Strict-Transport-Security is not present.', 'HTTPS is enabled, but browsers are not instructed to enforce it.');
  }
  if (!csp) {
    addFinding(report, 'medium', 'CSP-MISSING', 'Content-Security-Policy is not present.', 'Add a policy appropriate for the Vite storefront/admin assets.');
  } else {
    if (/unsafe-inline/i.test(csp)) addFinding(report, 'low', 'CSP-INLINE', 'CSP allows unsafe-inline.', csp);
    if (/unsafe-eval/i.test(csp)) addFinding(report, 'low', 'CSP-EVAL', 'CSP allows unsafe-eval.', csp);
    if (/(^|\s)\*(\s|$)/.test(csp)) addFinding(report, 'low', 'CSP-WILDCARD', 'CSP contains a broad wildcard source.', csp);
  }
  if (!frameProtected) addFinding(report, 'medium', 'CLICKJACKING', 'No clickjacking protection was detected.', 'Add X-Frame-Options or CSP frame-ancestors.');
  if ((headers['x-content-type-options'] || '').toLowerCase() !== 'nosniff') {
    addFinding(report, 'low', 'NOSNIFF-MISSING', 'X-Content-Type-Options is missing or is not set to nosniff.');
  }
  if (!headers['referrer-policy']) addFinding(report, 'low', 'REFERRER-POLICY-MISSING', 'Referrer-Policy is not present.');
  if (!headers['permissions-policy']) addFinding(report, 'low', 'PERMISSIONS-POLICY-MISSING', 'Permissions-Policy is not present.');
  if (!headers['cross-origin-opener-policy']) addFinding(report, 'low', 'COOP-MISSING', 'Cross-Origin-Opener-Policy is not present.');
  if ((headers['access-control-allow-origin'] || '').trim() === '*') {
    addFinding(report, 'medium', 'CORS-WILDCARD', 'Access-Control-Allow-Origin allows every origin.', 'Review whether wildcard CORS is required.');
  }
  if (headers['x-powered-by']) addFinding(report, 'low', 'TECH-DISCLOSURE', 'X-Powered-By reveals implementation details.', headers['x-powered-by']);

  const setCookies = typeof result.headers['set-cookie'] === 'string' ? result.headers['set-cookie'].split(/,(?=[^;]+=)/) : [];
  for (const cookie of setCookies) {
    const name = cookie.split('=', 1)[0].trim() || 'unnamed';
    if (!/;\s*secure(?:;|$)/i.test(cookie)) addFinding(report, 'medium', 'COOKIE-NOT-SECURE', `Cookie ${name} is missing the Secure attribute.`);
    if (!/;\s*httponly(?:;|$)/i.test(cookie)) addFinding(report, 'low', 'COOKIE-NOT-HTTPONLY', `Cookie ${name} is missing the HttpOnly attribute.`);
    if (!/;\s*samesite=/i.test(cookie)) addFinding(report, 'low', 'COOKIE-NO-SAMESITE', `Cookie ${name} is missing SameSite.`);
  }
};

const checkSourceMaps = async (report, target, html) => {
  const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+\.js(?:\?[^"']*)?)["']/gi)]
    .map((match) => match[1])
    .filter(Boolean)
    .slice(0, 6);

  for (const script of scripts) {
    const scriptUrl = new URL(script, target);
    if (scriptUrl.origin !== new URL(target).origin) continue;
    const mapUrl = `${scriptUrl.href}.map`;
    try {
      const mapResult = await request(mapUrl);
      if (mapResult.status === 200 && /(?:application\/json|text\/plain)/i.test(mapResult.headers['content-type'] || '') && /"sources"\s*:|"version"\s*:/i.test(mapResult.body.text)) {
        addFinding(report, 'medium', 'SOURCE-MAP-PUBLIC', 'A JavaScript source map is publicly reachable.', mapUrl);
      }
    } catch {
      // A missing source map is the expected result and needs no report entry.
    }
  }
};

const checkExposedPaths = async (report, target) => {
  for (const path of SENSITIVE_PATHS) {
    const url = new URL(path, target).href;
    try {
      const result = await request(url);
      if (result.status !== 200 || looksLikeSpaFallback(result)) continue;

      if (path === '/.env' && /(SUPABASE|VITE_|API_KEY|SECRET|PASSWORD)\s*=/i.test(result.body.text)) {
        addFinding(report, 'critical', 'ENV-EXPOSED', 'A public .env response appears to contain secrets.', url);
      } else if (path === '/.git/HEAD' && /(?:ref:\s*refs\/|gitdir:)/i.test(result.body.text)) {
        addFinding(report, 'high', 'GIT-EXPOSED', 'The .git metadata endpoint is publicly reachable.', url);
      } else if (path === '/package.json' && /application\/json/i.test(result.headers['content-type'] || '')) {
        addFinding(report, 'low', 'PACKAGE-MANIFEST-PUBLIC', 'package.json is publicly reachable.', url);
      } else {
        addFinding(report, 'medium', 'PUBLIC-SENSITIVE-PATH', `${path} returned a non-SPA 200 response.`, url);
      }
    } catch {
      // Network failures for individual optional paths are not findings.
    }
  }
};

const auditTarget = async (target) => {
  const report = { target, checkedAt: new Date().toISOString(), findings: [], checks: [] };
  const secureUrl = `${target}/`;

  try {
    const result = await request(secureUrl);
    report.checks.push({ name: 'HTTPS response', status: result.status, contentType: result.headers['content-type'] || 'unknown' });
    if (result.status >= 500) addFinding(report, 'high', 'SERVER-ERROR', 'The public site returned a server error.', `${result.status} ${secureUrl}`);
    if (result.status >= 400 && result.status < 500) addFinding(report, 'medium', 'PUBLIC-HTTP-ERROR', 'The public site returned a client error.', `${result.status} ${secureUrl}`);
    checkSecurityHeaders(report, result);
    await checkSourceMaps(report, target, result.body.text);
  } catch (error) {
    addFinding(report, 'high', 'TARGET-UNREACHABLE', 'The target could not be reached.', error.message);
    return report;
  }

  try {
    const httpUrl = target.replace(/^https:/, 'http:') + '/';
    const redirect = await request(httpUrl, { redirect: 'manual' });
    const location = redirect.headers.location || '';
    report.checks.push({ name: 'HTTP to HTTPS redirect', status: redirect.status, location: location || null });
    if (![301, 302, 307, 308].includes(redirect.status) || !location.startsWith('https://')) {
      addFinding(report, 'medium', 'HTTPS-REDIRECT-MISSING', 'HTTP does not clearly redirect to HTTPS.', `${redirect.status} ${location || '(no Location header)'}`);
    }
  } catch (error) {
    addFinding(report, 'low', 'HTTP-CHECK-FAILED', 'The HTTP redirect check could not be completed.', error.message);
  }

  await checkExposedPaths(report, target);
  report.findings.sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity]);
  return report;
};

const printReport = (report) => {
  console.log(`\n${report.target}`);
  console.log(`Checked: ${report.checkedAt}`);
  for (const check of report.checks) console.log(`  ✓ ${check.name}: ${check.status}`);
  if (!report.findings.length) {
    console.log('  ✓ No findings in the low-impact audit.');
    return;
  }
  for (const finding of report.findings) {
    const suffix = finding.evidence ? ` — ${finding.evidence}` : '';
    console.log(`  [${finding.severity.toUpperCase()}] ${finding.code}: ${finding.message}${suffix}`);
  }
};

try {
  const { targets, json } = parseArgs();
  const normalizedTargets = [...new Set(targets.map(normalizeTarget))];
  const reports = [];
  for (const target of normalizedTargets) reports.push(await auditTarget(target));

  if (json) console.log(JSON.stringify({ generatedAt: new Date().toISOString(), reports }, null, 2));
  else reports.forEach(printReport);

  const blocking = reports.some((report) => report.findings.some((finding) => ['critical', 'high'].includes(finding.severity)));
  process.exitCode = blocking ? 1 : 0;
} catch (error) {
  console.error(`Security audit could not run: ${error.message}`);
  console.error(usage());
  process.exitCode = 2;
}
