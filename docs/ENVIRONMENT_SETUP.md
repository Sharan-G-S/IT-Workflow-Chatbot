# Environment Configuration Guide

## Overview
This application uses environment variables to configure API keys, secrets, and server settings. The app is designed to **work without OpenAI configuration** in fallback mode.

## Quick Setup

### 1. Copy the Example File
```bash
cp .env.example .env
```

### 2. Edit Your `.env` File
```bash
# Required for full AI responses (optional in dev)
OPENAI_API_KEY=sk-your-actual-key-here

# Required for production (auto-generated in dev)
SESSION_SECRET=your-secure-random-string-min-32-chars

# Optional - defaults to 3000
PORT=3000
```

## Configuration Options

### `OPENAI_API_KEY` (Optional)
- **Purpose**: Enable full conversational AI responses from OpenAI's GPT models
- **Format**: `sk-...` (OpenAI API key starting with "sk-")
- **Get Key**: https://platform.openai.com/api-keys
- **Without Key**: App runs in **fallback mode** with deterministic responses. All local actions (creating tickets, access requests, onboarding) still work perfectly.

### `SESSION_SECRET` (Required in Production)
- **Purpose**: Securely sign session cookies
- **Format**: Any random string (minimum 32 characters recommended)
- **Generate**: 
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
- **Without Secret**: App uses `dev-secret-change-in-prod` (insecure for production)

### `PORT` (Optional)
- **Purpose**: HTTP server port
- **Format**: Integer (e.g., `3000`, `8080`)
- **Default**: `3000` if not specified
- **Without Port**: App listens on port 3000

## Fallback Mode

### What Works Without `OPENAI_API_KEY`?

✅ **All local actions work perfectly:**
- User authentication (signup/login)
- Creating tickets
- Creating access requests
- Onboarding checklists
- Intent detection (local, <5ms)
- Conversation history
- All database operations

⚠️ **Limited AI responses:**
- AI responses are deterministic/templated
- No dynamic natural language generation
- Simple echoed responses with action confirmations

### Example Without API Key

**User**: "I need access to Figma"

**Bot Response** (Fallback Mode):
```
AI is not configured. Echoing your request: "I need access to Figma". 
The app will still perform local actions (like creating access requests). 
To enable full AI responses, set OPENAI_API_KEY in .env.
```

**Action Taken**: ✅ Access request #123 created successfully

**With API Key**:
```
I've created an access request for Figma. Request ID: 123. 
The IT team will review it shortly. Is there anything else you need access to?
```

**Action Taken**: ✅ Access request #123 created successfully

## Security Best Practices

### Development
```bash
# .env (local only)
OPENAI_API_KEY=sk-dev-key
SESSION_SECRET=dev-secret-change-in-prod
PORT=3000
```

### Production
```bash
# Use environment variables from hosting platform
# Never commit .env to version control

# Generate secure session secret
SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# Use production OpenAI key with usage limits
OPENAI_API_KEY=sk-prod-key-with-limits

# Use standard port or platform-assigned
PORT=8080
```

### `.gitignore` Protection
The `.env` file is already excluded from git:
```
# In .gitignore
.env
```

Only `.env.example` is committed (without real secrets).

## Troubleshooting

### Error: "OPENAI_API_KEY not set"
This is a **warning**, not an error. The app starts successfully in fallback mode.

**Solution Options:**
1. **Run without AI** (current mode) - All features work except AI-generated text
2. **Add API Key** - Get key from https://platform.openai.com/api-keys and add to `.env`

### Error: "Module not found: dotenv"
```bash
npm install
```

### Server won't start on port 3000
Change port in `.env`:
```bash
PORT=8080
```

Or use environment variable:
```bash
PORT=8080 npm start
```

### Session issues in production
Set a strong `SESSION_SECRET`:
```bash
SESSION_SECRET=$(openssl rand -hex 32)
```

## Environment Variable Loading Order

1. **System environment** (highest priority)
   ```bash
   OPENAI_API_KEY=sk-xxx npm start
   ```

2. **`.env` file** (dotenv loads this)
   ```bash
   # .env
   OPENAI_API_KEY=sk-xxx
   ```

3. **Default values** (lowest priority)
   - `PORT`: 3000
   - `SESSION_SECRET`: `dev-secret-change-in-prod`
   - `OPENAI_API_KEY`: None (fallback mode)

## Verification

### Check Loaded Configuration
Add this temporarily to `server.js` after dotenv loads:
```javascript
console.log('Config:', {
  port: process.env.PORT || 3000,
  hasOpenAI: !!(process.env.OPENAI_API_KEY),
  hasSessionSecret: !!(process.env.SESSION_SECRET)
});
```

### Test Fallback Mode
```bash
# Unset or remove OPENAI_API_KEY
npm start
# Should see: [WARN] OPENAI_API_KEY not set. Running in fallback mode...
```

### Test With API Key
```bash
# Add to .env
echo "OPENAI_API_KEY=sk-your-key" >> .env
npm start
# Should see: Server running on 3000 (no warning)
```

## Summary

| Variable | Required | Purpose | Default | Fallback |
|----------|----------|---------|---------|----------|
| `OPENAI_API_KEY` | No | AI responses | None | Deterministic responses |
| `SESSION_SECRET` | Production | Session security | `dev-secret...` | Insecure dev mode |
| `PORT` | No | Server port | `3000` | Port 3000 |

The app is **production-ready** even without OpenAI - all core workflow automation features work perfectly! 🚀
