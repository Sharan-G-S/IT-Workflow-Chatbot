const BaseAgent = require('./BaseAgent');
const { PromptTemplate } = require('@langchain/core/prompts');

/**
 * Performance Monitoring Agent - Monitors system performance, identifies bottlenecks, and suggests optimizations
 * Handles infrastructure monitoring, performance analysis, and proactive issue detection
 */
class PerformanceMonitoringAgent extends BaseAgent {
  constructor(config = {}) {
    super({
      name: 'PerformanceMonitoringAgent',
      description: 'Specialized agent for system performance monitoring, analysis, and optimization recommendations',
      ...config
    });
    
    this.performancePrompt = this.createPrompt(`
You are an expert Performance Monitoring specialist with deep knowledge of system optimization and infrastructure management.

Performance Query: {query}
System Context: {systemContext}
Metrics Data: {metricsData}
Alert Level: {alertLevel}
User Role: {userRole}

Analyze the performance data and provide:

1. **Performance Assessment**: Current system health status
2. **Issue Identification**: Any performance bottlenecks or anomalies detected
3. **Impact Analysis**: How performance issues affect business operations
4. **Root Cause Analysis**: Likely causes of performance degradation
5. **Optimization Recommendations**: Specific actions to improve performance
6. **Monitoring Setup**: Suggested alerts and monitoring thresholds
7. **Preventive Measures**: Long-term strategies to maintain optimal performance

Consider these performance areas:
- CPU, Memory, Disk, Network utilization
- Application response times and throughput
- Database query performance
- Cache hit rates and efficiency
- Server load balancing and scaling
- Resource allocation and capacity planning

Format as structured performance analysis with actionable recommendations.
Prioritize recommendations by impact and implementation difficulty.
`);

    this.chain = this.createChain(this.performancePrompt);
  }

  /**
   * Check if this agent can handle the performance-related request
   */
  canHandle(input, context) {
    const performanceKeywords = [
      'performance', 'slow', 'lag', 'bottleneck', 'optimization', 'monitor',
      'cpu', 'memory', 'disk', 'network', 'latency', 'throughput',
      'response time', 'load time', 'server', 'infrastructure',
      'scaling', 'capacity', 'utilization', 'metrics', 'dashboard',
      'alert', 'monitoring', 'uptime', 'downtime', 'availability'
    ];
    
    const text = input.toLowerCase();
    return performanceKeywords.some(keyword => text.includes(keyword));
  }

  /**
   * Execute performance monitoring and analysis
   */
  async execute(input, context = {}) {
    try {
      const result = await this.run(input, context);
      return {
        success: true,
        agent: this.name,
        response: result.analysis,
        metadata: {
          performanceLevel: result.performanceLevel,
          criticalIssues: result.criticalIssues,
          recommendations: result.recommendations,
          monitoringSetup: result.monitoringSetup
        }
      };
    } catch (error) {
      return {
        success: false,
        agent: this.name,
        error: error.message,
        fallback: 'Performance monitoring analysis failed. Please check system manually or contact IT infrastructure team.'
      };
    }
  }

  /**
   * Main performance analysis method
   */
  async run(input, context) {
    // Gather system metrics (in real implementation, this would connect to monitoring tools)
    const systemMetrics = await this.gatherSystemMetrics(context);
    
    const result = await this.chain.invoke({
      query: input,
      systemContext: context.systemContext || 'General IT infrastructure',
      metricsData: JSON.stringify(systemMetrics, null, 2),
      alertLevel: this.assessAlertLevel(systemMetrics),
      userRole: context.userRole || 'IT Staff'
    });

    const performanceLevel = this.extractPerformanceLevel(result);
    const criticalIssues = this.identifyCriticalIssues(result, systemMetrics);
    const recommendations = this.extractRecommendations(result);

    // Auto-create performance ticket if critical issues detected
    if (criticalIssues.length > 0 && context.userId) {
      await this.createPerformanceTicket(input, result, criticalIssues, context);
    }

    return {
      analysis: result,
      performanceLevel,
      criticalIssues,
      recommendations,
      monitoringSetup: this.generateMonitoringSetup(systemMetrics, performanceLevel)
    };
  }

  /**
   * Gather system performance metrics
   */
  async gatherSystemMetrics(context) {
    // In a real implementation, this would connect to monitoring systems like:
    // - Prometheus, Grafana, DataDog, New Relic
    // - AWS CloudWatch, Azure Monitor, GCP Monitoring
    // - Custom application metrics
    
    return {
      timestamp: new Date().toISOString(),
      cpu: {
        usage: Math.random() * 100, // Mock data
        cores: 8,
        loadAverage: Math.random() * 4
      },
      memory: {
        usage: Math.random() * 100,
        total: '32GB',
        available: '16GB'
      },
      disk: {
        usage: Math.random() * 100,
        totalSpace: '1TB',
        freeSpace: '400GB',
        iops: Math.random() * 1000
      },
      network: {
        bandwidthUsage: Math.random() * 100,
        latency: Math.random() * 100,
        packetsPerSecond: Math.random() * 10000
      },
      application: {
        responseTime: Math.random() * 2000,
        throughput: Math.random() * 1000,
        errorRate: Math.random() * 5,
        activeConnections: Math.random() * 500
      },
      database: {
        queryTime: Math.random() * 500,
        connections: Math.random() * 100,
        cacheHitRate: 85 + Math.random() * 15
      }
    };
  }

  /**
   * Assess alert level based on metrics
   */
  assessAlertLevel(metrics) {
    const criticalThresholds = {
      cpu: 90,
      memory: 85,
      disk: 90,
      responseTime: 5000,
      errorRate: 5
    };

    if (metrics.cpu.usage > criticalThresholds.cpu || 
        metrics.memory.usage > criticalThresholds.memory ||
        metrics.disk.usage > criticalThresholds.disk ||
        metrics.application.responseTime > criticalThresholds.responseTime ||
        metrics.application.errorRate > criticalThresholds.errorRate) {
      return 'critical';
    }
    
    if (metrics.cpu.usage > 70 || metrics.memory.usage > 70 || metrics.disk.usage > 75) {
      return 'warning';
    }
    
    return 'normal';
  }

  /**
   * Extract performance level from analysis
   */
  extractPerformanceLevel(analysisText) {
    const text = analysisText.toLowerCase();
    if (text.includes('critical') || text.includes('severe') || text.includes('urgent')) {
      return 'critical';
    }
    if (text.includes('degraded') || text.includes('warning') || text.includes('attention')) {
      return 'degraded';
    }
    if (text.includes('optimal') || text.includes('good') || text.includes('healthy')) {
      return 'optimal';
    }
    return 'normal';
  }

  /**
   * Identify critical issues from analysis and metrics
   */
  identifyCriticalIssues(analysisText, metrics) {
    const issues = [];
    
    if (metrics.cpu.usage > 90) {
      issues.push({
        type: 'cpu_overload',
        severity: 'critical',
        description: `CPU usage at ${metrics.cpu.usage.toFixed(1)}% - immediate attention required`
      });
    }
    
    if (metrics.memory.usage > 85) {
      issues.push({
        type: 'memory_pressure',
        severity: 'critical', 
        description: `Memory usage at ${metrics.memory.usage.toFixed(1)}% - risk of system instability`
      });
    }
    
    if (metrics.application.responseTime > 5000) {
      issues.push({
        type: 'slow_response',
        severity: 'critical',
        description: `Application response time ${metrics.application.responseTime.toFixed(0)}ms - user experience severely impacted`
      });
    }
    
    return issues;
  }

  /**
   * Extract recommendations from analysis
   */
  extractRecommendations(analysisText) {
    const recommendations = [];
    const text = analysisText.toLowerCase();
    
    if (text.includes('scale') || text.includes('capacity')) {
      recommendations.push({
        priority: 'high',
        action: 'Scale infrastructure resources',
        description: 'Add additional compute resources or optimize resource allocation'
      });
    }
    
    if (text.includes('optimize') || text.includes('performance')) {
      recommendations.push({
        priority: 'medium',
        action: 'Optimize application performance',
        description: 'Review and optimize code, database queries, and caching strategies'
      });
    }
    
    return recommendations;
  }

  /**
   * Generate monitoring setup recommendations
   */
  generateMonitoringSetup(metrics, performanceLevel) {
    const setup = {
      alerts: [],
      dashboards: ['System Overview', 'Application Performance', 'Infrastructure Health'],
      metrics: ['CPU Usage', 'Memory Usage', 'Disk Usage', 'Network Throughput', 'Response Time']
    };
    
    if (performanceLevel === 'critical') {
      setup.alerts.push({
        type: 'immediate',
        condition: 'CPU > 90% for 2 minutes',
        action: 'Page on-call engineer'
      });
    }
    
    return setup;
  }

  /**
   * Create performance-related ticket for critical issues
   */
  async createPerformanceTicket(input, analysis, criticalIssues, context) {
    try {
      const ticketService = require('../ticketService');
      
      const ticketData = {
        title: `Performance Issue: ${criticalIssues[0]?.description || 'System Performance Degradation'}`,
        description: `Performance monitoring detected critical issues:\n\n${criticalIssues.map(issue => `- ${issue.description}`).join('\n')}\n\n--- Performance Analysis ---\n${analysis}`,
        priority: 'urgent',
        category: 'Performance & Infrastructure',
        assignee: 'infrastructure-team@company.com',
        status: 'open',
        auto_generated: true
      };
      
      const result = await ticketService.createTicket(ticketData);
      console.log(`[PERFORMANCE-AGENT] Created critical performance ticket #${result.id}`);
      
      return result;
    } catch (error) {
      console.error('[PERFORMANCE-AGENT] Failed to create ticket:', error);
      return null;
    }
  }

  /**
   * Get agent metadata
   */
  getMetadata() {
    return {
      name: this.name,
      description: this.description,
      capabilities: [
        'System performance monitoring',
        'Performance bottleneck identification',
        'Infrastructure optimization recommendations',
        'Proactive issue detection',
        'Capacity planning guidance',
        'Monitoring setup configuration'
      ],
      specializations: [
        'CPU and memory optimization',
        'Network performance analysis', 
        'Application response time monitoring',
        'Database performance tuning',
        'Infrastructure scaling recommendations'
      ]
    };
  }
}

module.exports = PerformanceMonitoringAgent;