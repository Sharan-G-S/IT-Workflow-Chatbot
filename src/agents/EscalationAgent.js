const BaseAgent = require('./BaseAgent');
const ticketService = require('../ticketService');
const accessRequestService = require('../accessRequestService');
const notificationService = require('../notificationService');
const { PromptTemplate } = require('@langchain/core/prompts');

/**
 * Escalation Agent - Specialized for handling escalations and critical issues
 * Manages SLA violations, urgent matters, and coordination between teams
 */
class EscalationAgent extends BaseAgent {
  constructor(config = {}) {
    super({
      name: 'EscalationAgent',
      description: 'Specialized agent for escalation management, urgent issues, and cross-team coordination',
      ...config
    });
    
    this.escalationPrompt = this.createPrompt(`
You are an Escalation Manager handling critical IT issues. Analyze the situation and provide escalation guidance.

Issue Details: {issue}
Severity: {severity}
Time Elapsed: {timeElapsed}
Previous Actions: {previousActions}
Business Impact: {businessImpact}
User Role: {userRole}

Please provide:
1. **Urgency Assessment**: Critical/High/Medium/Low and reasoning
2. **Escalation Path**: Who should be notified immediately
3. **Communication Plan**: What stakeholders need updates
4. **Resolution Strategy**: Immediate actions and longer-term plan
5. **SLA Implications**: How does this affect service level agreements
6. **Resource Requirements**: What teams/resources are needed
7. **Risk Mitigation**: How to prevent similar issues

Escalation Matrix:
- Critical (P0): Production down, security breach, data loss
- High (P1): Major functionality impaired, many users affected
- Medium (P2): Minor functionality issues, workarounds available
- Low (P3): Cosmetic issues, enhancement requests

Format as structured escalation response. Start with priority level (P0/P1/P2/P3).
`);

    this.chain = this.createChain(this.escalationPrompt);
  }

  canHandle(input, context = {}) {
    const text = input.toLowerCase();
    const escalationKeywords = [
      'urgent', 'critical', 'emergency', 'down', 'outage', 'escalate',
      'production', 'security breach', 'data loss', 'system failure',
      'major issue', 'high priority', 'immediate attention'
    ];
    const hasSeverityContext = context.severity === 'high' || context.priority === 'high';
    const hasTimeContext = context.timeElapsed && parseInt(context.timeElapsed) > 240; // 4+ hours
    
    return escalationKeywords.some(keyword => text.includes(keyword)) || 
           hasSeverityContext || hasTimeContext;
  }

  async run(input, context) {
    const result = await this.chain.invoke({
      issue: input,
      severity: context.severity || context.priority || 'unknown',
      timeElapsed: context.timeElapsed || 'unknown',
      previousActions: context.previousActions || 'No previous actions recorded',
      businessImpact: context.businessImpact || 'Unknown business impact',
      userRole: context.userRole || 'employee'
    });

    const priorityLevel = this.extractPriorityLevel(result);
    const urgencyScore = this.calculateUrgencyScore(result, context);
    const escalationPath = this.extractEscalationPath(result);
    const requiredNotifications = this.determineNotifications(priorityLevel, context);

    // Handle different escalation scenarios
    const actions = [];
    
    // Update existing ticket if provided
    if (context.ticketId) {
      try {
        ticketService.updateTicket(context.ticketId, {
          priority: this.priorityLevelToString(priorityLevel),
          escalated_at: new Date().toISOString(),
          escalation_level: (context.currentEscalationLevel || 0) + 1,
          status: 'escalated'
        });
        actions.push(`Updated ticket ${context.ticketId} with escalation`);
      } catch (error) {
        actions.push(`Failed to update ticket: ${error.message}`);
      }
    }

    // Send notifications for critical/high priority issues
    if (priorityLevel <= 1 && requiredNotifications.length > 0) {
      try {
        for (const notification of requiredNotifications) {
          await notificationService.sendNotification({
            type: notification.type,
            recipient: notification.recipient,
            subject: `Escalation Alert: ${priorityLevel === 0 ? 'CRITICAL' : 'HIGH'} Priority Issue`,
            message: `Issue: ${input}\\n\\nEscalation Analysis:\\n${result}`,
            urgency: priorityLevel === 0 ? 'critical' : 'high'
          });
          actions.push(`Sent ${notification.type} notification to ${notification.recipient}`);
        }
      } catch (error) {
        actions.push(`Failed to send notifications: ${error.message}`);
      }
    }

    // Create escalation record
    const escalationRecord = {
      originalIssue: input,
      priorityLevel: this.priorityLevelToString(priorityLevel),
      urgencyScore,
      escalationPath,
      analysisResult: result,
      actionsTriggered: actions,
      timestamp: new Date().toISOString()
    };

    return {
      analysis: result,
      priorityLevel: this.priorityLevelToString(priorityLevel),
      urgencyScore,
      escalationPath,
      notificationsSent: actions.filter(a => a.includes('notification')).length,
      actionsTriggered: actions,
      escalationRecord,
      requiresImmediateAction: priorityLevel <= 1,
      estimatedResolutionTime: this.estimateResolutionTime(priorityLevel)
    };
  }

  extractPriorityLevel(analysisText) {
    const text = analysisText.toLowerCase();
    if (text.includes('p0') || text.includes('critical')) return 0;
    if (text.includes('p1') || text.includes('high')) return 1;
    if (text.includes('p2') || text.includes('medium')) return 2;
    if (text.includes('p3') || text.includes('low')) return 3;
    return 2; // Default to medium
  }

  priorityLevelToString(level) {
    const levels = ['critical', 'high', 'medium', 'low'];
    return levels[level] || 'medium';
  }

  calculateUrgencyScore(analysisText, context) {
    let score = 5; // Base score
    
    // Increase score based on keywords
    const text = analysisText.toLowerCase();
    if (text.includes('production') || text.includes('outage')) score += 3;
    if (text.includes('security') || text.includes('breach')) score += 4;
    if (text.includes('data loss') || text.includes('corruption')) score += 4;
    if (text.includes('many users') || text.includes('widespread')) score += 2;
    
    // Increase score based on time elapsed
    if (context.timeElapsed) {
      const hours = parseInt(context.timeElapsed) / 60;
      if (hours > 4) score += 2;
      if (hours > 8) score += 3;
    }
    
    return Math.min(score, 10); // Cap at 10
  }

  extractEscalationPath(analysisText) {
    const path = [];
    const text = analysisText.toLowerCase();
    
    if (text.includes('manager') || text.includes('supervisor')) {
      path.push('Direct Manager');
    }
    if (text.includes('it director') || text.includes('it manager')) {
      path.push('IT Director');
    }
    if (text.includes('security') || text.includes('ciso')) {
      path.push('Security Team');
    }
    if (text.includes('executive') || text.includes('ceo') || text.includes('senior leadership')) {
      path.push('Executive Team');
    }
    
    return path.length > 0 ? path : ['Direct Manager', 'IT Director'];
  }

  determineNotifications(priorityLevel, context) {
    const notifications = [];
    
    if (priorityLevel === 0) { // Critical
      notifications.push(
        { type: 'email', recipient: 'it-director@company.com' },
        { type: 'webhook', recipient: 'incident-response-channel' }
      );
    } else if (priorityLevel === 1) { // High
      notifications.push(
        { type: 'email', recipient: 'it-manager@company.com' }
      );
    }
    
    return notifications;
  }

  estimateResolutionTime(priorityLevel) {
    const estimates = {
      0: '2-4 hours', // Critical
      1: '4-8 hours', // High
      2: '1-2 days',  // Medium
      3: '3-5 days'   // Low
    };
    return estimates[priorityLevel] || '1-2 days';
  }

  // Method to handle automatic SLA escalations
  async handleSLAViolation(ticketId, violationType, timeElapsed) {
    const context = {
      ticketId,
      severity: 'high',
      timeElapsed: timeElapsed.toString(),
      previousActions: `SLA violation detected: ${violationType}`,
      businessImpact: 'Service Level Agreement violation'
    };
    
    const input = `SLA Violation: Ticket ${ticketId} has exceeded ${violationType} threshold after ${Math.round(timeElapsed/60)} hours`;
    
    return await this.run(input, context);
  }
}

module.exports = EscalationAgent;