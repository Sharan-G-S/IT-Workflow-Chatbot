const ITSupportAgent = require('./ITSupportAgent');
const AccessManagementAgent = require('./AccessManagementAgent');
const OnboardingAgent = require('./OnboardingAgent');
const EscalationAgent = require('./EscalationAgent');
const PerformanceMonitoringAgent = require('./PerformanceMonitoringAgent');
const KnowledgeBaseAgent = require('./KnowledgeBaseAgent');

/**
 * Agent Triage Router - Intelligent routing system for LangChain agents
 * Analyzes incoming requests and routes them to the most appropriate specialist agent
 */
class AgentTriageRouter {
  constructor(config = {}) {
    this.agents = [
      new EscalationAgent(config.escalation),
      new PerformanceMonitoringAgent(config.performance),
      new KnowledgeBaseAgent(config.knowledge),
      new ITSupportAgent(config.itSupport),
      new AccessManagementAgent(config.accessManagement),
      new OnboardingAgent(config.onboarding)
    ];
    
    this.fallbackAgent = new ITSupportAgent(config.fallback);
    this.routingHistory = [];
    this.config = {
      enableMultiAgent: true,
      confidenceThreshold: 0.7,
      maxAgents: 2,
      ...config
    };
  }

  /**
   * Main triage method - routes request to appropriate agent(s)
   */
  async route(input, context = {}) {
    const routingDecision = await this.analyzeRouting(input, context);
    const startTime = Date.now();
    
    try {
      let results;
      
      if (routingDecision.agents.length === 1) {
        // Single agent execution
        const agent = routingDecision.agents[0];
        const result = await agent.execute(input, context);
        results = [result];
      } else if (routingDecision.agents.length > 1 && this.config.enableMultiAgent) {
        // Multi-agent execution
        results = await this.executeMultiAgent(routingDecision.agents, input, context);
      } else {
        // Fallback to IT Support agent
        const result = await this.fallbackAgent.execute(input, context);
        results = [result];
      }
      
      const executionTime = Date.now() - startTime;
      
      // Log routing decision
      this.logRouting({
        input,
        context,
        routingDecision,
        results,
        executionTime,
        timestamp: new Date().toISOString()
      });
      
      return {
        success: true,
        routing: routingDecision,
        results,
        executionTime,
        agentsUsed: results.map(r => r.agent),
        primaryResult: results[0]
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message,
        routing: routingDecision,
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * Analyze input and determine which agent(s) should handle it
   */
  async analyzeRouting(input, context) {
    const candidates = [];
    
    // Score each agent's capability to handle this request
    for (const agent of this.agents) {
      const canHandle = agent.canHandle(input, context);
      const confidence = this.calculateConfidence(agent, input, context);
      
      if (canHandle && confidence >= this.config.confidenceThreshold) {
        candidates.push({
          agent,
          confidence,
          reasoning: this.getRoutingReasoning(agent, input, context)
        });
      }
    }
    
    // Sort by confidence (highest first)
    candidates.sort((a, b) => b.confidence - a.confidence);
    
    // Select agents based on confidence and max agents limit
    const selectedAgents = candidates
      .slice(0, this.config.maxAgents)
      .map(c => c.agent);
    
    // If no agents selected, use fallback
    if (selectedAgents.length === 0) {
      selectedAgents.push(this.fallbackAgent);
    }
    
    return {
      agents: selectedAgents,
      candidates: candidates,
      reasoning: this.generateRoutingReasoning(candidates, selectedAgents),
      confidence: candidates[0]?.confidence || 0.5
    };
  }

  /**
   * Calculate confidence score for an agent handling specific input
   */
  calculateConfidence(agent, input, context) {
    let confidence = 0.5; // Base confidence
    
    // Keyword matching boost
    const keywordMatches = this.countKeywordMatches(agent, input);
    confidence += keywordMatches * 0.1;
    
    // Context-based boost
    if (context.priority === 'high' && agent.name === 'EscalationAgent') {
      confidence += 0.3;
    }
    
    if (context.userRole === 'new_hire' && agent.name === 'OnboardingAgent') {
      confidence += 0.4;
    }
    
    // Historical performance boost (simplified)
    const historicalSuccess = this.getHistoricalSuccess(agent.name);
    confidence += historicalSuccess * 0.2;
    
    return Math.min(confidence, 1.0);
  }

  /**
   * Count keyword matches for agent specialization
   */
  countKeywordMatches(agent, input) {
    const text = input.toLowerCase();
    let matches = 0;
    
    const agentKeywords = {
      EscalationAgent: ['urgent', 'critical', 'emergency', 'escalate', 'production', 'outage'],
      PerformanceMonitoringAgent: ['performance', 'slow', 'monitor', 'metrics', 'cpu', 'memory', 'optimization'],
      KnowledgeBaseAgent: ['how to', 'procedure', 'policy', 'documentation', 'guide', 'help', 'information'],
      ITSupportAgent: ['error', 'bug', 'not working', 'computer', 'software', 'hardware', 'technical'],
      AccessManagementAgent: ['access', 'permission', 'login', 'account', 'authorize', 'security'],
      OnboardingAgent: ['onboarding', 'new employee', 'setup', 'welcome', 'checklist', 'hire']
    };
    
    const keywords = agentKeywords[agent.name] || [];
    for (const keyword of keywords) {
      if (text.includes(keyword)) matches++;
    }
    
    return matches;
  }

  /**
   * Execute multiple agents in parallel or sequence
   */
  async executeMultiAgent(agents, input, context) {
    const results = [];
    
    // Execute primary agent first
    const primaryResult = await agents[0].execute(input, context);
    results.push(primaryResult);
    
    // Execute secondary agents with enriched context
    if (agents.length > 1) {
      const enrichedContext = {
        ...context,
        primaryAgentResult: primaryResult,
        multiAgentExecution: true
      };
      
      const secondaryPromises = agents.slice(1).map(agent => 
        agent.execute(input, enrichedContext)
      );
      
      const secondaryResults = await Promise.all(secondaryPromises);
      results.push(...secondaryResults);
    }
    
    return results;
  }

  /**
   * Get reasoning for why an agent was selected
   */
  getRoutingReasoning(agent, input, context) {
    const reasons = [];
    
    if (agent.canHandle(input, context)) {
      reasons.push(`${agent.name} can handle this type of request`);
    }
    
    const keywordCount = this.countKeywordMatches(agent, input);
    if (keywordCount > 0) {
      reasons.push(`Found ${keywordCount} relevant keywords for ${agent.name}`);
    }
    
    if (context.priority === 'high' && agent.name === 'EscalationAgent') {
      reasons.push('High priority issue requires escalation expertise');
    }
    
    return reasons.join('; ');
  }

  /**
   * Generate overall routing reasoning
   */
  generateRoutingReasoning(candidates, selectedAgents) {
    if (selectedAgents.length === 1) {
      const selected = candidates.find(c => c.agent === selectedAgents[0]);
      return `Single agent routing: ${selected?.reasoning || 'Fallback agent selected'}`;
    } else {
      return `Multi-agent routing: ${selectedAgents.map(a => a.name).join(', ')} selected for collaborative handling`;
    }
  }

  /**
   * Get historical success rate for agent (simplified implementation)
   */
  getHistoricalSuccess(agentName) {
    // In a real implementation, this would query historical data
    const successRates = {
      ITSupportAgent: 0.85,
      AccessManagementAgent: 0.90,
      OnboardingAgent: 0.88,
      EscalationAgent: 0.92
    };
    
    return successRates[agentName] || 0.80;
  }

  /**
   * Log routing decision for analytics
   */
  logRouting(routingData) {
    // Keep last 100 routing decisions for analysis
    this.routingHistory.push(routingData);
    if (this.routingHistory.length > 100) {
      this.routingHistory.shift();
    }
  }

  /**
   * Get routing analytics
   */
  getRoutingAnalytics() {
    const total = this.routingHistory.length;
    if (total === 0) return { total: 0 };
    
    const agentUsage = {};
    const avgExecutionTime = this.routingHistory.reduce((sum, r) => sum + r.executionTime, 0) / total;
    const successRate = this.routingHistory.filter(r => r.results.every(res => res.success)).length / total;
    
    this.routingHistory.forEach(r => {
      r.results.forEach(res => {
        agentUsage[res.agent] = (agentUsage[res.agent] || 0) + 1;
      });
    });
    
    return {
      total,
      avgExecutionTime,
      successRate,
      agentUsage,
      recentRoutings: this.routingHistory.slice(-10)
    };
  }

  /**
   * Get available agents metadata
   */
  getAvailableAgents() {
    return this.agents.map(agent => agent.getMetadata());
  }

  /**
   * Force route to specific agent (for testing/debugging)
   */
  async forceRoute(agentName, input, context = {}) {
    const agent = this.agents.find(a => a.name === agentName) || this.fallbackAgent;
    return await agent.execute(input, context);
  }
}

module.exports = AgentTriageRouter;