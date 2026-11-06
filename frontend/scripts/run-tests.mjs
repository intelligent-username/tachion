import { spawn } from 'node:child_process';

const tasks = [
  { name: 'frontend', args: ['run', 'test:unit'] },
  { name: 'backend', args: ['run', 'test:py'] },
];

const procs = tasks.map(({ name, args }) =>
  spawn('npm', args, { stdio: 'inherit', shell: process.platform === 'win32' })
);

const shutdown = () => procs.forEach((p) => p.kill());
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const results = await Promise.all(
  procs.map(
    (p) =>
      new Promise((resolve) => {
        p.on('close', (code) => resolve(code === 0));
      })
  )
);

if (results.some((ok) => !ok)) process.exit(1);
process.exit(0);
