import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

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
  const reports = await files(process.argv[2] ?? 'sarif-results');
  if (!reports.length) throw new Error();
  let findings = 0;
  for (const file of reports) {
    const sarif = JSON.parse(await readFile(file, 'utf8'));
    if (sarif.version !== '2.1.0' || !Array.isArray(sarif.runs) || !sarif.runs.length) throw new Error();
    for (const run of sarif.runs) {
      if (!Array.isArray(run.results)) throw new Error();
      findings += run.results.length;
    }
  }
  console.log(`Code scanning reports: ${reports.length}; findings: ${findings}.`);
  if (findings) process.exitCode = 1;
} catch {
  console.error('Code scanning report is missing or invalid.');
  process.exitCode = 1;
}
