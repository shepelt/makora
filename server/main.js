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

// Image proxy for WebDAV resources
WebApp.connectHandlers.use('/webdav-proxy', async (req, res) => {
  // Strip query params from path (token is extracted by getUserFromRequest)
  const parsedUrl = new URL(req.url, 'http://localhost');
  const imagePath = parsedUrl.pathname; // e.g., /path/to/image.png

  // Proxy ALWAYS requires authentication
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
    // Fall back to global settings in test mode (user is authenticated but no personal settings)
    const authDisabled = Meteor.settings?.public?.disableAuth === true;
    if (authDisabled) {
      const settings = Meteor.settings?.webdav || {};
      if (settings.url && settings.username && settings.password) {
        const baseUrl = settings.url.replace(/\/$/, '');
        const auth = 'Basic ' + Buffer.from(`${settings.username}:${settings.password}`).toString('base64');
        return proxyRequest(baseUrl + imagePath, auth, res);
      }
    }
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

Meteor.startup(async () => {
  configureGoogleOAuth();
  console.log('Makora server started');
});
