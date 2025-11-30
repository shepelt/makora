import { Meteor } from 'meteor/meteor';
import { Accounts } from 'meteor/accounts-base';
import { WebApp } from 'meteor/webapp';
import { ServiceConfiguration } from 'meteor/service-configuration';
import '/imports/api/server/webdav.js';
import { UserSettings } from '/imports/api/collections';

// Copy Google profile picture to user.profile on login (so it's available on client)
Accounts.onLogin(async ({ user }) => {
  const googlePicture = user?.services?.google?.picture;
  const currentPicture = user?.profile?.picture;

  if (googlePicture && googlePicture !== currentPicture) {
    await Meteor.users.updateAsync(user._id, {
      $set: { 'profile.picture': googlePicture }
    });
  }
});

// Configure Google OAuth
async function configureGoogleOAuth() {
  const google = Meteor.settings?.google;

  if (!google?.clientId || !google?.secret) {
    console.warn('Google OAuth not configured. Add google.clientId and google.secret to settings.');
    return;
  }

  // Remove existing config and add new one
  await ServiceConfiguration.configurations.upsertAsync(
    { service: 'google' },
    {
      $set: {
        clientId: google.clientId,
        secret: google.secret,
        loginStyle: 'popup',
      },
    }
  );

  console.log('Google OAuth configured');
}

// Helper to get user from request (checks query param and cookies)
async function getUserFromRequest(req) {
  // First check query parameter (more reliable than cookies with Meteor)
  const url = new URL(req.url, 'http://localhost');
  const queryToken = url.searchParams.get('token');

  // Then check cookies as fallback
  const cookies = req.headers.cookie || '';
  const cookieMatch = cookies.match(/meteor_login_token=([^;]+)/);

  const token = queryToken || (cookieMatch ? decodeURIComponent(cookieMatch[1]) : null);

  if (!token) {
    console.log('getUserFromRequest: No token found (query or cookie)');
    return null;
  }

  const hashedToken = Accounts._hashLoginToken(token);
  const user = await Meteor.users.findOneAsync({
    'services.resume.loginTokens.hashedToken': hashedToken
  });

  if (!user) {
    console.log('getUserFromRequest: Token invalid or expired');
  }
  return user;
}

// Unified image proxy for both WebDAV and external resources
WebApp.connectHandlers.use('/image-proxy', async (req, res) => {
  const parsedUrl = new URL(req.url, 'http://localhost');
  let externalUrl = parsedUrl.searchParams.get('url');
  let queryToken = parsedUrl.searchParams.get('token');
  const imagePath = parsedUrl.pathname; // e.g., /path/to/image.png (after /image-proxy)

  const authDisabled = Meteor.settings?.public?.disableAuth === true;

  // Legacy support: handle base64-encoded URLs in path (/ext/<base64>/t/<token>)
  if (imagePath.startsWith('/ext/')) {
    let base64Part = imagePath.slice(5); // Remove '/ext/'
    const tokenMatch = base64Part.match(/^([^/]+)\/t\/(.+)$/);
    if (tokenMatch) {
      base64Part = tokenMatch[1];
      queryToken = tokenMatch[2];
    }
    try {
      externalUrl = Buffer.from(base64Part, 'base64url').toString('utf-8');
    } catch (e) {
      res.writeHead(400);
      res.end('Invalid base64 URL encoding');
      return;
    }
  }

  // Handle external URLs
  if (externalUrl) {
    // Validate URL is http/https
    if (!externalUrl.startsWith('http://') && !externalUrl.startsWith('https://')) {
      res.writeHead(400);
      res.end('Invalid URL scheme');
      return;
    }

    // Require authentication unless auth is disabled
    if (!authDisabled) {
      let user = null;
      // Check query token first
      if (queryToken) {
        const hashedToken = Accounts._hashLoginToken(queryToken);
        user = await Meteor.users.findOneAsync({
          'services.resume.loginTokens.hashedToken': hashedToken
        });
      }
      // Fall back to request token (cookie/query)
      if (!user) {
        user = await getUserFromRequest(req);
      }
      if (!user) {
        res.writeHead(401);
        res.end('Not authenticated');
        return;
      }
    }

    // Fetch external resource
    try {
      const response = await fetch(externalUrl, {
        headers: { 'User-Agent': 'Makora/1.0' },
      });

      if (!response.ok) {
        res.writeHead(response.status);
        res.end(`Error: ${response.statusText}`);
        return;
      }

      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });

      const buffer = await response.arrayBuffer();
      res.end(Buffer.from(buffer));
    } catch (err) {
      console.error('External proxy error:', err);
      res.writeHead(500);
      res.end('Proxy error');
    }
    return;
  }

  // Handle WebDAV paths
  // Skip auth check if auth is disabled (test/screenshot mode)
  if (authDisabled) {
    const testUserSettings = await UserSettings.findOneAsync({ userId: 'test-user-id' });
    if (testUserSettings?.webdav) {
      const { url: webdavUrl, username, password } = testUserSettings.webdav;
      const baseUrl = webdavUrl.replace(/\/$/, '');
      const auth = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
      console.log('Proxy request (auth disabled):', imagePath);
      return proxyRequest(baseUrl + imagePath, auth, res);
    }
    // Fall back to global settings if no test-user settings
    const settings = Meteor.settings?.webdav || {};
    if (settings.url && settings.username && settings.password) {
      const baseUrl = settings.url.replace(/\/$/, '');
      const auth = 'Basic ' + Buffer.from(`${settings.username}:${settings.password}`).toString('base64');
      console.log('Proxy request (auth disabled, global settings):', imagePath);
      return proxyRequest(baseUrl + imagePath, auth, res);
    }
  }

  // Proxy requires authentication
  const user = await getUserFromRequest(req);
  const userId = user?._id;
  console.log('Proxy request:', imagePath, 'userId:', userId);

  if (!userId) {
    console.log('Proxy: Not authenticated, no userId found');
    res.writeHead(401);
    res.end('Not authenticated');
    return;
  }

  // Get per-user WebDAV settings
  const userSettings = await UserSettings.findOneAsync({ userId });
  if (!userSettings?.webdav) {
    res.writeHead(500);
    res.end('WebDAV not configured');
    return;
  }

  const { url: webdavUrl, username, password } = userSettings.webdav;
  const baseUrl = webdavUrl.replace(/\/$/, '');
  const auth = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');

  await proxyRequest(baseUrl + imagePath, auth, res);
});

// Legacy WebDAV proxy (for backwards compatibility)
WebApp.connectHandlers.use('/webdav-proxy', async (req, res) => {
  // Strip query params from path (token is extracted by getUserFromRequest)
  const parsedUrl = new URL(req.url, 'http://localhost');
  const imagePath = parsedUrl.pathname; // e.g., /path/to/image.png

  const authDisabled = Meteor.settings?.public?.disableAuth === true;

  // Skip auth check if auth is disabled (test/screenshot mode)
  // Use test-user-id's settings from database
  if (authDisabled) {
    const testUserSettings = await UserSettings.findOneAsync({ userId: 'test-user-id' });
    if (testUserSettings?.webdav) {
      const { url: webdavUrl, username, password } = testUserSettings.webdav;
      const baseUrl = webdavUrl.replace(/\/$/, '');
      const auth = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
      console.log('Proxy request (auth disabled):', imagePath);
      return proxyRequest(baseUrl + imagePath, auth, res);
    }
    // Fall back to global settings if no test-user settings
    const settings = Meteor.settings?.webdav || {};
    if (settings.url && settings.username && settings.password) {
      const baseUrl = settings.url.replace(/\/$/, '');
      const auth = 'Basic ' + Buffer.from(`${settings.username}:${settings.password}`).toString('base64');
      console.log('Proxy request (auth disabled, global settings):', imagePath);
      return proxyRequest(baseUrl + imagePath, auth, res);
    }
  }

  // Proxy requires authentication
  const user = await getUserFromRequest(req);
  const userId = user?._id;
  console.log('Proxy request:', imagePath, 'userId:', userId);

  if (!userId) {
    console.log('Proxy: Not authenticated, no userId found');
    res.writeHead(401);
    res.end('Not authenticated');
    return;
  }

  // Get per-user WebDAV settings
  const userSettings = await UserSettings.findOneAsync({ userId });
  if (!userSettings?.webdav) {
    res.writeHead(500);
    res.end('WebDAV not configured');
    return;
  }

  const { url: webdavUrl, username, password } = userSettings.webdav;
  const baseUrl = webdavUrl.replace(/\/$/, '');
  const auth = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');

  await proxyRequest(baseUrl + imagePath, auth, res);
});

async function proxyRequest(fullUrl, auth, res) {
  try {
    const response = await fetch(fullUrl, {
      method: 'GET',
      headers: { 'Authorization': auth },
    });

    if (!response.ok) {
      res.writeHead(response.status);
      res.end(`Error: ${response.statusText}`);
      return;
    }

    // Forward content type
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });

    // Stream the response
    const buffer = await response.arrayBuffer();
    res.end(Buffer.from(buffer));
  } catch (err) {
    console.error('WebDAV proxy error:', err);
    res.writeHead(500);
    res.end('Proxy error');
  }
}

// External image proxy (for CORS-restricted images)
WebApp.connectHandlers.use('/external-proxy', async (req, res) => {
  const parsedUrl = new URL(req.url, 'http://localhost');
  const externalUrl = parsedUrl.searchParams.get('url');

  if (!externalUrl) {
    res.writeHead(400);
    res.end('Missing url parameter');
    return;
  }

  // Validate URL is http/https
  if (!externalUrl.startsWith('http://') && !externalUrl.startsWith('https://')) {
    res.writeHead(400);
    res.end('Invalid URL scheme');
    return;
  }

  // Require authentication to prevent abuse (unless auth is disabled for testing)
  const authDisabled = Meteor.settings?.public?.disableAuth === true;
  if (!authDisabled) {
    const user = await getUserFromRequest(req);
    if (!user) {
      res.writeHead(401);
      res.end('Not authenticated');
      return;
    }
  }

  try {
    const response = await fetch(externalUrl, {
      headers: {
        'User-Agent': 'Makora/1.0',
      },
    });

    if (!response.ok) {
      res.writeHead(response.status);
      res.end(`Error: ${response.statusText}`);
      return;
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });

    const buffer = await response.arrayBuffer();
    res.end(Buffer.from(buffer));
  } catch (err) {
    console.error('External proxy error:', err);
    res.writeHead(500);
    res.end('Proxy error');
  }
});

Meteor.startup(async () => {
  configureGoogleOAuth();
  console.log('Makora server started');
});
