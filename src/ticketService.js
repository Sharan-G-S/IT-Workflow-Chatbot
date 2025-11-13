const db = require('./database');

class TicketService {
  createTicket(userId, data) {
    const stmt = db.prepare(`
      INSERT INTO tickets (user_id, title, description, priority, status, category, assignee, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      userId,
      data.title,
      data.description || '',
      data.priority || 'medium',
      data.status || 'open',
      data.category || 'general',
      data.assignee || null,
      data.tags || ''
    );
    return result.lastInsertRowid;
  }

  getTicketsByUser(userId) {
    const stmt = db.prepare('SELECT * FROM tickets WHERE user_id = ? ORDER BY created_at DESC');
    return stmt.all(userId);
  }

  getAllTickets(filters = {}) {
    let query = 'SELECT * FROM tickets WHERE 1=1';
    const params = [];
    
    if (filters.status) {
      query += ' AND status = ?';
      params.push(filters.status);
    }
    if (filters.startDate) {
      query += ' AND created_at >= ?';
      params.push(filters.startDate);
    }
    
    query += ' ORDER BY created_at DESC';
    const stmt = db.prepare(query);
    return stmt.all(...params);
  }

  updateTicketStatus(ticketId, status) {
    const stmt = db.prepare('UPDATE tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    return stmt.run(status, ticketId);
  }
}

module.exports = new TicketService();
