const bcrypt = require('bcrypt');
const db = require('./database');

class AuthService {
  async hashPassword(password) {
    return bcrypt.hash(password, 10);
  }

  async verifyPassword(password, hash) {
    return bcrypt.compare(password, hash);
  }

  createUser(email, password, fullName, role = 'employee') {
    const stmt = db.prepare('INSERT INTO users (email, password_hash, full_name, role) VALUES (?, ?, ?, ?)');
    const hash = bcrypt.hashSync(password, 10);
    const result = stmt.run(email, hash, fullName, role);
    return result.lastInsertRowid;
  }

  getUserByEmail(email) {
    const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
    return stmt.get(email);
  }

  getUserById(id) {
    const stmt = db.prepare('SELECT id, email, full_name, role, created_at FROM users WHERE id = ?');
    return stmt.get(id);
  }

  async authenticate(email, password) {
    const user = this.getUserByEmail(email);
    if (!user) return null;
    const valid = await this.verifyPassword(password, user.password_hash);
    if (!valid) return null;
    // return user without password hash
    const { password_hash, ...safeUser } = user;
    return safeUser;
  }
}

module.exports = new AuthService();
