// Natural Language Understanding for Intent Detection
class IntentDetector {
  constructor() {
    // Intent patterns using regex and keywords
    this.intents = {
      access_request: {
        keywords: ['access', 'need', 'permission', 'grant', 'allow', 'enable'],
        patterns: [
          /need access to (.+)/i,
          /can I (?:get|have) access to (.+)/i,
          /(?:grant|give) (?:me )?access to (.+)/i,
          /I need (.+) access/i
        ],
        confidence: 0.8
      },
      ticket_creation: {
        keywords: ['broken', 'not working', 'issue', 'problem', 'help', 'fix', 'repair', 'error'],
        patterns: [
          /(.+) (?:is|isn't|not) working/i,
          /(?:having|got) (?:a )?problem with (.+)/i,
          /(.+) broken/i,
          /issue with (.+)/i
        ],
        confidence: 0.7
      },
      ticket_query: {
        keywords: ['show', 'list', 'view', 'display', 'tickets', 'open', 'pending'],
        patterns: [
          /show (?:me )?(?:all |the )?(?:open )?tickets/i,
          /(?:list|display) tickets/i,
          /tickets from (.+)/i,
          /what (?:are|is) (?:the|my) tickets/i
        ],
        confidence: 0.75
      },
      onboarding_query: {
        keywords: ['onboarding', 'new hire', 'checklist', 'employee', 'orientation'],
        patterns: [
          /onboarding (?:for|checklist)/i,
          /new (?:hire|employee) (.+)/i,
          /show (?:me )?(?:the )?(?:onboarding )?checklist/i
        ],
        confidence: 0.8
      },
      greeting: {
        keywords: ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'greetings'],
        patterns: [
          /^(?:hello|hi|hey|greetings)/i,
          /good (?:morning|afternoon|evening)/i
        ],
        confidence: 0.9
      },
      help: {
        keywords: ['help', 'what can you do', 'how', 'guide', 'assist'],
        patterns: [
          /(?:can you )?help(?: me)?/i,
          /what can you do/i,
          /how (?:do I|to)/i
        ],
        confidence: 0.85
      },
      status_check: {
        keywords: ['status', 'state', 'progress', 'update'],
        patterns: [
          /(?:what's|what is) (?:the )?status/i,
          /check status of (.+)/i,
          /status (?:on|of) (.+)/i
        ],
        confidence: 0.7
      }
    };
  }

  // Detect intent from user message
  detect(message) {
    const lowerMessage = message.toLowerCase();
    let bestMatch = {
      intent: 'unknown',
      confidence: 0,
      entities: {}
    };

    for (const [intentName, intentData] of Object.entries(this.intents)) {
      let score = 0;
      const entities = {};

      // Check keywords
      const keywordMatches = intentData.keywords.filter(kw => 
        lowerMessage.includes(kw.toLowerCase())
      );
      score += (keywordMatches.length / intentData.keywords.length) * 0.4;

      // Check patterns
      for (const pattern of intentData.patterns) {
        const match = message.match(pattern);
        if (match) {
          score += 0.6;
          if (match[1]) {
            entities.extracted = match[1].trim();
          }
          break;
        }
      }

      // Apply confidence modifier
      score *= intentData.confidence;

      if (score > bestMatch.confidence) {
        bestMatch = {
          intent: intentName,
          confidence: score,
          entities
        };
      }
    }

    return bestMatch;
  }

  // Generate suggested actions based on intent
  getSuggestions(intent) {
    const suggestions = {
      access_request: [
        'I need access to Figma',
        'Can I get access to GitHub?',
        'Grant me access to AWS console'
      ],
      ticket_creation: [
        'My laptop is not working',
        'Issue with printer on 3rd floor',
        'Email client keeps crashing'
      ],
      ticket_query: [
        'Show open tickets from this week',
        'List all my tickets',
        'Display pending tickets'
      ],
      onboarding_query: [
        'Show onboarding checklist for new hire',
        'New employee onboarding steps',
        'Create onboarding for Sarah'
      ],
      greeting: [
        'What can you help me with?',
        'Show me what you can do'
      ],
      unknown: [
        'I need access to Figma',
        'Show open tickets',
        'Create onboarding checklist'
      ]
    };

    return suggestions[intent] || suggestions.unknown;
  }
}

module.exports = new IntentDetector();
