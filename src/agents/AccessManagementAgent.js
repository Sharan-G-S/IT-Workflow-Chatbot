const BaseAgent = require('./BaseAgent');
const accessRequestService = require('../accessRequestService');
const { PromptTemplate } = require('@langchain/core/prompts');

/**
 * Access Management Agent - Specialized for resource access requests and permissions
 * Handles access analysis, risk assessment, and automated approvals
 */
class AccessManagementAgent extends BaseAgent {
  constructor(config = {}) {
    super({
      name: 'AccessManagementAgent',
      description: 'Specialized agent for access management, permissions, and security compliance',
      ...config
    });
    
    this.accessPrompt = this.createPrompt(`
You are a Security and Access Management specialist. Analyze the following access request.

Access Request: {request}
User Role: {userRole}
Resource: {resource}
Justification: {justification}
User History: {userHistory}

Please provide:
1. **Risk Assessment**: Low/Medium/High risk level and reasoning
2. **Compliance Check**: Does this comply with security policies?
3. **Access Type**: What level of access is appropriate (read/write/admin)?
4. **Approval Recommendation**: Auto-approve, manual review, or deny
5. **Security Conditions**: Any additional security requirements
6. **Monitoring Requirements**: What should be monitored after access is granted

Security Policies:
- Low-risk resources: Slack, Confluence (read), Figma, Notion, Jira (viewer)
- Medium-risk: GitHub (read), AWS (limited), Development tools
- High-risk: Production systems, Admin panels, Financial systems

Format as structured security assessment. Start with "APPROVE:" for auto-approval or "REVIEW:" for manual review.
`);

    this.chain = this.createChain(this.accessPrompt);
  }

  canHandle(input, context = {}) {
    const text = input.toLowerCase();
    const accessKeywords = [
      'access', 'permission', 'need access to', 'can i get', 'authorize',
      'login', 'account', 'credentials', 'system access', 'resource'
    ];
    return accessKeywords.some(keyword => text.includes(keyword));
  }

  async run(input, context) {
    // Extract resource name from input
    const resource = this.extractResource(input);
    
    const result = await this.chain.invoke({
      request: input,
      userRole: context.userRole || 'employee',
      resource: resource,
      justification: context.justification || input,
      userHistory: context.userHistory || 'No previous access history'
    });

    const autoApprove = result.toLowerCase().startsWith('approve:');
    const needsReview = result.toLowerCase().startsWith('review:');
    const riskLevel = this.extractRiskLevel(result);
    const accessType = this.extractAccessType(result);

    // Auto-create access request if this is a new request
    if (context.userId && context.autoCreateRequest !== false) {
      try {
        const requestId = accessRequestService.createAccessRequest(
          context.userId,
          resource,
          accessType,
          `${input}\n\n--- Access Agent Analysis ---\n${result}`
        );

        // Auto-approve if recommended and low risk
        if (autoApprove && riskLevel === 'low') {
          accessRequestService.updateRequestStatus(requestId, 'approved', 'access-agent-auto');
        }

        return {
          analysis: result,
          requestCreated: true,
          requestId,
          resource,
          autoApproved: autoApprove && riskLevel === 'low',
          riskLevel,
          accessType,
          requiresReview: needsReview || riskLevel === 'high'
        };
      } catch (error) {
        return {
          analysis: result,
          requestCreated: false,
          error: `Failed to create access request: ${error.message}`,
          resource,
          riskLevel,
          accessType
        };
      }
    }

    return {
      analysis: result,
      resource,
      riskLevel,
      accessType,
      recommendation: autoApprove ? 'approve' : needsReview ? 'review' : 'manual'
    };
  }

  extractResource(input) {
    const resourcePatterns = [
      /(?:access to|need|want|get)\s+([A-Za-z][A-Za-z0-9\s-]{2,20})/i,
      /(GitHub|Slack|Figma|Jira|AWS|Azure|Office|Confluence|Notion|Salesforce)/i,
      /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/
    ];
    
    for (const pattern of resourcePatterns) {
      const match = input.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
    
    return 'Unknown Resource';
  }

  extractRiskLevel(analysisText) {
    const text = analysisText.toLowerCase();
    if (text.includes('high risk') || text.includes('high-risk')) return 'high';
    if (text.includes('low risk') || text.includes('low-risk')) return 'low';
    return 'medium';
  }

  extractAccessType(analysisText) {
    const text = analysisText.toLowerCase();
    if (text.includes('admin') || text.includes('administrator')) return 'admin';
    if (text.includes('write') || text.includes('edit') || text.includes('modify')) return 'write';
    return 'read';
  }

  // Policy checker for automated decisions
  isLowRiskResource(resource) {
    const lowRiskResources = [
      'Slack', 'Confluence', 'Figma', 'Notion', 'Jira'
    ];
    return lowRiskResources.some(lr => 
      resource.toLowerCase().includes(lr.toLowerCase())
    );
  }

  isHighRiskResource(resource) {
    const highRiskResources = [
      'Production', 'Prod', 'Admin', 'Financial', 'Payroll', 'HR System'
    ];
    return highRiskResources.some(hr => 
      resource.toLowerCase().includes(hr.toLowerCase())
    );
  }
}

module.exports = AccessManagementAgent;