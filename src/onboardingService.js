const db = require('./database');

class OnboardingService {
  createChecklist(userId, employeeName, role, checklistItems, systemsToProvision, welcomeMessage) {
    const stmt = db.prepare(`
      INSERT INTO onboarding_checklists (user_id, employee_name, role, checklist_items, systems_to_provision, welcome_message, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `);
    const result = stmt.run(
      userId,
      employeeName,
      role || '',
      JSON.stringify(checklistItems || []),
      JSON.stringify(systemsToProvision || []),
      welcomeMessage || ''
    );
    return result.lastInsertRowid;
  }

  getChecklistsByUser(userId) {
    const stmt = db.prepare('SELECT * FROM onboarding_checklists WHERE user_id = ? ORDER BY created_at DESC');
    const rows = stmt.all(userId);
    return rows.map(r => ({
      ...r,
      checklist_items: JSON.parse(r.checklist_items || '[]'),
      systems_to_provision: JSON.parse(r.systems_to_provision || '[]')
    }));
  }

  getAllChecklists() {
    const stmt = db.prepare('SELECT * FROM onboarding_checklists ORDER BY created_at DESC');
    const rows = stmt.all();
    return rows.map(r => ({
      ...r,
      checklist_items: JSON.parse(r.checklist_items || '[]'),
      systems_to_provision: JSON.parse(r.systems_to_provision || '[]')
    }));
  }

  updateChecklistStatus(checklistId, status) {
    const stmt = db.prepare('UPDATE onboarding_checklists SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?');
    return stmt.run(status, checklistId);
  }
}

module.exports = new OnboardingService();
