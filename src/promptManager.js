class PromptManager {
  constructor() {
    // templates for different scenarios
    this.templates = {
      ticket: `You are an IT support assistant. User request:

{message}

Please produce: 1) a short summary, 2) priority (low/med/high), 3) suggested action steps, 4) ticket JSON payload with fields: title, description, priority, assignee, tags.`,
      onboarding: `You are an HR automation assistant. Create an onboarding checklist and resource list for the new employee.

Employee info:
{message}

Return: 1) one-paragraph welcome, 2) a checklist array, 3) list of systems to provision.`,
      access: `You are an IT Access Coordinator. The user requests access change:

{message}

Return: 1) access summary, 2) required approvals, 3) resource links and command snippets.`,
      generic: `{message}`
    };
  }

  render({ scenario, message }) {
    const t = this.templates[scenario] || this.templates.generic;
    return t.replace('{message}', message || '');
  }
}

module.exports = { PromptManager };
