/*
 Enhanced IT Workflow Chatbot with Authentication and Database
 - Auth routes: /api/auth/signup, /api/auth/login, /api/auth/logout, /api/auth/me
 - Ticket routes: /api/tickets (create, list)
 - Access request routes: /api/access-requests (create, list)
 - Onboarding routes: /api/onboarding (create, list)
 - AI chat routes: /api/chat/ticket, /api/chat/access, /api/chat/onboarding
 - Static files served from /static
*/

// Load environment variables early
try { require('dotenv').config(); } catch (_) {}

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const session = require('express-session');
const OpenAI = require('openai');
const crypto = require('crypto');

const authService = require('./src/authService');
const ticketService = require('./src/ticketService');
const accessRequestService = require('./src/accessRequestService');
const onboardingService = require('./src/onboardingService');
const conversationService = require('./src/conversationService');
const intentDetector = require('./src/intentDetector');
const { PromptManager } = require('./src/promptManager');
const { SimpleCache } = require('./src/simpleCache');
const agentService = require('./src/agentService');

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(bodyParser.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));
app.use(express.static('static'));

const port = process.env.PORT || 3000;
// Initialize OpenAI client if API key is provided; otherwise run in fallback mode
let client = null;
const HAS_OPENAI = !!(process.env.OPENAI_API_KEY && String(process.env.OPENAI_API_KEY).trim());
if (HAS_OPENAI) {
  client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
} else {
  console.warn('[WARN] OPENAI_API_KEY not set. Running in fallback mode with deterministic responses.');
}
const cache = new SimpleCache({ maxEntries: 200 });
const prompts = new PromptManager();

// Auth middleware
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function makeCacheKey(prompt, metadata) {
  const h = crypto.createHash('sha256');
  h.update(prompt + JSON.stringify(metadata || {}));
  return h.digest('hex');
}


async function callModel(prompt, opts = {}) {
  const MAX_CHARS = 8000;
  if (prompt.length > MAX_CHARS) {
    prompt = prompt.slice(prompt.length - MAX_CHARS);
  }

  const cacheKey = makeCacheKey(prompt, opts);
  const cached = cache.get(cacheKey);
  if (cached) return { ...cached, _cached: true };

  const model = opts.model || 'gpt-4o-mini';
  const temperature = typeof opts.temperature === 'number' ? opts.temperature : 0.2;

  // Fallback mode when OpenAI is not configured
  if (!HAS_OPENAI || !client) {
    // Very simple deterministic response for local/dev use
    let fallback = opts.fallback;
    if (!fallback) {
      // Try to extract last user message for a friendly echo
      const m = /User:\s*([\s\S]*?)$/i.exec(prompt);
      const lastUser = m ? m[1].trim() : null;
      fallback = lastUser
        ? `AI is not configured. Echoing your request: "${lastUser}". The app will still perform local actions (like creating tickets or access requests). To enable full AI responses, set OPENAI_API_KEY in .env.`
        : 'AI is not configured. Local actions will still work. Set OPENAI_API_KEY in .env to enable full responses.';
    }
    const text = fallback;
    cache.set(cacheKey, { text, usage: null });
    return { text, usage: null };
  }

  const res = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature,
    max_tokens: opts.max_tokens || 800
  });

  const text = (res?.choices?.[0]?.message?.content) || '';
  cache.set(cacheKey, { text, usage: res?.usage });
  return { text, usage: res?.usage };
}

// ============ AUTH ROUTES ============
app.post('/api/auth/signup', async (req, res) => {
  const { email, password, fullName, role } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  try {
    const userId = authService.createUser(email, password, fullName || '', role || 'employee');
    req.session.userId = userId;
    const user = authService.getUserById(userId);
    res.json({ success: true, user });
  } catch (err) {
    console.error('signup error', err);
    res.status(400).json({ error: 'User already exists or invalid input' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  try {
    const user = await authService.authenticate(email, password);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    req.session.userId = user.id;
    res.json({ success: true, user });
  } catch (err) {
    console.error('login error', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = authService.getUserById(req.session.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

// ============ TICKET ROUTES ============
app.post('/api/tickets', requireAuth, (req, res) => {
  const { title, description, priority, category, assignee, tags } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });
  try {
    // Agent classification augmentation
    const classification = agentService.classifyTicket(`${title} ${description || ''}`);
    const ticketId = ticketService.createTicket(req.session.userId, {
      title,
      description,
      priority: priority || classification.priority,
      category: category || classification.category,
      assignee: assignee || classification.assigneeSuggestion,
      tags
    });
    res.json({ success: true, ticketId, classification });
  } catch (err) {
    console.error('create ticket error', err);
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/tickets', requireAuth, (req, res) => {
  try {
    const user = authService.getUserById(req.session.userId);
    let tickets;
    if (user.role === 'admin' || user.role === 'it_staff') {
      const startDate = req.query.startDate;
      tickets = ticketService.getAllTickets({ status: req.query.status, startDate });
    } else {
      tickets = ticketService.getTicketsByUser(req.session.userId);
    }
    res.json({ tickets });
  } catch (err) {
    console.error('get tickets error', err);
    res.status(500).json({ error: String(err) });
  }
});

// ============ ACCESS REQUEST ROUTES ============
app.post('/api/access-requests', requireAuth, (req, res) => {
  const { resourceName, accessType, justification } = req.body;
  if (!resourceName) return res.status(400).json({ error: 'Resource name required' });
  try {
    const requestId = accessRequestService.createAccessRequest(req.session.userId, resourceName, accessType, justification);
    res.json({ success: true, requestId });
  } catch (err) {
    console.error('create access request error', err);
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/access-requests', requireAuth, (req, res) => {
  try {
    const user = authService.getUserById(req.session.userId);
    let requests;
    if (user.role === 'admin' || user.role === 'it_staff') {
      requests = accessRequestService.getAllAccessRequests({ status: req.query.status });
    } else {
      requests = accessRequestService.getAccessRequestsByUser(req.session.userId);
    }
    res.json({ requests });
  } catch (err) {
    console.error('get access requests error', err);
    res.status(500).json({ error: String(err) });
  }
});

// ============ ONBOARDING ROUTES ============
app.post('/api/onboarding', requireAuth, (req, res) => {
  const { employeeName, role, checklistItems, systemsToProvision, welcomeMessage } = req.body;
  if (!employeeName) return res.status(400).json({ error: 'Employee name required' });
  try {
    const checklistId = onboardingService.createChecklist(
      req.session.userId,
      employeeName,
      role,
      checklistItems,
      systemsToProvision,
      welcomeMessage
    );
    res.json({ success: true, checklistId });
  } catch (err) {
    console.error('create onboarding error', err);
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/onboarding', requireAuth, (req, res) => {
  try {
    const user = authService.getUserById(req.session.userId);
    let checklists;
    if (user.role === 'admin' || user.role === 'hr') {
      checklists = onboardingService.getAllChecklists();
    } else {
      checklists = onboardingService.getChecklistsByUser(req.session.userId);
    }
    res.json({ checklists });
  } catch (err) {
    console.error('get onboarding error', err);
    res.status(500).json({ error: String(err) });
  }
});

// ============ AI CHAT ROUTES (Use Cases) ============

// Use case 1: Employee asks for access → Bot creates access request
app.post('/api/chat/access', requireAuth, async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });
  
  try {
    const prompt = prompts.render({ scenario: 'access', message });
    const aiResponse = await callModel(prompt, { model: 'gpt-4o-mini', temperature: 0.15 });
    
    const text = aiResponse.text;
    const resourceMatch = text.match(/resource[:\s]+([A-Za-z0-9\s]+)/i) || text.match(/(Figma|Jira|GitHub|Slack|AWS|Azure)/i);
    const resourceName = resourceMatch ? resourceMatch[1].trim() : message.split(' ').slice(-1)[0];
    
    const requestId = accessRequestService.createAccessRequest(req.session.userId, resourceName, 'read', message);
    
    res.json({
      aiResponse: text,
      action: 'access_request_created',
      requestId,
      resourceName
    });
  } catch (err) {
    console.error('chat access error', err);
    res.status(500).json({ error: String(err) });
  }
});

// Use case 2: HR asks for onboarding checklist → Bot retrieves and displays
app.post('/api/chat/onboarding', requireAuth, async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });
  
  try {
    const prompt = prompts.render({ scenario: 'onboarding', message });
    const aiResponse = await callModel(prompt, { model: 'gpt-4o-mini', temperature: 0.15 });
    
    const checklists = onboardingService.getChecklistsByUser(req.session.userId);
    
    res.json({
      aiResponse: aiResponse.text,
      action: 'onboarding_info_retrieved',
      existingChecklists: checklists
    });
  } catch (err) {
    console.error('chat onboarding error', err);
    res.status(500).json({ error: String(err) });
  }
});

// Use case 3: IT staff asks for open tickets → Bot fetches data
app.post('/api/chat/tickets', requireAuth, async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });
  
  try {
    const user = authService.getUserById(req.session.userId);
    
    let startDate = null;
    if (message.toLowerCase().includes('this week')) {
      const now = new Date();
      const dayOfWeek = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1));
      monday.setHours(0, 0, 0, 0);
      startDate = monday.toISOString();
    }
    
    const tickets = ticketService.getAllTickets({ status: 'open', startDate });
    
    const prompt = `You are an IT support assistant. The user asked: "${message}"\n\nHere are the matching tickets:\n${JSON.stringify(tickets, null, 2)}\n\nProvide a brief summary.`;
    const aiResponse = await callModel(prompt, { model: 'gpt-4o-mini', temperature: 0.15 });
    
    res.json({
      aiResponse: aiResponse.text,
      action: 'tickets_retrieved',
      tickets
    });
  } catch (err) {
    console.error('chat tickets error', err);
    res.status(500).json({ error: String(err) });
  }
});

// Legacy chat endpoint (generic)
app.post('/api/chat', requireAuth, async (req, res) => {
  const { message, scenario } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message required' });

  const template = prompts.render({ scenario, message });
  try {
    const out = await callModel(template, { model: 'gpt-4o-mini', temperature: 0.15 });
    res.json({ input: message, output: out });
  } catch (err) {
    console.error('model error', err);
    res.status(500).json({ error: 'model failure', detail: String(err) });
  }
});

// ============ CONVERSATIONAL AI ENHANCEMENTS ============

// Enhanced chat with conversation history and intent detection
app.post('/api/chat/enhanced', requireAuth, async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });
  
  try {
    const userId = req.session.userId;
    
    // 1. Save user message
    conversationService.saveMessage(userId, message, 'user');
    
    // 2. Detect intent
    const intent = intentDetector.detect(message);
    
    // 3. Get conversation context
    const context = conversationService.getRecentContext(userId, 5);
    
    // 4. Build enhanced prompt with context
    let enhancedPrompt = `Previous conversation:\n${context}\n\nUser: ${message}\n\nDetected intent: ${intent.intent} (confidence: ${intent.confidence.toFixed(2)})`;
    
    // 5. Route to appropriate handler based on intent
    let response;
    let action = null;
    
    if (intent.confidence > 0.5) {
      switch (intent.intent) {
        case 'access_request':
          const resourceName = intent.entities.extracted || 'Unknown Resource';
          const requestId = accessRequestService.createAccessRequest(userId, resourceName, 'read', message);
          response = `I've created an access request for ${resourceName}. Request ID: ${requestId}. The IT team will review it shortly.`;
          action = { type: 'access_request_created', requestId, resourceName };
          break;
          
        case 'ticket_creation':
          const ticketTitle = intent.entities.extracted || message.substring(0, 50);
          const ticketId = ticketService.createTicket(userId, { 
            title: ticketTitle, 
            description: message,
            priority: 'medium'
          });
          response = `I've created a support ticket: "${ticketTitle}". Ticket ID: ${ticketId}. Our IT team will address this soon.`;
          action = { type: 'ticket_created', ticketId };
          break;
          
        case 'ticket_query':
          const tickets = ticketService.getAllTickets({ status: 'open' });
          response = `Found ${tickets.length} open ticket(s):\n${tickets.slice(0, 5).map(t => `- #${t.id}: ${t.title} (${t.priority})`).join('\n')}`;
          action = { type: 'tickets_retrieved', count: tickets.length };
          break;
          
        case 'onboarding_query':
          const checklists = onboardingService.getAllChecklists();
          response = `Found ${checklists.length} onboarding checklist(s):\n${checklists.slice(0, 3).map(c => `- ${c.employee_name} (${c.role})`).join('\n')}`;
          action = { type: 'onboarding_retrieved', count: checklists.length };
          break;
          
        case 'greeting':
          response = `Hello! I'm your IT Workflow Assistant. I can help you with:\n- Access requests (e.g., "I need access to Figma")\n- IT tickets (e.g., "My laptop is not working")\n- Onboarding checklists\n- Ticket queries\n\nHow can I assist you today?`;
          break;
          
        case 'help':
          response = `I can help you with several tasks:\n\n🔑 Access Requests: "I need access to [resource]"\n🎫 Create Tickets: "Issue with [description]"\n📋 View Tickets: "Show open tickets"\n👥 Onboarding: "Show onboarding checklist"\n\nJust ask naturally, and I'll understand!`;
          break;
          
        default:
          // Use AI for unknown intents
          const prompt = prompts.render({ scenario: 'generic', message: enhancedPrompt });
          const aiResponse = await callModel(prompt, { model: 'gpt-4o-mini', temperature: 0.3 });
          response = aiResponse.text;
      }
    } else {
      // Low confidence - use AI
      const prompt = prompts.render({ scenario: 'generic', message: enhancedPrompt });
      const aiResponse = await callModel(prompt, { model: 'gpt-4o-mini', temperature: 0.3 });
      response = aiResponse.text;
    }
    
    // 6. Save bot response
    conversationService.saveMessage(userId, response, 'assistant', { intent: intent.intent, confidence: intent.confidence });
    
    // 7. Get suggestions for next actions
    const suggestions = intentDetector.getSuggestions(intent.intent);
    
    res.json({
      response,
      intent: intent.intent,
      confidence: intent.confidence,
      action,
      suggestions
    });
    
  } catch (err) {
    console.error('enhanced chat error', err);
    res.status(500).json({ error: String(err) });
  }
});

// Get conversation history
app.get('/api/conversations/history', requireAuth, (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const history = conversationService.getConversationHistory(req.session.userId, limit);
    res.json({ history });
  } catch (err) {
    console.error('get history error', err);
    res.status(500).json({ error: String(err) });
  }
});

// Clear conversation history
app.delete('/api/conversations/history', requireAuth, (req, res) => {
  try {
    conversationService.clearHistory(req.session.userId);
    res.json({ success: true, message: 'Conversation history cleared' });
  } catch (err) {
    console.error('clear history error', err);
    res.status(500).json({ error: String(err) });
  }
});

// Get conversation statistics
app.get('/api/conversations/stats', requireAuth, (req, res) => {
  try {
    const stats = conversationService.getStats(req.session.userId);
    res.json({ stats });
  } catch (err) {
    console.error('get stats error', err);
    res.status(500).json({ error: String(err) });
  }
});

// Detect intent from message (utility endpoint)
app.post('/api/intent/detect', requireAuth, (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });
  
  try {
    const intent = intentDetector.detect(message);
    const suggestions = intentDetector.getSuggestions(intent.intent);
    res.json({ intent, suggestions });
  } catch (err) {
    console.error('intent detection error', err);
    res.status(500).json({ error: String(err) });
  }
});

app.listen(port, () => console.log('Server running on', port));

// ============ AGENT ENDPOINTS ============
app.get('/api/agents/status', requireAuth, (req, res) => {
  try {
    const status = agentService.getStatus();
    res.json({ status });
  } catch (e) {
    console.error('agents status error', e);
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/access-requests/approve/pending', requireAuth, (req, res) => {
  try {
    const result = agentService.scanAccessRequests();
    res.json({ result });
  } catch (e) {
    console.error('approve pending error', e);
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/tickets/escalate/run', requireAuth, (req, res) => {
  try {
    const result = agentService.monitorSLA();
    res.json({ result });
  } catch (e) {
    console.error('sla escalate error', e);
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/onboarding/reminders/run', requireAuth, (req, res) => {
  try {
    const result = agentService.dispatchOnboardingReminders();
    res.json({ result });
  } catch (e) {
    console.error('reminders run error', e);
    res.status(500).json({ error: String(e) });
  }
});

// Background agent loops (lightweight intervals)
const FIVE_MIN = 5 * 60 * 1000;
const TEN_MIN = 10 * 60 * 1000;
const FIFTEEN_MIN = 15 * 60 * 1000;

setInterval(() => {
  try {
    const r = agentService.scanAccessRequests();
    if (r.approved) console.log('[Agent] Auto-approved', r.approved, 'access requests');
  } catch (e) { console.warn('[Agent] access scan error', e.message); }
}, FIVE_MIN);

setInterval(() => {
  try {
    const r = agentService.monitorSLA();
    if (r.escalated) console.log('[Agent] Escalated', r.escalated, 'tickets');
  } catch (e) { console.warn('[Agent] sla monitor error', e.message); }
}, TEN_MIN);

setInterval(() => {
  try {
    const r = agentService.dispatchOnboardingReminders();
    if (r.sent) console.log('[Agent] Sent', r.sent, 'onboarding reminders');
  } catch (e) { console.warn('[Agent] reminder dispatch error', e.message); }
}, FIFTEEN_MIN);
