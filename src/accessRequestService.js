const db = require('./database');

class AccessRequestService {
  createAccessRequest(userId, resourceName, accessType, justification) {
    const stmt = db.prepare(`
      INSERT INTO access_requests (user_id, resource_name, access_type, justification, status)
      VALUES (?, ?, ?, ?, 'pending')
    `);
    const result = stmt.run(userId, resourceName, accessType || 'read', justification || '');
    return result.lastInsertRowid;
  }

  getAccessRequestsByUser(userId) {
    const stmt = db.prepare('SELECT * FROM access_requests WHERE user_id = ? ORDER BY created_at DESC');
    return stmt.all(userId);
  }

  getAllAccessRequests(filters = {}) {
    let query = 'SELECT ar.*, u.email, u.full_name FROM access_requests ar JOIN users u ON ar.user_id = u.id WHERE 1=1';
    const params = [];
    
    if (filters.status) {
      query += ' AND ar.status = ?';
      params.push(filters.status);
    }
    
    query += ' ORDER BY ar.created_at DESC';
    const stmt = db.prepare(query);
    return stmt.all(...params);
  }

  updateRequestStatus(requestId, status, approver) {
    const stmt = db.prepare('UPDATE access_requests SET status = ?, approver = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?');
    return stmt.run(status, approver, requestId);
  }
}

module.exports = new AccessRequestService();
