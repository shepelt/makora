import { Meteor } from 'meteor/meteor';
import { Accounts } from 'meteor/accounts-base';
import { WebApp } from 'meteor/webapp';
import { ServiceConfiguration } from 'meteor/service-configuration';
import '/imports/api/server/webdav.js';

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

// Image proxy for WebDAV resources
WebApp.connectHandlers.use('/webdav-proxy', async (req, res) => {
  const imagePath = req.url; // e.g., /path/to/image.png

  const url = process.env.WEBDAV_URL;
  const username = process.env.WEBDAV_USERNAME;
  const password = process.env.WEBDAV_PASSWORD;

  if (!url || !username || !password) {
    res.writeHead(500);
    res.end('WebDAV not configured');
    return;
  }

  const baseUrl = url.replace(/\/$/, '');
  const auth = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  const fullUrl = baseUrl + imagePath;

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
});

Meteor.startup(async () => {
  configureGoogleOAuth();
  console.log('Makora server started');
});
