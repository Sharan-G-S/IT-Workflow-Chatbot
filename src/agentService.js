const db = require('./database');
const ticketService = require('./ticketService');
const accessRequestService = require('./accessRequestService');
const onboardingService = require('./onboardingService');

class AgentService {
  constructor(opts = {}) {
    this.config = {
      slaHours: { high: 4, medium: 24, low: 48 },
      lowRiskResources: ['Slack', 'Confluence', 'Figma', 'Notion', 'Jira-Viewer'],
      reminderLeadMinutes: 5,
      ...opts
    };
  }

  classifyTicket(text) {
    const lower = (text || '').toLowerCase();
    let category = 'general';
    if (/laptop|hardware|device|keyboard|mouse/.test(lower)) category = 'hardware';
    else if (/vpn|network|wifi|lan/.test(lower)) category = 'network';
    else if (/login|access|permission|authorize/.test(lower)) category = 'access';
    else if (/error|bug|issue|crash|exception/.test(lower)) category = 'software';

    let priority = 'medium';
    if (/outage|down|cannot access|urgent|production/.test(lower)) priority = 'high';
    else if (/slow|minor|typo/.test(lower)) priority = 'low';

    let assigneeSuggestion = null;
    if (category === 'network') assigneeSuggestion = 'network-team';
    if (category === 'hardware') assigneeSuggestion = 'helpdesk';
    if (category === 'software') assigneeSuggestion = 'app-support';
    if (category === 'access') assigneeSuggestion = 'iam-team';

    return { category, priority, assigneeSuggestion };
  }

  scanAccessRequests() {
    const pending = accessRequestService.getAllAccessRequests({ status: 'pending' });
    let approved = 0;
    for (const req of pending) {
      const resource = (req.resource_name || '').trim();
      const justification = (req.justification || '').toLowerCase();
      const lowRisk = this.config.lowRiskResources.includes(resource);
      const safeWords = /routine|standard|daily|team|collaboration/.test(justification);
      if (lowRisk && safeWords) {
        // Approve
        db.prepare(`UPDATE access_requests SET status='approved', approver='auto-agent', approved_at=CURRENT_TIMESTAMP, decision_reason=? WHERE id=?`).run('low-risk auto approval', req.id);
        approved++;
      }
    }
    return { scanned: pending.length, approved };
  }

  monitorSLA() {
    const all = ticketService.getAllTickets({ status: 'open' });
    const now = Date.now();
    let escalated = 0;
    for (const t of all) {
      const created = new Date(t.created_at).getTime();
      const ageHours = (now - created) / 3600000;
      const sla = this.config.slaHours[(t.priority || 'medium').toLowerCase()] || 24;
      if (ageHours > sla && (!t.escalated_at || t.escalation_level === 0)) {
        ticketService.updateTicket(t.id, {
          escalation_level: (t.escalation_level || 0) + 1,
          escalated_at: new Date().toISOString(),
          priority: t.priority === 'medium' ? 'high' : t.priority,
          status: 'open' // keep open but flagged
        });
        escalated++;
      }
    }
    return { scanned: all.length, escalated };
  }

  dispatchOnboardingReminders() {
    // Upcoming reminders not sent yet and due_at <= now
    const nowIso = new Date().toISOString();
    const rows = db.prepare(`SELECT * FROM reminders WHERE status='pending' AND (sent_at IS NULL) AND due_at <= ?`).all(nowIso);
    let sent = 0;
    for (const r of rows) {
      // Mark as sent
      db.prepare(`UPDATE reminders SET sent_at=CURRENT_TIMESTAMP, status='sent' WHERE id=?`).run(r.id);
      // Optionally add to conversation log for the user
      db.prepare(`INSERT INTO conversations (user_id, message, role, metadata) VALUES (?,?,?,?)`).run(
        r.user_id,
        `Reminder: Task "${r.item}" is due now (checklist ${r.checklist_id || 'n/a'}).`,
        'assistant',
        JSON.stringify({ type: 'reminder', reminder_id: r.id })
      );
      sent++;
    }
    return { scanned: rows.length, sent };
  }

  scheduleChecklistReminders(checklistId) {
    // Create reminder rows for pending items 24h from now
    const checklist = onboardingService.getAllChecklists().find(c => c.id === checklistId);
    if (!checklist) return { created: 0 };
    const items = checklist.checklist_items || [];
    let created = 0;
    const dueBase = Date.now() + 24 * 3600000; // 24h
    for (const item of items) {
      db.prepare(`INSERT INTO reminders (user_id, checklist_id, item, due_at) VALUES (?,?,?,?)`).run(
        checklist.user_id,
        checklist.id,
        item,
        new Date(dueBase).toISOString()
      );
      created++;
    }
    return { checklistId, created };
  }

  getStatus() {
    const pendingAccess = accessRequestService.getAllAccessRequests({ status: 'pending' }).length;
    const openTickets = ticketService.getAllTickets({ status: 'open' }).length;
    const overdueTickets = db.prepare(`SELECT COUNT(*) as cnt FROM tickets WHERE status='open' AND escalated_at IS NOT NULL`).get().cnt;
    const dueReminders = db.prepare(`SELECT COUNT(*) as cnt FROM reminders WHERE status='pending' AND due_at <= ?`).get(new Date().toISOString()).cnt;
    return { pendingAccess, openTickets, overdueTickets, dueReminders };
  }
}

module.exports = new AgentService();