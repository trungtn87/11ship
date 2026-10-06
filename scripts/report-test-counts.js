'use strict';

// CI helper: reads a Jest --json result file and publishes the counts as GitHub annotations
// (visible without downloading the job log). Optionally enforces expectations:
//   --max-pending N            fail when more than N tests were skipped
//   --expect "text=status"     fail unless a test whose full name contains `text` has that status
//                              (passed | pending | failed)
// Usage: node scripts/report-test-counts.js <label> <jest-json> [options]
const { readFileSync, existsSync } = require('node:fs');

const [label, file, ...rest] = process.argv.slice(2);
if (!label || !file) {
  console.error('usage: report-test-counts.js <label> <jest-json> [--max-pending N] [--expect "text=status"]');
  process.exit(2);
}
let logFile = '';
for (let i = 0; i < rest.length; i += 1) {
  if (rest[i] === '--log') logFile = rest[i + 1];
}
if (!existsSync(file)) {
  // Jest produced no result file: surface the tail of its output so the cause is readable.
  let tail = '';
  if (logFile && existsSync(logFile)) {
    tail = readFileSync(logFile, 'utf8').split('\n').slice(-25).join('%0A').slice(0, 3000);
  }
  console.log(`::error title=${label}::result file ${file} not found%0A${tail}`);
  process.exit(1);
}

let maxPending = Infinity;
const expectations = [];
for (let i = 0; i < rest.length; i += 1) {
  if (rest[i] === '--max-pending') {
    maxPending = Number(rest[(i += 1)]);
  } else if (rest[i] === '--log') {
    i += 1;
  } else if (rest[i] === '--expect') {
    const [text, status] = String(rest[(i += 1)]).split('=');
    expectations.push({ text, status });
  }
}

const report = JSON.parse(readFileSync(file, 'utf8'));
const tests = report.testResults.flatMap((suite) => suite.assertionResults);
console.log(
  `::notice title=${label}::suites=${report.numTotalTestSuites} (passed ${report.numPassedTestSuites}); ` +
    `tests total=${report.numTotalTests} passed=${report.numPassedTests} ` +
    `pending=${report.numPendingTests} failed=${report.numFailedTests}`,
);

let ok = report.success === true && report.numFailedTests === 0;
for (const test of tests.filter((t) => t.status === 'failed')) {
  const message = String((test.failureMessages || [''])[0]).replace(/\s+/g, ' ').slice(0, 300);
  console.log(`::error title=${label} failed::${test.fullName} — ${message}`);
}
if (report.numPendingTests > maxPending) {
  console.log(`::error title=${label}::${report.numPendingTests} pending tests, at most ${maxPending} allowed`);
  ok = false;
}
for (const { text, status } of expectations) {
  const found = tests.filter((t) => t.fullName.includes(text));
  const good = found.length === 1 && found[0].status === status;
  console.log(
    `::notice title=${label} expectation::"${text}" -> ${found.map((t) => t.status).join(',') || 'not found'} (want ${status})`,
  );
  if (!good) {
    console.log(`::error title=${label}::expected exactly one test "${text}" with status ${status}`);
    ok = false;
  }
}
process.exit(ok ? 0 : 1);
