const { chromium } = require('playwright');
const { spawn } = require('child_process');
const { readFileSync, writeFileSync, unlinkSync, existsSync } = require('fs');

const METEOR_PORT = 4020;
const SETTINGS_FILE = 'settings-screenshot.json';
const PID_FILE = '.meteor-screenshot-pid';

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
  // Read existing settings and add disableAuth
  let baseSettings = {};
  if (existsSync('settings-local.json')) {
    baseSettings = JSON.parse(readFileSync('settings-local.json', 'utf8'));
  }

  const screenshotSettings = {
    ...baseSettings,
    public: {
      ...baseSettings.public,
      disableAuth: true
    }
  };
  writeFileSync(SETTINGS_FILE, JSON.stringify(screenshotSettings, null, 2));

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

  // Extra wait for stability
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

async function capture(url, output, options = {}) {
  console.log(`Capturing: ${url}`);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });


  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // If email provided, copy that user's settings to test-user-id
  if (options.email) {
    console.log(`Loading WebDAV settings for: ${options.email}`);
    try {
      const result = await callMeteorMethod(page, 'debug.useSettingsFromEmail', options.email);
      console.log(`Using WebDAV: ${result.url}`);
      // Reload the page to use new settings
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(3000);
    } catch (err) {
      console.error(`Failed to load settings: ${err.message}`);
      await browser.close();
      throw err;
    }
  }

  // Wait for editor content to load
  await page.waitForTimeout(2000);

  // If search text provided, scroll to find it
  if (options.search) {
    console.log(`Searching for: "${options.search}"`);
    const found = await page.evaluate(async (searchText) => {
      const editor = document.querySelector('.ProseMirror');
      if (!editor) return false;

      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        if (walker.currentNode.textContent.includes(searchText)) {
          walker.currentNode.parentElement.scrollIntoView({ block: 'center' });
          return true;
        }
      }
      return false;
    }, options.search);

    if (found) {
      console.log('Found and scrolled to text');
      await page.waitForTimeout(500);
    } else {
      console.log('Text not found');
    }
  }

  // If scrollY provided, scroll to that position
  if (options.scrollY !== undefined) {
    console.log(`Scrolling to Y=${options.scrollY}`);
    await page.evaluate((y) => {
      const container = document.querySelector('.ProseMirror')?.parentElement;
      if (container) container.scrollTo(0, y);
    }, options.scrollY);
    await page.waitForTimeout(500);
  }

  // Take screenshot(s)
  if (options.fullPage) {
    await page.screenshot({ path: output, fullPage: true });
    console.log(`Saved full page to: ${output}`);
  } else if (options.multi) {
    // Take multiple screenshots scrolling down
    const totalHeight = await page.evaluate(() => {
      const editor = document.querySelector('.ProseMirror');
      return editor ? editor.scrollHeight : document.body.scrollHeight;
    });

    const viewportHeight = 900;
    let scrollY = 0;
    let index = 0;

    while (scrollY < totalHeight) {
      await page.evaluate((y) => {
        const container = document.querySelector('.ProseMirror')?.parentElement;
        if (container) container.scrollTo(0, y);
        else window.scrollTo(0, y);
      }, scrollY);
      await page.waitForTimeout(300);

      const outputPath = output.replace(/\.png$/, `-${index}.png`);
      await page.screenshot({ path: outputPath });
      console.log(`Saved: ${outputPath}`);

      scrollY += viewportHeight - 100; // Overlap slightly
      index++;
    }
  } else {
    await page.screenshot({ path: output });
    console.log(`Saved to: ${output}`);
  }

  await browser.close();
}

function printUsage() {
  console.log(`
Usage: npm run screenshot -- [URL] [OUTPUT] [OPTIONS]

Options:
  --email=EMAIL   Load WebDAV settings from user with this email
  --no-server     Don't start Meteor (use existing instance on port ${METEOR_PORT})
  --search=TEXT   Scroll to first occurrence of TEXT
  --scroll=Y      Scroll to Y pixels
  --full          Full page screenshot (may be very long)
  --multi         Take multiple viewport screenshots while scrolling

Examples:
  npm run screenshot -- "http://x/?file=/path/to/file.md" out.png --email=user@example.com
  npm run screenshot -- "http://x/?file=/path/to/file.md" out.png --email=user@example.com --search="요약"
  npm run screenshot -- "http://x/?file=/path/to/file.md" out.png --email=user@example.com --multi
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  const urlArg = args.find(a => !a.startsWith('--'));
  const outputArg = args.filter(a => !a.startsWith('--'))[1] || 'screenshot.png';
  const skipServer = args.includes('--no-server');
  const fullPage = args.includes('--full');
  const multi = args.includes('--multi');
  const emailArg = args.find(a => a.startsWith('--email='));
  const searchArg = args.find(a => a.startsWith('--search='));
  const scrollArg = args.find(a => a.startsWith('--scroll='));

  const options = {
    fullPage,
    multi,
    email: emailArg?.split('=')[1],
    search: searchArg?.split('=')[1],
    scrollY: scrollArg ? parseInt(scrollArg.split('=')[1]) : undefined
  };

  if (!skipServer) {
    await startMeteor();
  }

  try {
    let url = urlArg || `http://localhost:${METEOR_PORT}`;
    if (urlArg) {
      const parsed = new URL(urlArg);
      parsed.host = `localhost:${METEOR_PORT}`;
      url = parsed.toString();
    }

    await capture(url, outputArg, options);
  } finally {
    if (!skipServer) {
      console.log('Stopping Meteor...');
      stopMeteor();
    }
  }
}

main().catch(err => {
  console.error(err);
  stopMeteor();
  process.exit(1);
});
