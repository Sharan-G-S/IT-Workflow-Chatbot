const db = require('./database');

class ConversationService {
  // Store a conversation message
  saveMessage(userId, message, role, metadata = {}) {
    const stmt = db.prepare(`
      INSERT INTO conversations (user_id, message, role, metadata, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `);
    const result = stmt.run(userId, message, role, JSON.stringify(metadata));
    return result.lastInsertRowid;
  }

  // Get conversation history for a user
  getConversationHistory(userId, limit = 50) {
    const stmt = db.prepare(`
      SELECT * FROM conversations 
      WHERE user_id = ? 
      ORDER BY created_at DESC 
      LIMIT ?
    `);
    const rows = stmt.all(userId, limit);
    return rows.reverse().map(r => ({
      ...r,
      metadata: JSON.parse(r.metadata || '{}')
    }));
  }

  // Get recent conversation context (last N messages)
  getRecentContext(userId, limit = 5) {
    const history = this.getConversationHistory(userId, limit);
    return history.map(h => `${h.role}: ${h.message}`).join('\n');
  }

  // Clear conversation history for a user
  clearHistory(userId) {
    const stmt = db.prepare('DELETE FROM conversations WHERE user_id = ?');
    return stmt.run(userId);
  }

  // Get conversation statistics
  getStats(userId) {
    const stmt = db.prepare(`
      SELECT 
        COUNT(*) as total_messages,
        COUNT(DISTINCT DATE(created_at)) as days_active,
        MAX(created_at) as last_message
      FROM conversations
      WHERE user_id = ?
    `);
    return stmt.get(userId);
  }
}

module.exports = new ConversationService();
