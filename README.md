# AI Gateway

AI Gateway is a self-hosted gateway that lets you manage multiple AI providers behind one local API and one dashboard.

It provides:

- An OpenAI-compatible endpoint at `/v1`
- An Anthropic-compatible endpoint at `/anthropic`
- A web dashboard for provider management, model testing, API keys, request logs, and settings
- Provider-specific adapters for services that are not standard OpenAI APIs
- Multiple auth flows: API key, OAuth, web-cookie injection, and local adapters
- Model aliasing and provider routing
- A Token Saver mode that compresses large tool outputs before sending them upstream

## How It Works

AI Gateway sits between your client and your upstream providers.

Your app talks to AI Gateway once. AI Gateway then:

1. Authenticates the request with a gateway key if keys are enabled
2. Resolves the requested model or alias
3. Routes the request to the correct provider
4. Applies provider-specific translation when needed
5. Logs the request and response metadata for the dashboard

This makes it possible to combine standard API providers and web-based adapters in one place.

## Main Features

- Dashboard login with `ADMIN_PASSWORD`
- Gateway API key management
- Provider presets grouped by flow:
  - `API Key`
  - `OAuth Login`
  - `Web Cookie`
  - `Local`
- Model browser and live model test
- Model aliases, including custom client-facing names
- Provider-specific web adapters:
  - `Bud Web`
  - `Devin Web`
- OAuth provider support, including:
  - `Claude Code`
  - `Gemini CLI`
  - `Antigravity`
  - `Codex`
  - `GitHub Copilot`
  - `Kimi Coding`
  - `KiloCode`
  - `CodeBuddy`
  - `Cline`
  - `Kiro`
  - `GitLab Duo`
  - `iFlow`
  - `Qwen OAuth`
- Request logs with latency and token accounting when the upstream returns usage data
- Token Saver mode for tool-heavy agent traffic

## Project Structure

```text
.
|-- dashboard/     React + Vite admin UI
|-- extension/     Chrome extension for web-provider auth extraction
|-- server/        Express + TypeScript gateway server
|-- Dockerfile
|-- docker-compose.yml
|-- start.sh
|-- start.bat
`-- deploy-vps.sh
```

## Requirements

- Node.js 20+
- npm
- For Docker deployment: Docker and Docker Compose
- For Bud and Devin web adapters: Google Chrome or another Chromium browser that supports the included extension

## Local Development Run

### 1. Install dependencies

From the repository root:

```bash
npm run install:all
```

### 2. Create the server environment file

The local server reads `server/.env`.

```bash
cp server/.env.example server/.env
```

On Windows PowerShell:

```powershell
Copy-Item server\.env.example server\.env
```

### 3. Edit `server/.env`

At minimum, change these values:

```env
ADMIN_PASSWORD=your-dashboard-password
JWT_SECRET=replace-this-with-a-random-secret
EXTENSION_TOKEN=replace-this-with-a-shared-extension-token
```

Important variables:

- `PORT`: server port, default `3000`
- `HOST`: bind address, default `0.0.0.0`
- `DB_PATH`: SQLite database path
- `ADMIN_PASSWORD`: dashboard login password
- `JWT_SECRET`: secret used for gateway API keys
- `CORS_ORIGINS`: allowed origins
- `EXTENSION_TOKEN`: must match the token configured in the Chrome extension popup
- `LOG_RETENTION_DAYS`: retention window for request logs

### 4. Start the app

For normal local development:

```bash
npm run dev
```

This starts:

- the server in watch mode
- the dashboard Vite dev server

If you only want the backend:

```bash
npm run dev:server
```

If you only want the dashboard:

```bash
npm run dev:dashboard
```

### 5. Open the dashboard

- Dashboard: `http://localhost:3000`
- OpenAI-compatible base URL: `http://localhost:3000/v1`
- Anthropic-compatible base URL: `http://localhost:3000/anthropic`

## Production Run With Docker

The repository includes a multi-stage `Dockerfile` and `docker-compose.yml`.

### 1. Create a root `.env`

`docker-compose.yml` reads environment variables from the repository root `.env`.

Example:

```env
PORT=3000
ADMIN_PASSWORD=your-dashboard-password
JWT_SECRET=replace-this-with-a-random-secret
EXTENSION_TOKEN=replace-this-with-a-shared-extension-token
CORS_ORIGINS=*
LOG_RETENTION_DAYS=30
```

### 2. Build and start

```bash
docker compose build
docker compose up -d
```

### 3. Open the dashboard

```text
http://localhost:3000
```

The SQLite database is stored in the Docker volume mounted at `/data`.

## VPS Deployment

For a simple VPS deployment:

```bash
bash deploy-vps.sh
```

What it does:

1. Checks Docker
2. Builds the image
3. Starts the container with Docker Compose
4. Exposes the dashboard on the configured port

If you want HTTPS in front of the gateway, use a reverse proxy such as Nginx or Cloudflare.

## Build Commands

From the repository root:

```bash
npm run build
```

Or separately:

```bash
npm run build:server
npm run build:dashboard
```

Start the built server:

```bash
npm run start
```

## Dashboard Overview

### Dashboard

General status and recent activity.

### Providers

Create and manage upstream providers. Providers are grouped by auth flow so users can pick the right setup path.

Supported flows:

- `API Key`: standard providers with bearer or compatible API keys
- `OAuth Login`: providers that support browser or device authorization
- `Web Cookie`: providers that require session extraction from the website
- `Local`: provider-specific local or CLI-style integrations

### Models

- View models exposed by each provider
- Test a model directly from the dashboard
- Rename models with aliases
- Add routing rules for patterns or exact names

### Request Logs

Inspect latency, status, token usage, and request history.

### API Keys

Create gateway keys for clients that should authenticate to AI Gateway instead of talking directly to the upstream provider.

### Settings

- Connection info
- Token Saver toggle
- Chrome extension setup instructions
- Dashboard password reminder

## Adding Providers

### API key providers

Use this for normal OpenAI-compatible or Anthropic-compatible endpoints.

Examples:

- Fireworks
- xAI
- OpenRouter-style providers
- Standard vendor APIs

### OAuth providers

Use the dashboard OAuth flow when the preset supports it. The gateway stores the resulting tokens and uses them for upstream requests.

Examples:

- Claude Code OAuth
- Gemini CLI OAuth
- Codex OAuth
- GitHub Copilot OAuth
- GitLab Duo OAuth

### Web cookie providers

Use this for providers that do not expose a stable public chat API for your use case but do work through their website session.

Current adapters:

- `Bud Web`
- `Devin Web`

These adapters are provider-specific. They are not generic OpenAI-compatible providers.

## Chrome Extension Setup

The included extension is used to extract browser session data for web-based providers.

### 1. Load the extension

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select the `extension/` folder

### 2. Configure the extension

Open the extension popup and set:

- `Gateway URL`: for example `http://localhost:3000`
- `Extension Token`: must match `EXTENSION_TOKEN` in `server/.env`

### 3. Extract provider auth

Visit the provider website while logged in, then use the popup to extract and push auth data to the gateway.

This is required for:

- `Bud Web`
- `Devin Web`

## Model Aliases

AI Gateway supports client-facing model aliases.

Examples:

- Map `my-claude` to a Claude model on one provider
- Map `team-default` to a preferred internal route
- Keep the original upstream model visible while also adding a friendlier alias

This is useful when you want stable model names in clients while the upstream model mapping changes over time.

## Token Saver

Token Saver is intended for tool-heavy agents.

When enabled, the gateway rewrites large tool outputs before forwarding them to the upstream model. This reduces token waste for outputs such as:

- `git diff`
- `git status`
- `grep`
- `find`
- `ls`
- `tree`
- large logs

It only rewrites tool result content and skips error tool results.

## API Usage

### OpenAI-compatible

Base URL:

```text
http://localhost:3000/v1
```

Example in Python:

```python
from openai import OpenAI

client = OpenAI(
    api_key="sk-gw-your-key",
    base_url="http://localhost:3000/v1",
)

response = client.chat.completions.create(
    model="gpt-5.5",
    messages=[{"role": "user", "content": "Hello"}],
)

print(response.choices[0].message.content)
```

### Anthropic-compatible

Base URL:

```text
http://localhost:3000/anthropic
```

## Authentication Modes

### Dashboard authentication

The dashboard is protected by `ADMIN_PASSWORD`.

### Gateway API authentication

If you create gateway keys in the dashboard, clients can authenticate with:

- `Authorization: Bearer sk-gw-...`
- or `x-api-key: sk-gw-...`

If no gateway keys exist, the gateway runs in open mode.

## Troubleshooting

### The dashboard cannot log in

Check `ADMIN_PASSWORD` in `server/.env`, then restart the server.

### The extension says `Invalid extension token`

Make sure the token in the extension popup exactly matches `EXTENSION_TOKEN` in `server/.env`.

### A provider returns HTML instead of JSON

You are probably using the provider website URL instead of its API base URL. Use a matching provider preset or a provider-specific adapter.

### Bud or Devin stops working after refresh or time passes

Re-extract the session with the extension. Web providers depend on browser-auth state and provider-specific tokens.

### A model exists in the dashboard but client calls fail

The provider may list the model but still reject chat calls for that account, region, or auth state. Use the `Model Test` panel first to verify the model from inside the gateway.

## Notes

- The local development path uses `server/.env`
- The Docker Compose path uses the repository root `.env`
- Bud and Devin support is adapter-based, not generic OpenAI compatibility
- Some OAuth providers depend on their current vendor flow and may change over time

