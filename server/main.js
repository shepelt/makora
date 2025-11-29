import { Meteor } from 'meteor/meteor';
import { WebApp } from 'meteor/webapp';
import '/imports/api/server/webdav.js';

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
  console.log('Makora server started');
});
