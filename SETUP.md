# Quick Setup Guide

## Prerequisites Check

1. **Node.js installed?**
   ```bash
   node --version  # Should show v18 or higher
   ```

2. **Have an OpenAI API key?**
   - Get one from https://platform.openai.com/api-keys
   - Or use a compatible API endpoint

## Installation Steps

### 1. Navigate to project directory
```bash
cd /Users/sharan/Documents/September-AI/Team-2
```

### 2. Install dependencies (already done if you see node_modules/)
```bash
npm install
```

### 3. Set your OpenAI API key
```bash
# Option A: Export in terminal (temporary)
export OPENAI_API_KEY="sk-your-actual-key-here"

# Option B: Create .env file (recommended)
cp .env.example .env
# Then edit .env and add your real API key
```

### 4. Start the server
```bash
npm start
```

You should see: `Server running on 3000`

### 5. Open your browser
```
http://localhost:3000
```

## First Time Usage

1. **Sign Up**
   - You'll be redirected to login page
   - Click "Sign up" link
   - Fill in your details
   - Choose a role:
     - **Employee**: Can create tickets and access requests
     - **IT Staff**: Can view all tickets and requests
     - **HR**: Can manage onboarding checklists
     - **Admin**: Full access to everything

2. **Explore the Dashboard**
   - **AI Chat Tab**: Try the example prompts
   - **Tickets Tab**: Create and view IT tickets
   - **Access Requests Tab**: Request access to resources
   - **Onboarding Tab**: Manage employee onboarding

## Testing AI Use Cases

### Use Case 1: Request Access
1. Go to "AI Chat" tab
2. Select "Request Access" from dropdown
3. Type: "I need access to Figma"
4. Click Send
5. Bot will create an access request automatically!
6. Check "Access Requests" tab to see it

### Use Case 2: View Onboarding
1. First create a checklist in "Onboarding" tab
2. Go back to "AI Chat" tab
3. Select "Onboarding Info"
4. Type: "Show onboarding checklist for new hire"
5. Bot retrieves and displays checklists

### Use Case 3: Query Tickets (IT Staff role)
1. First create some tickets in "Tickets" tab
2. Go to "AI Chat" tab
3. Select "View Tickets"
4. Type: "Show open tickets from this week"
5. Bot filters and summarizes tickets

## Troubleshooting

### "Cannot find module" errors
```bash
npm install
```

### "Unauthorized" when accessing dashboard
- Clear browser cookies
- Sign in again

### Database errors
```bash
# Delete and recreate database
rm -rf data/
# Restart server (database will be recreated)
npm start
```

### API key not working
- Verify key is set: `echo $OPENAI_API_KEY`
- Check for spaces or quotes in the key
- Ensure key starts with "sk-"

## Development Mode

For auto-reload during development:
```bash
npm run dev
```

## What's Next?

- Read the main README.md for architecture details
- Check docs/notes.md for optimization strategies
- Customize prompt templates in src/promptManager.js
- Add more workflows and features!

## Need Help?

- Check the console for error messages
- Verify all dependencies installed: `npm list`
- Ensure port 3000 is not in use: `lsof -i :3000`
