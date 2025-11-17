const BaseAgent = require('./BaseAgent');
const ticketService = require('../ticketService');
const { PromptTemplate } = require('@langchain/core/prompts');

/**
 * IT Support Agent - Specialized for technical support and troubleshooting
 * Handles hardware, software, network issues with structured diagnosis
 */
class ITSupportAgent extends BaseAgent {
  constructor(config = {}) {
    super({
      name: 'ITSupportAgent',
      description: 'Specialized agent for IT support, troubleshooting, and technical issue resolution',
      ...config
    });
    
    this.supportPrompt = this.createPrompt(`
You are an expert IT Support specialist. Analyze the following technical issue and provide structured assistance.

Issue Description: {issue}
User Role: {userRole}
Priority Level: {priority}
Previous Context: {context}

Please provide:
1. **Immediate Diagnosis**: What is likely causing this issue?
2. **Priority Assessment**: Is this urgent/high/medium/low priority and why?
3. **Step-by-Step Resolution**: Detailed troubleshooting steps
4. **Escalation Criteria**: When should this be escalated?
5. **Prevention**: How to avoid this issue in the future

Format your response as a structured technical support response.
Be concise but thorough. If this requires immediate escalation, start with "ESCALATE:".
`);

    this.chain = this.createChain(this.supportPrompt);
  }

  canHandle(input, context = {}) {
    const text = input.toLowerCase();
    const supportKeywords = [
      'error', 'bug', 'crash', 'not working', 'broken', 'failed', 'issue',
      'computer', 'laptop', 'software', 'hardware', 'network', 'wifi',
      'login', 'password', 'access', 'printer', 'email', 'vpn'
    ];
    return supportKeywords.some(keyword => text.includes(keyword));
  }

  async run(input, context) {
    const result = await this.chain.invoke({
      issue: input,
      userRole: context.userRole || 'employee',
      priority: context.priority || 'medium',
      context: context.previousMessages || 'No previous context'
    });

    // Check if escalation is needed
    const needsEscalation = result.toLowerCase().startsWith('escalate:');
    
    // Auto-create ticket if this is a new issue
    if (context.userId && context.autoCreateTicket !== false) {
      const ticketData = {
        title: input.length > 50 ? input.substring(0, 50) + '...' : input,
        description: `${input}\n\n--- IT Support Agent Analysis ---\n${result}`,
        priority: this.extractPriority(result) || context.priority || 'medium',
        category: this.extractCategory(input),
        status: needsEscalation ? 'escalated' : 'open'
      };
      
      try {
        const ticketId = ticketService.createTicket(context.userId, ticketData);
        return {
          analysis: result,
          ticketCreated: true,
          ticketId,
          escalated: needsEscalation,
          category: ticketData.category,
          recommendedPriority: ticketData.priority
        };
      } catch (error) {
        return {
          analysis: result,
          ticketCreated: false,
          error: `Failed to create ticket: ${error.message}`,
          escalated: needsEscalation
        };
      }
    }

    return {
      analysis: result,
      escalated: needsEscalation,
      category: this.extractCategory(input),
      recommendedPriority: this.extractPriority(result) || 'medium'
    };
  }

  extractPriority(analysisText) {
    const text = analysisText.toLowerCase();
    if (text.includes('urgent') || text.includes('critical') || text.includes('high priority')) return 'high';
    if (text.includes('low priority') || text.includes('minor')) return 'low';
    return 'medium';
  }

  extractCategory(issueText) {
    const text = issueText.toLowerCase();
    if (/computer|laptop|hardware|device|keyboard|mouse|monitor/.test(text)) return 'hardware';
    if (/network|wifi|internet|vpn|connection/.test(text)) return 'network';
    if (/software|application|program|app|bug|crash/.test(text)) return 'software';
    if (/login|password|access|permission|account/.test(text)) return 'access';
    if (/email|outlook|calendar|office/.test(text)) return 'email';
    if (/printer|printing|scanner/.test(text)) return 'printing';
    return 'general';
  }
}

module.exports = ITSupportAgent;