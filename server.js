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
const { RedisCache } = require('./src/redisCache');
const { WebSocketService } = require('./src/websocketService');
const { EmailService } = require('./src/emailService');
const { SearchService } = require('./src/searchService');
const { AnalyticsService } = require('./src/analyticsService');
const { ExternalIntegrationsService } = require('./src/externalIntegrationsService');
const agentService = require('./src/agentService');
const notificationService = require('./src/notificationService');
const AgentTriageRouter = require('./src/agents/AgentTriageRouter');
const http = require('http');
const RedisStore = require('connect-redis').default;

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
// Initialize enhanced services
let cache = new SimpleCache({ maxEntries: 200 }); // Fallback cache
let redisCache = null;
let websocketService = null;
let emailService = null;
let searchService = null;
let analyticsService = null;
let integrationsService = null;
const prompts = new PromptManager();

// Initialize Redis cache if available
try {
  redisCache = new RedisCache();
  redisCache.connect().then(connected => {
    if (connected) {
      cache = redisCache; // Use Redis as primary cache
      console.log('[CACHE] Using Redis for persistent caching');
    } else {
      console.log('[CACHE] Redis unavailable, using in-memory cache');
    }
  });
} catch (error) {
  console.warn('[CACHE] Redis initialization failed, using in-memory cache:', error.message);
}

// Create HTTP server for Socket.IO
const server = http.createServer(app);

// Initialize WebSocket service
try {
  websocketService = new WebSocketService(server);
  console.log('[WEBSOCKET] Real-time service initialized');
} catch (error) {
  console.error('[WEBSOCKET] Failed to initialize:', error.message);
}

// Initialize email service
try {
  emailService = new EmailService();
  console.log('[EMAIL] Notification service initialized');
} catch (error) {
  console.error('[EMAIL] Failed to initialize:', error.message);
}

// Initialize other services after database is ready
setTimeout(async () => {
  try {
    // Get database instance (assuming it's available from one of the services)
    const db = require('./src/database');
    
    // Initialize search service
    searchService = new SearchService(db);
    console.log('[SEARCH] Advanced search service initialized');
    
    // Initialize analytics service
    analyticsService = new AnalyticsService(db);
    console.log('[ANALYTICS] Analytics service initialized');
    
    // Initialize external integrations
    integrationsService = new ExternalIntegrationsService(db, {
      jira: {
        enabled: process.env.JIRA_ENABLED === 'true'
      },
      servicenow: {
        enabled: process.env.SERVICENOW_ENABLED === 'true'
      },
      sync: {
        enabled: process.env.SYNC_ENABLED === 'true'
      }
    });
    console.log('[INTEGRATIONS] External systems service initialized');
  } catch (error) {
    console.error('[SERVICES] Failed to initialize enhanced services:', error.message);
  }
}, 1000);

// Initialize LangChain Agent Router
let agentRouter = null;
if (HAS_OPENAI) {
  agentRouter = new AgentTriageRouter({
    enableMultiAgent: true,
    confidenceThreshold: 0.7,
    maxAgents: 2
  });
  console.log('[INFO] LangChain Agent Router initialized');
} else {
  console.warn('[WARN] LangChain agents disabled - OPENAI_API_KEY not set');
}

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
    
    // Auto-schedule reminders for checklist items
    const reminderResult = agentService.scheduleChecklistReminders(checklistId);
    
    res.json({ success: true, checklistId, reminders: reminderResult });
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

// ============ ADVANCED AUTOMATION FEATURES ============

// Auto Ticket Generation with AI Analysis
app.post('/api/tickets/auto-generate', requireAuth, async (req, res) => {
  const { description, title } = req.body;
  if (!description) return res.status(400).json({ error: 'Description required' });
  
  try {
    // AI-powered categorization and priority detection
    const category = autoDetectCategory(description);
    const priority = autoDetectPriority(description);
    const assignee = await autoAssignTicket(category, priority);
    
    const ticket = {
      id: Date.now(),
      title: title || `Auto-generated: ${description.substring(0, 50)}...`,
      description,
      category,
      priority,
      assignee,
      status: 'open',
      auto_generated: true,
      created_at: new Date().toISOString(),
      sla_due: calculateSLADueDate(priority)
    };
    
    // Store ticket using existing service
    const result = await ticketService.createTicket(ticket);
    
    // Log auto-generation
    console.log(`[AUTO-TICKET] Generated ticket #${ticket.id} - Category: ${category}, Priority: ${priority}`);
    
    res.json({ success: true, ticket, message: 'Ticket auto-generated successfully' });
  } catch (err) {
    console.error('Auto ticket generation error:', err);
    res.status(500).json({ error: 'Failed to auto-generate ticket' });
  }
});

// Low-Risk Access Auto-Approval
app.post('/api/access/auto-approve', requireAuth, async (req, res) => {
  const { resource, reason } = req.body;
  if (!resource) return res.status(400).json({ error: 'Resource required' });
  
  try {
    const riskLevel = assessAccessRisk(resource);
    const isLowRisk = riskLevel === 'low';
    
    const accessRequest = {
      id: Date.now(),
      user_id: req.session.userId,
      resource,
      reason: reason || 'Auto-approval for low-risk resource',
      status: isLowRisk ? 'approved' : 'pending',
      auto_approved: isLowRisk,
      risk_level: riskLevel,
      created_at: new Date().toISOString(),
      approved_at: isLowRisk ? new Date().toISOString() : null,
      approval_reason: isLowRisk ? 'Automatic approval - Low risk resource' : null
    };
    
    // Store using existing service
    const result = await accessRequestService.createRequest(accessRequest);
    
    // Log auto-approval
    if (isLowRisk) {
      console.log(`[AUTO-APPROVAL] Access granted to ${resource} for user ${req.session.userId} - Risk: ${riskLevel}`);
    }
    
    res.json({ 
      success: true, 
      request: accessRequest, 
      auto_approved: isLowRisk,
      message: isLowRisk ? 'Access automatically approved - Low risk resource' : 'Access request submitted for review'
    });
  } catch (err) {
    console.error('Auto approval error:', err);
    res.status(500).json({ error: 'Failed to process access request' });
  }
});

// SLA Monitoring & Auto-Escalation
app.get('/api/sla/monitor', requireAuth, async (req, res) => {
  try {
    const tickets = await ticketService.getAllTickets();
    const slaStatus = {
      compliant: [],
      warning: [],
      violated: [],
      escalated: []
    };
    
    tickets.forEach(ticket => {
      if (ticket.status === 'resolved') {
        slaStatus.compliant.push(ticket);
        return;
      }
      
      const created = new Date(ticket.created_at);
      const now = new Date();
      const hoursSince = (now - created) / (1000 * 60 * 60);
      
      const slaThreshold = getSLAThreshold(ticket.priority);
      const warningThreshold = slaThreshold * 0.8;
      
      if (hoursSince > slaThreshold) {
        slaStatus.violated.push({
          ...ticket,
          hours_overdue: Math.round(hoursSince - slaThreshold)
        });
        
        // Auto-escalate if not already escalated
        if (!ticket.escalated) {
          escalateTicket(ticket.id);
          slaStatus.escalated.push(ticket);
        }
      } else if (hoursSince > warningThreshold) {
        slaStatus.warning.push({
          ...ticket,
          hours_remaining: Math.round(slaThreshold - hoursSince)
        });
      } else {
        slaStatus.compliant.push(ticket);
      }
    });
    
    res.json({ success: true, sla_status: slaStatus });
  } catch (err) {
    console.error('SLA monitoring error:', err);
    res.status(500).json({ error: 'Failed to monitor SLA' });
  }
});

// Onboarding Cadence Reminders
app.get('/api/onboarding/reminders', requireAuth, async (req, res) => {
  try {
    const checklists = await onboardingService.getAllChecklists();
    const reminders = {
      overdue: [],
      due_today: [],
      due_soon: []
    };
    
    checklists.forEach(checklist => {
      if (checklist.status === 'completed') return;
      
      const items = checklist.checklist_items || [];
      items.forEach(item => {
        if (item.completed) return;
        
        const dueDate = new Date(item.due_date);
        const today = new Date();
        const daysDiff = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
        
        const reminderItem = {
          checklist_id: checklist.id,
          employee_name: checklist.employee_name,
          role: checklist.role,
          item: item.task,
          due_date: item.due_date,
          days_diff: daysDiff
        };
        
        if (daysDiff < 0) {
          reminders.overdue.push(reminderItem);
        } else if (daysDiff === 0) {
          reminders.due_today.push(reminderItem);
        } else if (daysDiff <= 3) {
          reminders.due_soon.push(reminderItem);
        }
      });
    });
    
    // Send notifications for overdue and due today items
    if (reminders.overdue.length > 0 || reminders.due_today.length > 0) {
      sendOnboardingReminders(reminders);
    }
    
    res.json({ success: true, reminders });
  } catch (err) {
    console.error('Onboarding reminders error:', err);
    res.status(500).json({ error: 'Failed to get reminders' });
  }
});

// Auto-escalation endpoint
app.post('/api/tickets/:id/escalate', requireAuth, async (req, res) => {
  const ticketId = parseInt(req.params.id);
  
  try {
    const result = await escalateTicket(ticketId);
    if (result.success) {
      console.log(`[AUTO-ESCALATION] Ticket #${ticketId} escalated due to SLA violation`);
      res.json({ success: true, message: 'Ticket escalated successfully' });
    } else {
      res.status(404).json({ error: 'Ticket not found' });
    }
  } catch (err) {
    console.error('Escalation error:', err);
    res.status(500).json({ error: 'Failed to escalate ticket' });
  }
});

// ============ AUTOMATION HELPER FUNCTIONS ============

function autoDetectCategory(description) {
  const text = description.toLowerCase();
  
  if (text.includes('password') || text.includes('login') || text.includes('access')) {
    return 'Access & Authentication';
  }
  if (text.includes('hardware') || text.includes('laptop') || text.includes('computer')) {
    return 'Hardware';
  }
  if (text.includes('software') || text.includes('application') || text.includes('app')) {
    return 'Software';
  }
  if (text.includes('network') || text.includes('internet') || text.includes('wifi')) {
    return 'Network';
  }
  if (text.includes('email') || text.includes('outlook') || text.includes('mail')) {
    return 'Email & Communication';
  }
  
  return 'General IT Support';
}

function autoDetectPriority(description) {
  const text = description.toLowerCase();
  const urgentWords = ['urgent', 'critical', 'emergency', 'down', 'broken', 'immediately'];
  const highWords = ['important', 'asap', 'soon', 'blocking', 'cannot work'];
  
  if (urgentWords.some(word => text.includes(word))) {
    return 'urgent';
  }
  if (highWords.some(word => text.includes(word))) {
    return 'high';
  }
  
  return 'medium';
}

async function autoAssignTicket(category, priority) {
  // Simple assignment based on category
  const assignments = {
    'Access & Authentication': 'security-team@company.com',
    'Hardware': 'hardware-support@company.com',
    'Software': 'software-support@company.com',
    'Network': 'network-team@company.com',
    'Email & Communication': 'email-support@company.com'
  };
  
  return assignments[category] || 'it-support@company.com';
}

function assessAccessRisk(resource) {
  const lowRiskResources = [
    'figma', 'canva', 'notion', 'slack', 'zoom', 'teams', 
    'office365', 'google workspace', 'confluence', 'jira',
    'trello', 'asana', 'monday.com'
  ];
  
  const highRiskResources = [
    'aws', 'azure', 'gcp', 'production', 'database',
    'admin', 'root', 'billing', 'payroll', 'financial'
  ];
  
  const resourceLower = resource.toLowerCase();
  
  if (lowRiskResources.some(r => resourceLower.includes(r))) {
    return 'low';
  }
  if (highRiskResources.some(r => resourceLower.includes(r))) {
    return 'high';
  }
  
  return 'medium';
}

function getSLAThreshold(priority) {
  const thresholds = {
    'urgent': 4,    // 4 hours
    'high': 24,     // 24 hours
    'medium': 48,   // 48 hours
    'low': 72       // 72 hours
  };
  
  return thresholds[priority] || 48;
}

function calculateSLADueDate(priority) {
  const hours = getSLAThreshold(priority);
  const dueDate = new Date();
  dueDate.setHours(dueDate.getHours() + hours);
  return dueDate.toISOString();
}

async function escalateTicket(ticketId) {
  try {
    const result = await ticketService.escalateTicket(ticketId);
    
    if (result.success) {
      // Send escalation notification
      sendEscalationNotification(result.ticket);
    }
    
    return result;
  } catch (err) {
    console.error('Escalation error:', err);
    return { success: false, error: err.message };
  }
}

function sendOnboardingReminders(reminders) {
  // In a real implementation, this would send emails/notifications
  console.log('[ONBOARDING-REMINDERS]', {
    overdue: reminders.overdue.length,
    due_today: reminders.due_today.length,
    due_soon: reminders.due_soon.length
  });
  
  // Use existing notification service
  if (notificationService) {
    reminders.overdue.forEach(item => {
      notificationService.sendNotification({
        type: 'onboarding_overdue',
        message: `Onboarding task overdue: ${item.item} for ${item.employee_name}`,
        employee: item.employee_name
      });
    });
  }
}

function sendEscalationNotification(ticket) {
  // In a real implementation, this would send emails/notifications
  console.log(`[ESCALATION-NOTIFICATION] Ticket #${ticket.id} escalated - ${ticket.title}`);
  
  // Use existing notification service
  if (notificationService) {
    notificationService.sendNotification({
      type: 'ticket_escalated',
      ticket_id: ticket.id,
      message: `Ticket #${ticket.id} has been escalated due to SLA violation`,
      priority: 'urgent'
    });
  }
}

// ============ ENHANCED FEATURES ENDPOINTS ============

// Advanced Search API
app.post('/api/search/universal', requireAuth, async (req, res) => {
  if (!searchService) return res.status(503).json({ error: 'Search service not available' });
  
  const { query, entities, filters = {}, pagination = {} } = req.body;
  if (!query) return res.status(400).json({ error: 'Search query required' });
  
  try {
    const options = {
      ...filters,
      ...pagination,
      userId: req.session.userId,
      userRole: req.session.userRole || 'employee'
    };
    
    const results = await searchService.universalSearch(query, { entities, ...options });
    res.json(results);
  } catch (error) {
    console.error('[API] Search error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/search/suggestions', requireAuth, async (req, res) => {
  if (!searchService) return res.status(503).json({ error: 'Search service not available' });
  
  const { q: query, entity = 'all', limit = 5 } = req.query;
  
  try {
    const suggestions = await searchService.getSearchSuggestions(query, entity, parseInt(limit));
    res.json({ suggestions });
  } catch (error) {
    console.error('[API] Search suggestions error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/search/filters/:entity', requireAuth, async (req, res) => {
  if (!searchService) return res.status(503).json({ error: 'Search service not available' });
  
  const { entity } = req.params;
  const userRole = req.session.userRole || 'employee';
  
  try {
    const filters = await searchService.getFilterOptions(entity, userRole);
    res.json({ filters });
  } catch (error) {
    console.error('[API] Filter options error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Analytics API
app.get('/api/analytics/dashboard', requireAuth, async (req, res) => {
  if (!analyticsService) return res.status(503).json({ error: 'Analytics service not available' });
  
  const { timeRange = '30d' } = req.query;
  const userRole = req.session.userRole || 'employee';
  const userId = req.session.userId;
  
  try {
    const analytics = await analyticsService.getDashboardAnalytics(userRole, userId, timeRange);
    res.json(analytics);
  } catch (error) {
    console.error('[API] Analytics error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/analytics/trends', requireAuth, async (req, res) => {
  if (!analyticsService) return res.status(503).json({ error: 'Analytics service not available' });
  
  const { timeRange = '30d' } = req.query;
  const userRole = req.session.userRole || 'employee';
  const userId = req.session.userId;
  
  try {
    const trends = await analyticsService.getTrendAnalytics(userRole, userId, timeRange);
    res.json({ trends });
  } catch (error) {
    console.error('[API] Trends error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/analytics/realtime', requireAuth, async (req, res) => {
  if (!analyticsService) return res.status(503).json({ error: 'Analytics service not available' });
  
  try {
    const stats = await analyticsService.getRealtimeStats();
    res.json(stats);
  } catch (error) {
    console.error('[API] Realtime stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// External Integrations API
app.get('/api/integrations/status', requireAuth, async (req, res) => {
  if (!integrationsService) return res.status(503).json({ error: 'Integrations service not available' });
  
  // Only admin users can view integration status
  if (req.session.userRole !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  try {
    const status = await integrationsService.getIntegrationStatus();
    res.json(status);
  } catch (error) {
    console.error('[API] Integration status error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/integrations/sync/:ticketId', requireAuth, async (req, res) => {
  if (!integrationsService) return res.status(503).json({ error: 'Integrations service not available' });
  
  const { ticketId } = req.params;
  
  // Only IT staff and admin can force sync
  if (!['admin', 'it_staff'].includes(req.session.userRole)) {
    return res.status(403).json({ error: 'IT staff access required' });
  }
  
  try {
    const result = await integrationsService.forceSyncTicket(parseInt(ticketId));
    res.json(result);
  } catch (error) {
    console.error('[API] Force sync error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/integrations/logs', requireAuth, async (req, res) => {
  if (!integrationsService) return res.status(503).json({ error: 'Integrations service not available' });
  
  const { limit = 50, system } = req.query;
  
  // Only admin users can view integration logs
  if (req.session.userRole !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  try {
    const logs = await integrationsService.getSyncLogs(parseInt(limit), system);
    res.json({ logs });
  } catch (error) {
    console.error('[API] Integration logs error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Email Service API
app.get('/api/email/stats', requireAuth, async (req, res) => {
  if (!emailService) return res.status(503).json({ error: 'Email service not available' });
  
  // Only admin users can view email stats
  if (req.session.userRole !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  try {
    const stats = emailService.getStats();
    res.json(stats);
  } catch (error) {
    console.error('[API] Email stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/email/test', requireAuth, async (req, res) => {
  if (!emailService) return res.status(503).json({ error: 'Email service not available' });
  
  // Only admin users can test email
  if (req.session.userRole !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  try {
    const result = await emailService.testConnection();
    res.json(result);
  } catch (error) {
    console.error('[API] Email test error:', error);
    res.status(500).json({ error: error.message });
  }
});

// WebSocket Stats API
app.get('/api/websocket/stats', requireAuth, async (req, res) => {
  if (!websocketService) return res.status(503).json({ error: 'WebSocket service not available' });
  
  try {
    const stats = websocketService.getStats();
    const connectedUsers = websocketService.getConnectedUsers();
    res.json({ stats, connectedUsers });
  } catch (error) {
    console.error('[API] WebSocket stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Cache Management API
app.get('/api/cache/stats', requireAuth, async (req, res) => {
  // Only admin users can view cache stats
  if (req.session.userRole !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  try {
    const stats = await cache.getStats();
    res.json(stats);
  } catch (error) {
    console.error('[API] Cache stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/cache/clear', requireAuth, async (req, res) => {
  // Only admin users can clear cache
  if (req.session.userRole !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  try {
    await cache.clear();
    res.json({ success: true, message: 'Cache cleared successfully' });
  } catch (error) {
    console.error('[API] Cache clear error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Enhanced ticket creation with integrations and notifications
const originalTicketCreate = app.post;
app.post('/api/tickets', requireAuth, async (req, res) => {
  try {
    const { title, description, priority = 'medium', category } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });

    const ticket = await ticketService.createTicket({
      title: title.trim(),
      description: description?.trim() || '',
      priority,
      category,
      user_id: req.session.userId
    });

    // Send real-time notification
    if (websocketService) {
      websocketService.notifyTicketCreated(ticket, req.session.userId);
    }

    // Send email notification
    if (emailService && req.session.userEmail) {
      emailService.sendTicketCreatedEmail(ticket, req.session.userEmail);
    }

    // Sync to external systems
    if (integrationsService) {
      setTimeout(() => {
        integrationsService.syncTicketToExternalSystems(ticket).catch(err => {
          console.error('[SYNC] Failed to sync ticket to external systems:', err);
        });
      }, 1000);
    }

    res.json(ticket);
  } catch (error) {
    console.error('[API] Enhanced ticket creation error:', error);
    res.status(500).json({ error: error.message });
  }
});

server.listen(port, () => {
  console.log('Server running on', port);
  console.log('[AUTOMATION] Advanced features enabled:');
  console.log('  ✓ Auto Ticket Generation');
  console.log('  ✓ Low-Risk Access Auto-Approval');
  console.log('  ✓ SLA Monitoring & Escalation');
  console.log('  ✓ Onboarding Cadence Reminders');
  console.log('[ENHANCED] New features available:');
  console.log('  ✓ Redis Persistent Cache');
  console.log('  ✓ WebSocket Real-time Updates');
  console.log('  ✓ Email Notifications');
  console.log('  ✓ Advanced Search & Filtering');
  console.log('  ✓ Analytics Dashboard');
  console.log('  ✓ External System Integrations');
});

// ============ LANGCHAIN AGENT ENDPOINTS ============
app.post('/api/agents/orchestrate', requireAuth, async (req, res) => {
  const { message, context = {} } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });
  
  if (!agentRouter) {
    return res.status(503).json({ error: 'LangChain agents not available - OPENAI_API_KEY not configured' });
  }
  
  try {
    const enrichedContext = {
      ...context,
      userId: req.session.userId,
      userRole: context.userRole || 'employee',
      timestamp: new Date().toISOString()
    };
    
    const result = await agentRouter.route(message, enrichedContext);
    
    res.json({
      success: result.success,
      message,
      routing: result.routing,
      response: result.primaryResult || result.results?.[0]?.response || 'No response generated',
      results: result.results,
      executionTime: result.executionTime,
      agentsUsed: result.agentsUsed
    });
  } catch (err) {
    console.error('agent orchestration error', err);
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/agents/analytics', requireAuth, (req, res) => {
  if (!agentRouter) {
    return res.status(503).json({ error: 'LangChain agents not available' });
  }
  
  try {
    const analytics = agentRouter.getRoutingAnalytics();
    res.json({ success: true, analytics });
  } catch (err) {
    console.error('agent analytics error', err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.get('/api/agents/available', requireAuth, (req, res) => {
  if (!agentRouter) {
    return res.status(503).json({ error: 'LangChain agents not available' });
  }
  
  try {
    const agents = agentRouter.getAvailableAgents();
    res.json({ agents });
  } catch (err) {
    console.error('available agents error', err);
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/agents/force-route', requireAuth, async (req, res) => {
  const { agentName, message, context = {} } = req.body;
  if (!agentName || !message) {
    return res.status(400).json({ error: 'Agent name and message required' });
  }
  
  if (!agentRouter) {
    return res.status(503).json({ error: 'LangChain agents not available' });
  }
  
  try {
    const result = await agentRouter.forceRoute(agentName, message, {
      ...context,
      userId: req.session.userId
    });
    res.json({ result });
  } catch (err) {
    console.error('force route error', err);
    res.status(500).json({ error: String(err) });
  }
});

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

// Test notification endpoint
app.post('/api/notifications/test', requireAuth, async (req, res) => {
  const { type } = req.body;
  try {
    const result = await notificationService.sendTestNotification(type || 'webhook');
    res.json({ success: true, result });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Get notification configuration
app.get('/api/notifications/config', requireAuth, (req, res) => {
  try {
    const config = notificationService.getConfig();
    res.json({ config });
  } catch (e) {
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

setInterval(async () => {
  try {
    const r = agentService.monitorSLA();
    if (r.escalated) {
      console.log('[Agent] Escalated', r.escalated, 'tickets');
      
      // Send notifications for escalated tickets
      try {
        const escalatedTickets = ticketService.getAllTickets({ status: 'open' }).filter(t => t.escalated_at);
        for (const ticket of escalatedTickets.slice(-r.escalated)) { // Get recently escalated
          await notificationService.sendEscalationNotification(ticket, {
            escalated_at: ticket.escalated_at,
            escalation_level: ticket.escalation_level
          });
        }
      } catch (notifErr) {
        console.warn('[Agent] notification error', notifErr.message);
      }
    }
  } catch (e) { console.warn('[Agent] sla monitor error', e.message); }
}, TEN_MIN);

setInterval(() => {
  try {
    const r = agentService.dispatchOnboardingReminders();
    if (r.sent) console.log('[Agent] Sent', r.sent, 'onboarding reminders');
  } catch (e) { console.warn('[Agent] reminder dispatch error', e.message); }
}, FIFTEEN_MIN);
