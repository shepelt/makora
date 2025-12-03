# Makora Docker Deployment

Docker configuration for deploying Makora in containerized environments with optional Tailscale integration for secure remote access.

## Prerequisites

- Docker 20.10+
- Docker Compose 2.0+

## Quick Start

1. **Configure environment variables**

   ```bash
   cd docker
   cp .env.example .env
   # Edit .env with your values
   ```

2. **Configure WebDAV settings**

   Ensure your `settings-local.json` exists in the project root with WebDAV credentials:
   ```json
   {
     "webdav": {
       "url": "https://your-server.com/remote.php/dav/files/username",
       "username": "your-username",
       "password": "your-password"
     }
   }
   ```

3. **Start the services**

   ```bash
   docker-compose up -d
   ```

4. **View logs**

   ```bash
   docker-compose logs -f makora
   ```

## With Tailscale (Secure Remote Access)

Tailscale provides secure access to Makora over your private network with automatic HTTPS.

1. **Generate a Tailscale auth key**

   Go to https://login.tailscale.com/admin/settings/keys and create a reusable auth key.

2. **Configure Tailscale in .env**

   ```bash
   TS_AUTHKEY=tskey-auth-xxxxx
   TS_HOSTNAME=makora
   ROOT_URL=https://makora.your-tailnet.ts.net
   ```

3. **Start with Tailscale profile**

   ```bash
   docker-compose --profile tailscale up -d
   ```

4. **Access via Tailscale**

   Once connected, access Makora at `https://makora.your-tailnet.ts.net`

## Deploying to a Remote Server

To deploy to a remote server (e.g., miniline):

1. **Copy files to server**
   ```bash
   rsync -avz --exclude node_modules --exclude .meteor/local \
     . miniline:~/makora/
   ```

2. **SSH to server and start**
   ```bash
   ssh miniline
   cd makora/docker
   cp .env.example .env
   # Edit .env with production values
   docker-compose --profile tailscale up -d --build
   ```

## Architecture

### Services

- **mongodb**: MongoDB database for user accounts
- **makora**: Makora Meteor application
- **tailscale**: Tailscale sidecar for secure remote access (optional)

### Volumes

- `makora-mongodb-data`: MongoDB data persistence
- `makora-tailscale-data`: Tailscale state persistence

### Network

- `makora-network`: Bridge network for service communication

## Commands

### Build and start
```bash
docker-compose up --build -d
```

### Start with Tailscale
```bash
docker-compose --profile tailscale up -d
```

### View logs
```bash
docker-compose logs -f
```

### Stop services
```bash
docker-compose down
```

### Rebuild after code changes
```bash
docker-compose up --build -d
```

### Execute commands in container
```bash
docker-compose exec makora bash
```

## Troubleshooting

### Container won't start
Check logs:
```bash
docker-compose logs makora
```

### WebDAV connection issues
Verify your `settings-local.json` has correct credentials and the WebDAV server is accessible.

### Tailscale not connecting
1. Check that your auth key is valid and not expired
2. Verify the key has the right permissions
3. Check Tailscale logs:
   ```bash
   docker-compose logs tailscale
   ```

### Reset everything
```bash
docker-compose down -v
docker-compose up --build -d
```

## Security Notes

- Application runs as non-root user
- WebDAV credentials should be kept secure in `settings-local.json`
- Use Tailscale for secure remote access instead of exposing ports directly
