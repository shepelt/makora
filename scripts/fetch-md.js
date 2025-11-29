const { chromium } = require('playwright');
const { spawn } = require('child_process');
const { readFileSync, writeFileSync, unlinkSync, existsSync } = require('fs');

const METEOR_PORT = 4020;
const SETTINGS_FILE = 'settings-fetch.json';
const PID_FILE = '.meteor-fetch-pid';

async function waitForService(url, timeout) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 401) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

async function startMeteor() {
  let baseSettings = {};
  if (existsSync('settings-local.json')) {
    baseSettings = JSON.parse(readFileSync('settings-local.json', 'utf8'));
  }

  const fetchSettings = {
    ...baseSettings,
    public: {
      ...baseSettings.public,
      disableAuth: true
    }
  };
  writeFileSync(SETTINGS_FILE, JSON.stringify(fetchSettings, null, 2));

  console.log(`Starting Meteor on port ${METEOR_PORT}...`);
  const proc = spawn('meteor', ['run', '--settings', SETTINGS_FILE, '--port', String(METEOR_PORT)], {
    stdio: 'inherit',
    detached: true
  });
  writeFileSync(PID_FILE, String(proc.pid));

  const ready = await waitForService(`http://localhost:${METEOR_PORT}`, 120000);
  if (!ready) {
    throw new Error('Meteor did not start in time');
  }
  console.log('Meteor ready');
  await new Promise(r => setTimeout(r, 2000));

  return proc;
}

function stopMeteor() {
  if (existsSync(PID_FILE)) {
    const pid = parseInt(readFileSync(PID_FILE, 'utf8'));
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {}
    unlinkSync(PID_FILE);
  }
  if (existsSync(SETTINGS_FILE)) {
    unlinkSync(SETTINGS_FILE);
  }
}

async function callMeteorMethod(page, method, ...args) {
  return page.evaluate(async ({ method, args }) => {
    return new Promise((resolve, reject) => {
      Meteor.call(method, ...args, (err, result) => {
        if (err) reject(new Error(err.reason || err.message));
        else resolve(result);
      });
    });
  }, { method, args });
}

async function fetchMarkdown(filePath, email) {
  console.log(`Fetching: ${filePath}`);

  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto(`http://localhost:${METEOR_PORT}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Load user's WebDAV settings
  console.log(`Loading WebDAV settings for: ${email}`);
  try {
    const result = await callMeteorMethod(page, 'debug.useSettingsFromEmail', email);
    console.log(`WebDAV URL: ${result.url}`);
  } catch (err) {
    console.error(`Failed to load settings: ${err.message}`);
    await browser.close();
    throw err;
  }

  // Fetch file content via Meteor method (uses per-user WebDAV config)
  console.log(`Fetching via webdav.read...`);
  const content = await callMeteorMethod(page, 'webdav.read', filePath);

  await browser.close();
  return content;
}

function printUsage() {
  console.log(`
Usage: npm run fetch-md -- <FILE_PATH> --email=EMAIL [--output=FILE]

Arguments:
  FILE_PATH      Path to the markdown file on WebDAV (e.g., /Notes/Misc/test.md)
  --email=EMAIL  Email of user whose WebDAV settings to use
  --output=FILE  Optional: save to file instead of printing to console

Examples:
  npm run fetch-md -- /Notes/Misc/test.md --email=user@example.com
  npm run fetch-md -- /Notes/Misc/test.md --email=user@example.com --output=test.md
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    printUsage();
    return;
  }

  const filePath = args.find(a => !a.startsWith('--'));
  const emailArg = args.find(a => a.startsWith('--email='));
  const outputArg = args.find(a => a.startsWith('--output='));

  if (!filePath) {
    console.error('Error: FILE_PATH is required');
    printUsage();
    process.exit(1);
  }

  if (!emailArg) {
    console.error('Error: --email is required');
    printUsage();
    process.exit(1);
  }

  const email = emailArg.split('=')[1];
  const outputFile = outputArg?.split('=')[1];

  await startMeteor();

  try {
    const content = await fetchMarkdown(filePath, email);

    if (outputFile) {
      writeFileSync(outputFile, content);
      console.log(`\nSaved to: ${outputFile}`);
    } else {
      console.log('\n--- Markdown Content ---\n');
      console.log(content);
      console.log('\n--- End ---');
    }
  } finally {
    console.log('Stopping Meteor...');
    stopMeteor();
  }
}

main().catch(err => {
  console.error(err);
  stopMeteor();
  process.exit(1);
});
