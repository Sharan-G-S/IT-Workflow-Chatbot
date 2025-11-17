const BaseAgent = require('./BaseAgent');
const { PromptTemplate } = require('@langchain/core/prompts');

/**
 * Knowledge Base Agent - Provides instant access to IT knowledge, documentation, and best practices
 * Handles documentation queries, troubleshooting guides, and knowledge management
 */
class KnowledgeBaseAgent extends BaseAgent {
  constructor(config = {}) {
    super({
      name: 'KnowledgeBaseAgent',
      description: 'Specialized agent for knowledge base queries, documentation, and IT best practices guidance',
      ...config
    });
    
    this.knowledgePrompt = this.createPrompt(`
You are an expert Knowledge Base specialist with comprehensive access to IT documentation, best practices, and troubleshooting guides.

Knowledge Query: {query}
Context: {context}
Department: {department}
User Role: {userRole}
Urgency Level: {urgency}

Based on the query, provide comprehensive information including:

1. **Direct Answer**: Clear, actionable response to the specific question
2. **Related Procedures**: Step-by-step procedures or documentation links
3. **Best Practices**: Industry standards and recommended approaches
4. **Common Issues**: Related problems and their solutions
5. **Prerequisites**: What needs to be in place before implementation
6. **Risk Considerations**: Potential risks and mitigation strategies
7. **Additional Resources**: Related documentation, tools, or contacts

Knowledge Areas:
- IT Policies and Procedures
- Security guidelines and compliance
- Software installation and configuration
- Hardware setup and troubleshooting  
- Network configuration and protocols
- Backup and recovery procedures
- User account management
- System maintenance schedules
- Vendor contact information
- Emergency procedures and escalation paths

Format as a structured knowledge base response with clear sections.
Include specific commands, configuration snippets, or procedures when applicable.
Prioritize practical, actionable information over theoretical explanations.
`);

    this.chain = this.createChain(this.knowledgePrompt);
    
    // Initialize knowledge base with common IT documentation
    this.initializeKnowledgeBase();
  }

  /**
   * Initialize knowledge base with common IT procedures and documentation
   */
  initializeKnowledgeBase() {
    this.knowledgeBase = {
      policies: {
        'password_policy': {
          title: 'Password Policy Requirements',
          content: 'Passwords must be at least 12 characters, include uppercase, lowercase, numbers, and special characters. Must be changed every 90 days.',
          category: 'security',
          lastUpdated: '2024-11-01'
        },
        'software_installation': {
          title: 'Software Installation Policy',
          content: 'All software installations require IT approval. Use approved software catalog or submit request through IT portal.',
          category: 'compliance',
          lastUpdated: '2024-10-15'
        },
        'remote_access': {
          title: 'Remote Access Guidelines',
          content: 'VPN required for all remote connections. Multi-factor authentication mandatory. No personal devices for company data access.',
          category: 'security',
          lastUpdated: '2024-11-10'
        }
      },
      procedures: {
        'vpn_setup': {
          title: 'VPN Setup Instructions',
          steps: [
            'Download VPN client from IT portal',
            'Install client with admin credentials',
            'Import configuration file provided by IT',
            'Test connection with credentials',
            'Configure auto-connect if approved'
          ],
          category: 'network',
          difficulty: 'beginner'
        },
        'password_reset': {
          title: 'Password Reset Procedure',
          steps: [
            'Navigate to password reset portal',
            'Enter username or email address', 
            'Complete identity verification',
            'Check email for reset instructions',
            'Create new password following policy',
            'Test login with new credentials'
          ],
          category: 'accounts',
          difficulty: 'beginner'
        },
        'software_update': {
          title: 'Software Update Process',
          steps: [
            'Check for available updates in software center',
            'Review update notes and compatibility',
            'Schedule update during maintenance window',
            'Create backup if required',
            'Install update and restart if needed',
            'Test functionality after update'
          ],
          category: 'maintenance',
          difficulty: 'intermediate'
        }
      },
      troubleshooting: {
        'wifi_connection': {
          title: 'WiFi Connection Issues',
          symptoms: ['Cannot connect to WiFi', 'Intermittent connectivity', 'Slow internet speed'],
          solutions: [
            'Restart WiFi adapter in device manager',
            'Forget and reconnect to network',
            'Update network drivers',
            'Reset network settings',
            'Contact IT if issue persists'
          ],
          category: 'network'
        },
        'email_sync': {
          title: 'Email Synchronization Problems',
          symptoms: ['Emails not syncing', 'Old emails missing', 'Cannot send emails'],
          solutions: [
            'Check internet connection',
            'Verify account settings',
            'Clear email cache',
            'Reconfigure account if needed',
            'Contact IT for server issues'
          ],
          category: 'email'
        },
        'printer_offline': {
          title: 'Printer Offline Issues',
          symptoms: ['Printer shows offline', 'Cannot print documents', 'Print queue stuck'],
          solutions: [
            'Check printer power and connections',
            'Restart print spooler service',
            'Remove and re-add printer',
            'Update printer drivers',
            'Check network connectivity'
          ],
          category: 'hardware'
        }
      },
      contacts: {
        'it_helpdesk': {
          name: 'IT Helpdesk',
          phone: '+1-555-0123',
          email: 'helpdesk@company.com',
          hours: '8 AM - 6 PM EST, Mon-Fri',
          emergency: '+1-555-0911'
        },
        'security_team': {
          name: 'Security Team',
          phone: '+1-555-0456',
          email: 'security@company.com',
          hours: '24/7 for incidents',
          emergency: '+1-555-0999'
        },
        'network_operations': {
          name: 'Network Operations Center',
          phone: '+1-555-0789',
          email: 'noc@company.com',
          hours: '24/7 monitoring',
          emergency: '+1-555-0888'
        }
      }
    };
  }

  /**
   * Check if this agent can handle the knowledge-related request
   */
  canHandle(input, context) {
    const knowledgeKeywords = [
      'how to', 'procedure', 'policy', 'documentation', 'guide', 'manual',
      'instructions', 'setup', 'configure', 'install', 'troubleshoot',
      'best practice', 'standard', 'protocol', 'process', 'workflow',
      'contact', 'phone number', 'email', 'help', 'support', 'knowledge',
      'information', 'documentation', 'wiki', 'faq', 'tutorial'
    ];
    
    const text = input.toLowerCase();
    return knowledgeKeywords.some(keyword => text.includes(keyword)) ||
           input.includes('?') || // Questions often indicate knowledge requests
           text.startsWith('what') || text.startsWith('how') || text.startsWith('where');
  }

  /**
   * Execute knowledge base query
   */
  async execute(input, context = {}) {
    try {
      const result = await this.run(input, context);
      return {
        success: true,
        agent: this.name,
        response: result.knowledge,
        metadata: {
          knowledgeType: result.knowledgeType,
          relatedArticles: result.relatedArticles,
          contacts: result.contacts,
          procedures: result.procedures
        }
      };
    } catch (error) {
      return {
        success: false,
        agent: this.name,
        error: error.message,
        fallback: 'Knowledge base query failed. Please contact IT helpdesk for assistance or check the company wiki.'
      };
    }
  }

  /**
   * Main knowledge base query method
   */
  async run(input, context) {
    // Search knowledge base for relevant information
    const relevantKnowledge = this.searchKnowledgeBase(input);
    
    const result = await this.chain.invoke({
      query: input,
      context: JSON.stringify(relevantKnowledge, null, 2),
      department: context.department || 'General IT',
      userRole: context.userRole || 'Employee',
      urgency: context.urgency || 'normal'
    });

    const knowledgeType = this.identifyKnowledgeType(input);
    const relatedArticles = this.findRelatedArticles(input, knowledgeType);
    const contacts = this.getRelevantContacts(knowledgeType);
    const procedures = this.getRelevantProcedures(input);

    // Log knowledge access for analytics
    this.logKnowledgeAccess(input, knowledgeType, context);

    return {
      knowledge: result,
      knowledgeType,
      relatedArticles,
      contacts,
      procedures,
      searchResults: relevantKnowledge
    };
  }

  /**
   * Search internal knowledge base
   */
  searchKnowledgeBase(query) {
    const results = {
      policies: [],
      procedures: [],
      troubleshooting: [],
      contacts: []
    };

    const searchTerms = query.toLowerCase().split(' ');
    
    // Search policies
    Object.entries(this.knowledgeBase.policies).forEach(([key, policy]) => {
      if (searchTerms.some(term => 
        policy.title.toLowerCase().includes(term) || 
        policy.content.toLowerCase().includes(term) ||
        policy.category.toLowerCase().includes(term)
      )) {
        results.policies.push(policy);
      }
    });

    // Search procedures
    Object.entries(this.knowledgeBase.procedures).forEach(([key, procedure]) => {
      if (searchTerms.some(term => 
        procedure.title.toLowerCase().includes(term) || 
        procedure.category.toLowerCase().includes(term) ||
        procedure.steps.some(step => step.toLowerCase().includes(term))
      )) {
        results.procedures.push(procedure);
      }
    });

    // Search troubleshooting guides
    Object.entries(this.knowledgeBase.troubleshooting).forEach(([key, guide]) => {
      if (searchTerms.some(term => 
        guide.title.toLowerCase().includes(term) || 
        guide.category.toLowerCase().includes(term) ||
        guide.symptoms.some(symptom => symptom.toLowerCase().includes(term)) ||
        guide.solutions.some(solution => solution.toLowerCase().includes(term))
      )) {
        results.troubleshooting.push(guide);
      }
    });

    // Search contacts
    Object.entries(this.knowledgeBase.contacts).forEach(([key, contact]) => {
      if (searchTerms.some(term => 
        contact.name.toLowerCase().includes(term) ||
        key.toLowerCase().includes(term)
      )) {
        results.contacts.push(contact);
      }
    });

    return results;
  }

  /**
   * Identify the type of knowledge being requested
   */
  identifyKnowledgeType(input) {
    const text = input.toLowerCase();
    
    if (text.includes('policy') || text.includes('rule') || text.includes('requirement')) {
      return 'policy';
    }
    if (text.includes('how to') || text.includes('procedure') || text.includes('step')) {
      return 'procedure';
    }
    if (text.includes('problem') || text.includes('issue') || text.includes('trouble') || text.includes('not working')) {
      return 'troubleshooting';
    }
    if (text.includes('contact') || text.includes('phone') || text.includes('email') || text.includes('call')) {
      return 'contact';
    }
    if (text.includes('best practice') || text.includes('standard') || text.includes('guideline')) {
      return 'best_practice';
    }
    
    return 'general';
  }

  /**
   * Find related articles based on the query
   */
  findRelatedArticles(query, knowledgeType) {
    const articles = [];
    
    // Add relevant articles based on knowledge type and content
    if (knowledgeType === 'procedure' || query.toLowerCase().includes('setup')) {
      articles.push({
        title: 'IT Setup Procedures',
        url: '/kb/setup-procedures',
        relevance: 'high'
      });
    }
    
    if (knowledgeType === 'troubleshooting' || query.toLowerCase().includes('problem')) {
      articles.push({
        title: 'Common IT Issues and Solutions',
        url: '/kb/troubleshooting-guide',
        relevance: 'high'
      });
    }
    
    return articles;
  }

  /**
   * Get relevant contacts based on knowledge type
   */
  getRelevantContacts(knowledgeType) {
    const contacts = [];
    
    switch (knowledgeType) {
      case 'security':
        contacts.push(this.knowledgeBase.contacts.security_team);
        break;
      case 'network':
        contacts.push(this.knowledgeBase.contacts.network_operations);
        break;
      default:
        contacts.push(this.knowledgeBase.contacts.it_helpdesk);
    }
    
    return contacts;
  }

  /**
   * Get relevant procedures based on the query
   */
  getRelevantProcedures(query) {
    const procedures = [];
    const text = query.toLowerCase();
    
    if (text.includes('password')) {
      procedures.push(this.knowledgeBase.procedures.password_reset);
    }
    if (text.includes('vpn') || text.includes('remote')) {
      procedures.push(this.knowledgeBase.procedures.vpn_setup);
    }
    if (text.includes('update') || text.includes('software')) {
      procedures.push(this.knowledgeBase.procedures.software_update);
    }
    
    return procedures;
  }

  /**
   * Log knowledge access for analytics
   */
  logKnowledgeAccess(query, knowledgeType, context) {
    console.log(`[KNOWLEDGE-AGENT] Query: "${query}" | Type: ${knowledgeType} | User: ${context.userId || 'anonymous'}`);
  }

  /**
   * Get agent metadata
   */
  getMetadata() {
    return {
      name: this.name,
      description: this.description,
      capabilities: [
        'IT policy and procedure queries',
        'Troubleshooting guide access',
        'Contact information lookup',
        'Best practices guidance',
        'Documentation search',
        'Step-by-step instructions'
      ],
      specializations: [
        'IT policies and compliance',
        'Setup and configuration procedures',
        'Troubleshooting methodologies',
        'Security guidelines',
        'Network configuration',
        'Software installation guides'
      ],
      knowledgeAreas: Object.keys(this.knowledgeBase)
    };
  }

  /**
   * Add new knowledge to the base (for dynamic updates)
   */
  addKnowledge(category, key, content) {
    if (this.knowledgeBase[category]) {
      this.knowledgeBase[category][key] = {
        ...content,
        lastUpdated: new Date().toISOString()
      };
      console.log(`[KNOWLEDGE-AGENT] Added new ${category} knowledge: ${key}`);
      return true;
    }
    return false;
  }

  /**
   * Update existing knowledge
   */
  updateKnowledge(category, key, content) {
    if (this.knowledgeBase[category] && this.knowledgeBase[category][key]) {
      this.knowledgeBase[category][key] = {
        ...this.knowledgeBase[category][key],
        ...content,
        lastUpdated: new Date().toISOString()
      };
      console.log(`[KNOWLEDGE-AGENT] Updated ${category} knowledge: ${key}`);
      return true;
    }
    return false;
  }
}

module.exports = KnowledgeBaseAgent;