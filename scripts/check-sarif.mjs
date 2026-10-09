import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

function locationFile(run, location) {
  const artifact = location?.artifactLocation;
  if (!artifact?.uri) return undefined;
  try {
    const base = run.originalUriBaseIds?.[artifact.uriBaseId]?.uri ?? pathToFileURL(path.resolve('.') + path.sep).href;
    return path.resolve(fileURLToPath(new URL(artifact.uri, base)));
  } catch { return undefined; }
}

async function files(folder) {
  const result = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) result.push(...await files(file));
    else if (entry.name.endsWith('.sarif')) result.push(file);
  }
  return result;
}
try {
  const reviewed = JSON.parse(await readFile('.github/codeql-reviewed.json', 'utf8'));
  if (reviewed.version !== 1 || !Array.isArray(reviewed.findings)) throw new Error();
  for (const entry of reviewed.findings) {
    if (!/^src\/[a-z-]+\.ts$/.test(entry.file) || !/^[a-f0-9]{64}$/.test(entry.sha256NormalizedLf) || !entry.reason || !Number.isInteger(entry.startLine)) throw new Error();
    const source = (await readFile(entry.file, 'utf8')).replace(/\r\n/g, '\n');
    if (createHash('sha256').update(source).digest('hex') !== entry.sha256NormalizedLf) throw new Error();
  }
  const reports = await files(process.argv[2] ?? 'sarif-results');
  if (!reports.length) throw new Error();
  let findings = 0;
  let accepted = 0;
  for (const file of reports) {
    const sarif = JSON.parse(await readFile(file, 'utf8'));
    if (sarif.version !== '2.1.0' || !Array.isArray(sarif.runs) || !sarif.runs.length) throw new Error();
    for (const run of sarif.runs) {
      if (!Array.isArray(run.results)) throw new Error();
      findings += run.results.length;
      for (const result of run.results) {
        const locations = result.locations;
        if (locations?.length !== 1) continue;
        const location = locations[0]?.physicalLocation;
        if (reviewed.findings.some(entry => entry.ruleId === result.ruleId && locationFile(run, location) === path.resolve(entry.file) && location?.region?.startLine === entry.startLine && (location?.region?.endLine ?? location?.region?.startLine) === entry.startLine)) accepted++;
      }
    }
  }
  console.log(`Code scanning reports: ${reports.length}; reported: ${findings}; reviewed: ${accepted}; unreviewed: ${findings - accepted}.`);
  if (findings !== accepted) process.exitCode = 1;
} catch {
  console.error('Code scanning report is missing or invalid.');
  process.exitCode = 1;
}
