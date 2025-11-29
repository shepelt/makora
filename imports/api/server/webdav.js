import { Meteor } from 'meteor/meteor';
import { UserSettings } from '../collections';

// Check if user is authenticated (or auth is disabled for testing)
function requireAuth() {
  const authDisabled = Meteor.settings?.public?.disableAuth === true;

  if (authDisabled) {
    // Return synthetic test user in test mode
    return {
      _id: 'test-user-id',
      emails: [{ address: 'test@example.com', verified: true }],
    };
  }

  const userId = Meteor.userId();
  if (!userId) {
    throw new Meteor.Error('not-authorized', 'You must be logged in');
  }

  return Meteor.user();
}

// Get WebDAV config for current user
async function getConfig() {
  const authDisabled = Meteor.settings?.public?.disableAuth === true;
  const userId = authDisabled ? 'test-user-id' : Meteor.userId();

  if (!userId) {
    throw new Meteor.Error('not-authorized', 'You must be logged in');
  }

  let url, username, password;

  // Try per-user settings first
  const userSettings = await UserSettings.findOneAsync({ userId });
  if (userSettings?.webdav) {
    url = userSettings.webdav.url;
    username = userSettings.webdav.username;
    password = userSettings.webdav.password;
  } else if (authDisabled) {
    // Fall back to global settings in test mode only
    const settings = Meteor.settings?.webdav || {};
    url = settings.url;
    username = settings.username;
    password = settings.password;
  }

  if (!url || !username || !password) {
    throw new Meteor.Error('webdav-not-configured', 'Please configure your WebDAV settings');
  }

  // Extract the path prefix from the URL (e.g., /remote.php/dav/files/user)
  const urlObj = new URL(url);
  const basePath = urlObj.pathname.replace(/\/$/, '');

  return {
    baseUrl: url.replace(/\/$/, ''),
    basePath,
    auth: 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64'),
  };
}

function parseWebDAVResponse(xml, basePath) {
  const items = [];
  const responseRegex = /<d:response>([\s\S]*?)<\/d:response>/gi;
  let match;

  while ((match = responseRegex.exec(xml)) !== null) {
    const response = match[1];

    const hrefMatch = /<d:href>([^<]+)<\/d:href>/i.exec(response);
    let href = hrefMatch ? decodeURIComponent(hrefMatch[1]) : '';

    // Handle full URLs in href (some WebDAV servers return full URLs)
    if (href.startsWith('http://') || href.startsWith('https://')) {
      try {
        const url = new URL(href);
        href = url.pathname;
      } catch (e) {
        // If URL parsing fails, keep the original
      }
    }

    // Normalize path: remove basePath prefix to get relative path
    if (basePath && href.startsWith(basePath)) {
      href = href.slice(basePath.length) || '/';
    }
    // Remove trailing slash for directories (except root)
    if (href !== '/' && href.endsWith('/')) {
      href = href.slice(0, -1);
    }

    const isDirectory = /<d:collection\s*\/>/i.test(response) || /<d:collection>/i.test(response);

    const sizeMatch = /<d:getcontentlength>(\d+)<\/d:getcontentlength>/i.exec(response);
    const size = sizeMatch ? parseInt(sizeMatch[1], 10) : 0;

    const lastmodMatch = /<d:getlastmodified>([^<]+)<\/d:getlastmodified>/i.exec(response);
    const lastmod = lastmodMatch ? lastmodMatch[1] : null;

    const parts = href.split('/').filter(Boolean);
    const basename = parts[parts.length - 1] || '';

    items.push({
      filename: href,
      basename,
      type: isDirectory ? 'directory' : 'file',
      size,
      lastmod,
    });
  }

  return items;
}

Meteor.methods({
  // Get current user's WebDAV settings (without password)
  async 'settings.getWebdav'() {
    const authDisabled = Meteor.settings?.public?.disableAuth === true;
    const userId = authDisabled ? 'test-user-id' : Meteor.userId();

    if (!userId) {
      throw new Meteor.Error('not-authorized', 'You must be logged in');
    }

    const userSettings = await UserSettings.findOneAsync({ userId });
    if (!userSettings?.webdav) {
      return null;
    }

    // Return settings without password
    return {
      url: userSettings.webdav.url,
      username: userSettings.webdav.username,
      basePath: userSettings.webdav.basePath || '/',
      hasPassword: !!userSettings.webdav.password,
    };
  },

  // Save user's WebDAV settings
  async 'settings.saveWebdav'({ url, username, password, basePath = '/' }) {
    const authDisabled = Meteor.settings?.public?.disableAuth === true;
    const userId = authDisabled ? 'test-user-id' : Meteor.userId();

    if (!userId) {
      throw new Meteor.Error('not-authorized', 'You must be logged in');
    }

    if (!url || !username) {
      throw new Meteor.Error('invalid-settings', 'URL and username are required');
    }

    // Use stored password if none provided
    let savePassword = password;
    if (!savePassword) {
      const settings = await UserSettings.findOneAsync({ userId });
      savePassword = settings?.webdav?.password;
    }

    if (!savePassword) {
      throw new Meteor.Error('invalid-settings', 'Password is required');
    }

    // Validate URL format
    try {
      new URL(url);
    } catch (e) {
      throw new Meteor.Error('invalid-url', 'Please enter a valid WebDAV URL');
    }

    await UserSettings.upsertAsync(
      { userId },
      {
        $set: {
          userId,
          webdav: { url, username, password: savePassword, basePath },
          updatedAt: new Date(),
        },
        $setOnInsert: {
          createdAt: new Date(),
        },
      }
    );

    return { success: true };
  },

  // Test WebDAV connection
  async 'settings.testWebdav'({ url, username, password }) {
    const authDisabled = Meteor.settings?.public?.disableAuth === true;
    const userId = authDisabled ? 'test-user-id' : Meteor.userId();

    if (!userId) {
      throw new Meteor.Error('not-authorized', 'You must be logged in');
    }

    // Use stored password if none provided
    let testPassword = password;
    if (!testPassword) {
      const settings = await UserSettings.findOneAsync({ userId });
      testPassword = settings?.webdav?.password;
    }

    if (!testPassword) {
      throw new Meteor.Error('no-password', 'Password is required');
    }

    const auth = 'Basic ' + Buffer.from(`${username}:${testPassword}`).toString('base64');

    try {
      const response = await fetch(url, {
        method: 'PROPFIND',
        headers: {
          'Authorization': auth,
          'Depth': '0',
        },
      });

      if (response.status === 401) {
        throw new Meteor.Error('auth-failed', 'Authentication failed. Check username and password.');
      }

      if (!response.ok) {
        throw new Meteor.Error('connection-failed', `Server returned ${response.status}: ${response.statusText}`);
      }

      return { success: true };
    } catch (err) {
      if (err instanceof Meteor.Error) throw err;
      throw new Meteor.Error('connection-failed', err.message);
    }
  },

  // List directories for settings directory picker (uses provided credentials, not stored)
  async 'settings.listDirectories'({ url, username, password, path = '/' }) {
    const authDisabled = Meteor.settings?.public?.disableAuth === true;
    const userId = authDisabled ? 'test-user-id' : Meteor.userId();

    if (!userId) {
      throw new Meteor.Error('not-authorized', 'You must be logged in');
    }

    // Use stored password if none provided
    let testPassword = password;
    if (!testPassword) {
      const settings = await UserSettings.findOneAsync({ userId });
      testPassword = settings?.webdav?.password;
    }

    if (!testPassword) {
      throw new Meteor.Error('no-password', 'Password is required');
    }

    const auth = 'Basic ' + Buffer.from(`${username}:${testPassword}`).toString('base64');
    const baseUrl = url.replace(/\/$/, '');
    const fullUrl = baseUrl + (path === '/' ? '' : path);

    // Extract the base path from URL for normalizing hrefs
    const urlObj = new URL(baseUrl);
    const serverBasePath = urlObj.pathname.replace(/\/$/, '');

    try {
      const response = await fetch(fullUrl, {
        method: 'PROPFIND',
        headers: {
          'Authorization': auth,
          'Depth': '1',
          'Content-Type': 'application/xml',
        },
        body: `<?xml version="1.0" encoding="utf-8"?>
          <d:propfind xmlns:d="DAV:">
            <d:prop><d:resourcetype/></d:prop>
          </d:propfind>`,
      });

      if (!response.ok) {
        throw new Meteor.Error('list-failed', `Server returned ${response.status}`);
      }

      const xml = await response.text();
      // Use same parsing as parseWebDAVResponse
      const directories = [];
      const responseRegex = /<d:response>([\s\S]*?)<\/d:response>/gi;
      let match;

      while ((match = responseRegex.exec(xml)) !== null) {
        const responseBlock = match[1];
        const isDirectory = /<d:collection\s*\/>/i.test(responseBlock) || /<d:collection>/i.test(responseBlock);

        if (!isDirectory) continue;

        const hrefMatch = /<d:href>([^<]+)<\/d:href>/i.exec(responseBlock);
        if (!hrefMatch) continue;

        let href = decodeURIComponent(hrefMatch[1]);
        // Handle full URLs
        if (href.startsWith('http://') || href.startsWith('https://')) {
          try { href = new URL(href).pathname; } catch (e) {}
        }

        // Remove server base path to get relative path
        if (serverBasePath && href.startsWith(serverBasePath)) {
          href = href.slice(serverBasePath.length) || '/';
        }
        // Remove trailing slash
        if (href !== '/' && href.endsWith('/')) {
          href = href.slice(0, -1);
        }

        // Skip current directory (requested path)
        const normalizedPath = path === '/' ? '' : path.replace(/\/$/, '');
        if (href === normalizedPath || href === '/') continue;

        // Check if it's a direct child of the current path
        const expectedPrefix = normalizedPath === '' ? '/' : normalizedPath + '/';
        if (href.startsWith(expectedPrefix) || (normalizedPath === '' && href.startsWith('/'))) {
          const relativePath = normalizedPath === '' ? href : href.slice(normalizedPath.length);
          const parts = relativePath.split('/').filter(Boolean);
          // Only direct children (one level deep)
          if (parts.length === 1) {
            directories.push(parts[0]);
          }
        }
      }

      return { directories: directories.sort() };
    } catch (err) {
      if (err instanceof Meteor.Error) throw err;
      throw new Meteor.Error('list-failed', err.message);
    }
  },

  async 'webdav.list'(path = '/') {
    requireAuth();
    const { baseUrl, basePath, auth } = await getConfig();
    const url = baseUrl + (path.startsWith('/') ? path : '/' + path);

    try {
      const response = await fetch(url, {
        method: 'PROPFIND',
        headers: {
          'Authorization': auth,
          'Depth': '1',
          'Content-Type': 'application/xml',
        },
        body: `<?xml version="1.0" encoding="utf-8"?>
          <d:propfind xmlns:d="DAV:">
            <d:prop>
              <d:resourcetype/>
              <d:getcontentlength/>
              <d:getlastmodified/>
            </d:prop>
          </d:propfind>`,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const xml = await response.text();
      const items = parseWebDAVResponse(xml, basePath);

      // Remove first item (current directory) and return rest
      return items.slice(1);
    } catch (err) {
      throw new Meteor.Error('webdav-error', err.message);
    }
  },

  async 'webdav.read'(path) {
    requireAuth();
    const { baseUrl, auth } = await getConfig();
    const url = baseUrl + (path.startsWith('/') ? path : '/' + path);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Authorization': auth },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.text();
    } catch (err) {
      throw new Meteor.Error('webdav-error', err.message);
    }
  },

  async 'webdav.write'(path, content) {
    requireAuth();
    const { baseUrl, auth } = await getConfig();
    const url = baseUrl + (path.startsWith('/') ? path : '/' + path);

    try {
      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Authorization': auth,
          'Content-Type': 'text/plain; charset=utf-8',
        },
        body: content,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return { success: true };
    } catch (err) {
      throw new Meteor.Error('webdav-error', err.message);
    }
  },
});
