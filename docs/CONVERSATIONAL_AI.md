# Conversational AI Chatbot Features

## Overview

Your IT Workflow Assistant now includes **advanced conversational AI capabilities** that enable natural, context-aware conversations with intelligent intent detection and action automation.

## 🎯 Key Features

### 1. **Natural Language Understanding (NLU)**
The chatbot uses a custom intent detection system that understands user requests without requiring exact commands.

**Supported Intents:**
- **Access Requests** - Detects when users need system/resource access
- **Ticket Creation** - Identifies issues and problems that need IT support
- **Ticket Queries** - Understands requests to view or search tickets
- **Onboarding Queries** - Recognizes onboarding-related questions
- **Greetings** - Responds to casual conversation starters
- **Help Requests** - Provides guidance on capabilities
- **Status Checks** - Answers questions about task/request status

**Example Inputs:**
```
"I need access to Figma" → Access Request Intent (80% confidence)
"My laptop keeps crashing" → Ticket Creation Intent (75% confidence)
"Show me tickets from this week" → Ticket Query Intent (70% confidence)
```

### 2. **Conversation Memory**
Every conversation is stored with full context, enabling:
- **Persistent chat history** across sessions
- **Context-aware responses** based on previous messages
- **Conversation statistics** (total messages, active days)
- **History export** capability

**Database Schema:**
```sql
CREATE TABLE conversations (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  message TEXT,
  role TEXT,  -- 'user' or 'assistant'
  metadata TEXT,  -- JSON with intent, confidence, actions
  created_at DATETIME
)
```

### 3. **Intelligent Intent Detection**

The system uses a hybrid approach:

**Pattern Matching:**
```javascript
/need access to (.+)/i
/(.+) (?:is|isn't|not) working/i
/show (?:me )?(?:all |the )?tickets/i
```

**Keyword Analysis:**
```javascript
access_request: ['access', 'need', 'permission', 'grant']
ticket_creation: ['broken', 'not working', 'issue', 'problem']
```

**Confidence Scoring:**
- Pattern match: +60% score
- Keyword matches: +40% score (proportional)
- Final confidence: score × intent_confidence_modifier

### 4. **Automatic Action Execution**

When intent confidence > 50%, the bot automatically:
- Creates access requests
- Generates IT tickets
- Queries databases
- Retrieves onboarding checklists

**Response Format:**
```json
{
  "response": "I've created an access request for Figma...",
  "intent": "access_request",
  "confidence": 0.85,
  "action": {
    "type": "access_request_created",
    "requestId": 123,
    "resourceName": "Figma"
  },
  "suggestions": [
    "I need access to GitHub",
    "Can I get access to AWS?"
  ]
}
```

### 5. **Smart Suggestions**

Context-aware quick action suggestions based on:
- Detected intent
- User role
- Conversation history
- Common patterns

**Example:** After greeting, suggests:
- "I need access to Figma"
- "Show open tickets"
- "Create onboarding checklist"

### 6. **Enhanced UI/UX**

**Visual Features:**
- 💬 **Message bubbles** with distinct user/assistant styling
- 🎨 **Gradient avatars** for visual identity
- ⌨️ **Typing indicators** for realistic conversation feel
- 📊 **Intent badges** showing detected intent + confidence
- ✅ **Action badges** confirming completed actions
- 💡 **Suggestion chips** for quick interactions

**Interaction Features:**
- Auto-expanding text input
- Enter to send, Shift+Enter for new line
- Suggestion chips clickable to auto-fill
- Smooth scroll-to-bottom animations
- Real-time message appearance animations

## 📡 API Endpoints

### Enhanced Chat
```
POST /api/chat/enhanced
Body: { message: string }
Response: { response, intent, confidence, action, suggestions }
```

### Conversation History
```
GET /api/conversations/history?limit=50
Response: { history: [...] }
```

### Clear History
```
DELETE /api/conversations/history
Response: { success: true }
```

### Conversation Stats
```
GET /api/conversations/stats
Response: { stats: { total_messages, days_active, last_message } }
```

### Intent Detection
```
POST /api/intent/detect
Body: { message: string }
Response: { intent, suggestions }
```

## 🧠 How It Works

### Conversation Flow

```
1. User types message
   ↓
2. Save message to database (role: 'user')
   ↓
3. Detect intent using NLU
   ↓
4. Get recent conversation context (last 5 messages)
   ↓
5. Determine action based on intent confidence
   ↓
   ├─ High confidence (>0.5) → Execute specific action
   │                           (create ticket, access request, etc.)
   ↓
   └─ Low confidence → Use AI (OpenAI) for response
   ↓
6. Save response to database (role: 'assistant')
   ↓
7. Generate smart suggestions for next action
   ↓
8. Return response with metadata to frontend
   ↓
9. Display with intent badge and action confirmation
```

### Example Interaction

**User Input:**
```
"I need access to Figma"
```

**Processing:**
1. Intent Detection:
   - Matches pattern: `/need access to (.+)/i`
   - Matches keywords: ['need', 'access']
   - Confidence: 0.85
   - Intent: `access_request`
   - Extracted entity: "Figma"

2. Action Execution:
   - Calls `accessRequestService.createAccessRequest()`
   - Creates database entry
   - Returns requestId: 123

3. Response Generation:
   - "I've created an access request for Figma. Request ID: 123..."
   - Adds intent badge: "access_request (85%)"
   - Adds action badge: "✓ access request created"

4. Suggestions Update:
   - "I need access to GitHub"
   - "Can I get access to AWS console?"
   - "Grant me access to Azure"

## 🎨 UI Components

### Chat Interface (`/chat.html`)

**Header:**
- Title + description
- History and Clear buttons
- User info + logout

**Stats Panel:**
- Total messages count
- Active days
- Last message timestamp

**Messages Area:**
- Scrollable conversation history
- User messages (right, purple gradient)
- Assistant messages (left, white with border)
- Typing indicator animation
- Intent/action badges

**Suggestions Bar:**
- Horizontal scroll
- Context-aware chips
- One-click to use

**Input Area:**
- Auto-expanding textarea
- Enter to send
- Send button with gradient

## 💡 Usage Examples

### Access Request
```
User: "Can I get access to the HR database?"
Bot: "I've created an access request for HR database. 
      Request ID: 124. The IT team will review it shortly."
      [Intent: access_request (82%)]
      [Action: ✓ access request created]
```

### Ticket Creation
```
User: "My keyboard is not working properly"
Bot: "I've created a support ticket: 'keyboard is not working properly'. 
      Ticket ID: 45. Our IT team will address this soon."
      [Intent: ticket_creation (76%)]
      [Action: ✓ ticket created]
```

### Conversational Query
```
User: "What tickets are open?"
Bot: "Found 12 open ticket(s):
      - #45: Keyboard issue (medium)
      - #46: Printer jam (high)
      - #47: Software install (low)
      ..."
      [Intent: ticket_query (73%)]
      [Action: ✓ tickets retrieved]
```

### Help Request
```
User: "What can you help me with?"
Bot: "I can help you with several tasks:
      🔑 Access Requests: 'I need access to [resource]'
      🎫 Create Tickets: 'Issue with [description]'
      📋 View Tickets: 'Show open tickets'
      👥 Onboarding: 'Show onboarding checklist'
      Just ask naturally, and I'll understand!"
      [Intent: help (85%)]
```

## 🔧 Configuration

### Adjust Intent Confidence Thresholds

Edit `src/intentDetector.js`:
```javascript
this.intents = {
  access_request: {
    confidence: 0.8,  // Adjust base confidence
    // ...
  }
}
```

### Customize Response Templates

Edit `src/intentDetector.js` suggestions:
```javascript
getSuggestions(intent) {
  const suggestions = {
    access_request: [
      'Your custom suggestion 1',
      'Your custom suggestion 2'
    ]
  }
}
```

### Modify Conversation Context Window

Edit `server.js`:
```javascript
// Get last 5 messages (adjust number)
const context = conversationService.getRecentContext(userId, 5);
```

## 📈 Performance Optimizations

1. **Intent Detection** - Local processing, no API calls
2. **Conversation Storage** - Indexed database queries
3. **Context Window** - Limited to recent messages only
4. **AI Fallback** - Only used for low-confidence intents
5. **Caching** - AI responses cached when possible

## 🚀 Next Steps

Potential enhancements:
- [ ] Multi-turn conversation flows
- [ ] Entity extraction improvements
- [ ] Sentiment analysis
- [ ] Voice input/output
- [ ] Multi-language support
- [ ] Custom intent training UI
- [ ] Conversation analytics dashboard
- [ ] Export chat transcripts

## 🎯 Benefits

✅ **Natural Interaction** - No need to learn commands
✅ **Context Awareness** - Remembers conversation history
✅ **Automatic Actions** - Creates tickets/requests automatically
✅ **Smart Suggestions** - Guides users to next actions
✅ **Visual Feedback** - Shows intent and confidence
✅ **Conversation History** - Access past discussions
✅ **Fast Response** - Intent detection is instant
✅ **Cost Efficient** - Reduces unnecessary AI API calls

---

Your chatbot is now a **fully conversational AI assistant** with natural language understanding, context awareness, and intelligent automation! 🤖✨
