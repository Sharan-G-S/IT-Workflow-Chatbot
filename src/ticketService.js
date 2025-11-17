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

  updateTicket(ticketId, fields = {}) {
    const allowed = ['title','description','priority','status','category','assignee','tags','escalated_at','escalation_level'];
    const sets = [];
    const params = [];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(fields, key)) {
        sets.push(`${key} = ?`);
        params.push(fields[key]);
      }
    }
    if (!sets.length) return { changes: 0 };
    const sql = `UPDATE tickets SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
    params.push(ticketId);
    const stmt = db.prepare(sql);
    return stmt.run(...params);
  }

  escalateTicket(ticketId) {
    try {
      // First get the ticket
      const getStmt = db.prepare('SELECT * FROM tickets WHERE id = ?');
      const ticket = getStmt.get(ticketId);
      
      if (!ticket) {
        return { success: false, error: 'Ticket not found' };
      }
      
      // Update ticket with escalation
      const updateStmt = db.prepare(`
        UPDATE tickets 
        SET escalated_at = CURRENT_TIMESTAMP,
            priority = 'urgent',
            escalation_level = COALESCE(escalation_level, 0) + 1,
            updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `);
      
      const result = updateStmt.run(ticketId);
      
      if (result.changes > 0) {
        // Get updated ticket
        const updatedTicket = getStmt.get(ticketId);
        return { success: true, ticket: updatedTicket };
      } else {
        return { success: false, error: 'Failed to escalate ticket' };
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  createTicket(ticketData) {
    try {
      // For auto-generated tickets, use the ticket data directly
      const stmt = db.prepare(`
        INSERT INTO tickets (user_id, title, description, priority, status, category, assignee, tags, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const result = stmt.run(
        ticketData.user_id || 1, // Default to system user for auto-generated
        ticketData.title,
        ticketData.description || '',
        ticketData.priority || 'medium',
        ticketData.status || 'open',
        ticketData.category || 'general',
        ticketData.assignee || null,
        ticketData.tags || '',
        ticketData.created_at || new Date().toISOString()
      );
      
      return { success: true, id: result.lastInsertRowid };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  getAllTickets() {
    try {
      const stmt = db.prepare('SELECT * FROM tickets ORDER BY created_at DESC');
      return stmt.all();
    } catch (err) {
      console.error('Error fetching all tickets:', err);
      return [];
    }
  }
}

module.exports = new TicketService();
