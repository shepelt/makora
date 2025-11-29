import { Meteor } from 'meteor/meteor';

function getConfig() {
  const settings = Meteor.settings?.webdav || {};
  const url = settings.url;
  const username = settings.username;
  const password = settings.password;

  if (!url || !username || !password) {
    throw new Meteor.Error('webdav-config', 'WebDAV not configured. Check settings.json.');
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
  async 'webdav.list'(path = '/') {
    const { baseUrl, basePath, auth } = getConfig();
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
    const { baseUrl, auth } = getConfig();
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
    const { baseUrl, auth } = getConfig();
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
