const BaseAgent = require('./BaseAgent');
const onboardingService = require('../onboardingService');
const agentService = require('../agentService');
const { PromptTemplate } = require('@langchain/core/prompts');

/**
 * Onboarding Agent - Specialized for employee onboarding processes
 * Handles checklist creation, progress tracking, and guidance
 */
class OnboardingAgent extends BaseAgent {
  constructor(config = {}) {
    super({
      name: 'OnboardingAgent',
      description: 'Specialized agent for employee onboarding, task management, and process guidance',
      ...config
    });
    
    this.onboardingPrompt = this.createPrompt(`
You are an HR and Onboarding specialist. Help with the following onboarding request.

Request: {request}
Employee Name: {employeeName}
Role: {employeeRole}
Department: {department}
Start Date: {startDate}
Current Progress: {currentProgress}

Please provide:
1. **Onboarding Plan**: Step-by-step checklist based on role and department
2. **Timeline**: Recommended timeline for each task (Day 1, Week 1, etc.)
3. **System Access**: What systems/tools they need access to
4. **Key Contacts**: Who they should meet (mentors, team leads, etc.)
5. **Documents**: What paperwork/documentation is needed
6. **Training**: Required training sessions or materials
7. **Progress Tracking**: How to monitor completion

Role-specific requirements:
- Developer: GitHub, IDE licenses, development environment, code review process
- Designer: Figma, Adobe Creative Suite, design system access
- Marketing: CRM, social media accounts, brand guidelines
- HR: HRIS, payroll systems, employee records access
- Sales: CRM, sales tools, customer databases

Format as structured onboarding plan with clear action items and timelines.
`);

    this.chain = this.createChain(this.onboardingPrompt);
  }

  canHandle(input, context = {}) {
    const text = input.toLowerCase();
    const onboardingKeywords = [
      'onboarding', 'new employee', 'new hire', 'starting', 'first day',
      'checklist', 'orientation', 'setup', 'welcome', 'join the team',
      'employee setup', 'workspace setup'
    ];
    return onboardingKeywords.some(keyword => text.includes(keyword));
  }

  async run(input, context) {
    const result = await this.chain.invoke({
      request: input,
      employeeName: context.employeeName || 'New Employee',
      employeeRole: context.employeeRole || context.userRole || 'Employee',
      department: context.department || 'General',
      startDate: context.startDate || new Date().toISOString().split('T')[0],
      currentProgress: context.currentProgress || 'Starting onboarding process'
    });

    // Extract structured checklist from AI response
    const checklist = this.parseChecklistFromResponse(result);
    const systemsToProvision = this.extractSystemsFromResponse(result);

    // Auto-create onboarding checklist if this is a new employee setup
    if (context.userId && context.autoCreateChecklist !== false) {
      try {
        const checklistId = onboardingService.createChecklist(
          context.userId,
          context.employeeName || 'New Employee',
          context.employeeRole || context.userRole,
          checklist,
          systemsToProvision,
          `Welcome! This onboarding plan was created by our AI assistant.\\n\\n${result}`
        );

        // Schedule reminders for checklist items
        try {
          await agentService.scheduleChecklistReminders(checklistId);
        } catch (reminderError) {
          console.warn('Failed to schedule reminders:', reminderError.message);
        }

        return {
          plan: result,
          checklistCreated: true,
          checklistId,
          checklist,
          systemsToProvision,
          remindersScheduled: true,
          timeline: this.extractTimeline(result)
        };
      } catch (error) {
        return {
          plan: result,
          checklistCreated: false,
          error: `Failed to create onboarding checklist: ${error.message}`,
          checklist,
          systemsToProvision
        };
      }
    }

    return {
      plan: result,
      checklist,
      systemsToProvision,
      timeline: this.extractTimeline(result),
      recommendation: 'Create structured onboarding checklist'
    };
  }

  parseChecklistFromResponse(response) {
    const lines = response.split('\\n');
    const checklist = [];
    
    for (const line of lines) {
      // Look for numbered lists, bullet points, or task indicators
      if (/^\\d+\\./.test(line.trim()) || 
          /^[-*•]/.test(line.trim()) || 
          /\\b(task|action|step|complete|setup|create)\\b/i.test(line)) {
        const task = line.replace(/^\\d+\\.\\s*/, '')
                       .replace(/^[-*•]\\s*/, '')
                       .trim();
        if (task.length > 3 && task.length < 100) {
          checklist.push(task);
        }
      }
    }
    
    // Fallback: extract key action items
    if (checklist.length === 0) {
      const actionWords = response.match(/\\b\\w+ing\\b|setup\\s+\\w+|create\\s+\\w+|configure\\s+\\w+/gi);
      if (actionWords) {
        checklist.push(...actionWords.slice(0, 10));
      }
    }
    
    return checklist.length > 0 ? checklist : [
      'Complete employee information form',
      'Setup workspace and equipment',
      'IT system access setup',
      'Meet with direct manager',
      'Complete mandatory training'
    ];
  }

  extractSystemsFromResponse(response) {
    const systems = [];
    const systemPatterns = [
      /(GitHub|Slack|Figma|Jira|AWS|Office|Confluence|Salesforce|Adobe|CRM)/gi,
      /\\b[A-Z][a-z]+\\s+[A-Z][a-z]+\\b/g  // Likely system names
    ];
    
    for (const pattern of systemPatterns) {
      const matches = response.match(pattern);
      if (matches) {
        systems.push(...matches);
      }
    }
    
    // Remove duplicates and return unique systems
    return [...new Set(systems)].slice(0, 10);
  }

  extractTimeline(response) {
    const timelineItems = [];
    const lines = response.split('\\n');
    
    for (const line of lines) {
      if (/day\\s+\\d+|week\\s+\\d+|first\\s+day|first\\s+week/i.test(line)) {
        timelineItems.push(line.trim());
      }
    }
    
    return timelineItems;
  }

  // Helper method to get role-specific onboarding templates
  getRoleTemplate(role) {
    const templates = {
      developer: [
        'Setup development environment',
        'GitHub account and repository access',
        'Code review process training',
        'Development tools installation',
        'Team coding standards review'
      ],
      designer: [
        'Design tool access (Figma, Adobe)',
        'Design system familiarization',
        'Brand guidelines review',
        'Creative team introductions',
        'Portfolio setup and sharing'
      ],
      marketing: [
        'CRM system training',
        'Social media account access',
        'Brand guidelines and assets',
        'Marketing automation tools',
        'Campaign management training'
      ],
      sales: [
        'CRM system setup',
        'Sales process training',
        'Customer database access',
        'Sales tools and quotas',
        'Territory assignment'
      ]
    };
    
    return templates[role.toLowerCase()] || templates.developer;
  }
}

module.exports = OnboardingAgent;