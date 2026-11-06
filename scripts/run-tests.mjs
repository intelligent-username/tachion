import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

const root = new URL('../', import.meta.url);
const isWindows = process.platform === 'win32';
const npm = isWindows ? 'npm.cmd' : 'npm';
const suites = {
  frontend: {
    command: npm,
    args: ['--prefix', 'frontend', 'run', 'test:unit'],
  },
  backend: {
    command: 'docker',
    args: [
      'compose', '--profile', 'dev', 'run', '--build', '--rm', '-T', 'backend-dev',
      '/app/.venv/bin/python', '-m', 'pytest', '/app/test', '-q',
    ],
  },
  lint: {
    command: npm,
    args: ['--prefix', 'frontend', 'run', 'lint'],
  },
};

const options = new Set(process.argv.slice(2));
const verbose = options.has('v') || options.has('--verbose');
const fix = options.has('fix');
const selected = [...options].find((option) => Object.hasOwn(suites, option))
  ?? (options.has('--frontend') ? 'frontend' : options.has('--backend') ? 'backend' : options.has('--lint') ? 'lint' : undefined);
const names = selected ? [selected] : ['frontend', 'backend'];
if (names.some((name) => !Object.hasOwn(suites, name)) || [...options].some((option) => !['frontend', 'backend', 'lint', '--frontend', '--backend', '--lint', 'v', '--verbose', 'fix'].includes(option))) {
  process.stderr.write('Usage: node scripts/run-tests.mjs [--frontend|--backend|--lint] [v] [fix]\n');
  process.exit(2);
}

const children = new Set();
let interrupted = false;
const onInterrupt = () => {
  interrupted = true;
  for (const child of children) child.kill('SIGTERM');
};
process.on('SIGINT', onInterrupt);
process.on('SIGTERM', onInterrupt);

function runSuite(name) {
  const { command } = suites[name];
  const args = name === 'lint' && fix
    ? ['--prefix', 'frontend', 'run', 'lint:fix']
    : suites[name].args;
  const child = isWindows && command === 'npm.cmd'
    ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd', ...args], { cwd: root, windowsVerbatimArguments: true })
    : spawn(command, args, { cwd: root, shell: false });
  children.add(child);
  let output = '';
  let pending = '';
  const decoder = new StringDecoder('utf8');
  const emit = (chunk, flush = false) => {
    const text = (flush ? decoder.end() : decoder.write(chunk)).replace(/\r\n?/g, '\n');
    const lines = `${pending}${text}`.split('\n');
    pending = flush ? '' : lines.pop();
    const complete = lines.join('\n') + (lines.length ? '\n' : '');
    if (complete) {
      output += complete;
      if (verbose) process.stdout.write(complete);
    }
    if (flush && pending) {
      output += `${pending}\n`;
      if (verbose) process.stdout.write(`${pending}\n`);
      pending = '';
    }
  };
  child.stdout?.on('data', emit);
  child.stderr?.on('data', emit);

  return new Promise((resolve) => {
    let settled = false;
    child.once('error', (error) => {
      settled = true;
      output += `launch failed: ${error.message}\n`;
      if (verbose) process.stdout.write(`launch failed: ${error.message}\n`);
      children.delete(child);
      resolve({ name, status: 1, output });
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      emit(Buffer.alloc(0), true);
      children.delete(child);
      resolve({ name, status: interrupted ? 1 : (code ?? 1), output });
    });
  });
}

function testCounts(output) {
  const vitest = [...output.matchAll(/Tests\s+((?:\d+\s+(?:passed|failed|skipped|todo)\s*)+)\((\d+)\)/gi)].at(-1);
  if (vitest) {
    const matches = [...vitest[1].matchAll(/(\d+)\s+(passed|failed|skipped|todo)/gi)];
    return {
      passed: matches.reduce((sum, [, count, kind]) => sum + (kind.toLowerCase() === 'passed' ? Number(count) : 0), 0),
      total: Number(vitest[2]),
    };
  }
  const pytest = [...output.matchAll(/(?:^|\n)([\d\w, ]+) in [\d.]+s\s*$/gm)].at(-1)?.[1];
  if (pytest) {
    const counts = [...pytest.matchAll(/(\d+)\s+(passed|failed|error|skipped|xfailed|xpassed)/gi)];
    if (counts.length) {
      const total = counts.reduce((sum, [, count]) => sum + Number(count), 0);
      const passed = counts.reduce((sum, [, count, kind]) => sum + (kind.toLowerCase() === 'passed' ? Number(count) : 0), 0);
      return { passed, total };
    }
  }
  return undefined;
}

const isTty = process.stderr.isTTY && !verbose;
if (!isTty) process.stderr.write(`Running ${names.join(' + ')}…\n`);
const frames = ['▰' + '▱'.repeat(15), '▱' + '▰' + '▱'.repeat(14), '▱'.repeat(2) + '▰' + '▱'.repeat(13)];
let frame = 0;
const animation = isTty ? setInterval(() => {
  process.stderr.write(`\r${names.join(' + ')}  ${frames[frame++ % frames.length]}`);
}, 140) : undefined;
const results = await Promise.all(names.map(runSuite));
if (animation) {
  clearInterval(animation);
  process.stderr.write('\r\x1b[2K');
}

if (selected === 'lint') {
  const clean = results.every(({ status }) => status === 0);
  process.stdout.write(`Lint checks: ${clean ? '100% [1/1 passed]' : '0% [0/1 passed]'}\n`);
} else {
  const counts = results.map((result) => testCounts(result.output) ?? {
    passed: result.status === 0 ? 1 : 0,
    total: 1,
  });
  const passed = counts.reduce((sum, count) => sum + count.passed, 0);
  const total = counts.reduce((sum, count) => sum + count.total, 0);
  const percentage = total ? (passed / total) * 100 : 0;
  process.stdout.write(`Tests: ${percentage.toFixed(1)}% [${passed}/${total} passed]\n`);
}

process.exitCode = results.some(({ status }) => status !== 0) ? 1 : 0;
