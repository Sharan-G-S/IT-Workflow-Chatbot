/**
 * Advanced Search and Filtering Service
 * Provides powerful search capabilities across tickets, access requests, and user data
 */
class SearchService {
  constructor(database) {
    this.db = database;
    this.searchStats = {
      totalSearches: 0,
      avgResponseTime: 0,
      popularFilters: {},
      searchTerms: new Map()
    };
    
    console.log('[SEARCH] Advanced search service initialized');
  }

  /**
   * Universal search across all entities
   */
  async universalSearch(query, options = {}) {
    const startTime = Date.now();
    this.searchStats.totalSearches++;

    const {
      entities = ['tickets', 'access_requests', 'users', 'onboarding'],
      limit = 50,
      offset = 0,
      sortBy = 'relevance',
      sortOrder = 'desc',
      userId = null,
      userRole = 'employee'
    } = options;

    try {
      const results = {};
      const searchPromises = [];

      // Search tickets
      if (entities.includes('tickets')) {
        searchPromises.push(
          this.searchTickets(query, { limit, offset, sortBy, sortOrder, userId, userRole })
            .then(data => results.tickets = data)
        );
      }

      // Search access requests
      if (entities.includes('access_requests')) {
        searchPromises.push(
          this.searchAccessRequests(query, { limit, offset, sortBy, sortOrder, userId, userRole })
            .then(data => results.access_requests = data)
        );
      }

      // Search users (admin/hr only)
      if (entities.includes('users') && ['admin', 'hr'].includes(userRole)) {
        searchPromises.push(
          this.searchUsers(query, { limit, offset, sortBy, sortOrder })
            .then(data => results.users = data)
        );
      }

      // Search onboarding
      if (entities.includes('onboarding')) {
        searchPromises.push(
          this.searchOnboarding(query, { limit, offset, sortBy, sortOrder, userId, userRole })
            .then(data => results.onboarding = data)
        );
      }

      await Promise.all(searchPromises);

      // Track search terms for analytics
      this.trackSearchTerm(query);

      const responseTime = Date.now() - startTime;
      this.updateResponseTime(responseTime);

      return {
        query,
        results,
        metadata: {
          totalResults: Object.values(results).reduce((sum, entityResults) => 
            sum + (entityResults.total || entityResults.length || 0), 0),
          searchTime: responseTime,
          entities: Object.keys(results)
        }
      };
    } catch (error) {
      console.error('[SEARCH] Universal search error:', error);
      throw error;
    }
  }

  /**
   * Advanced ticket search with multiple filters
   */
  async searchTickets(query, options = {}) {
    const {
      status = null,
      priority = null,
      category = null,
      assignedTo = null,
      createdBy = null,
      dateFrom = null,
      dateTo = null,
      limit = 20,
      offset = 0,
      sortBy = 'created_at',
      sortOrder = 'desc',
      userId = null,
      userRole = 'employee'
    } = options;

    // Build WHERE clause
    const conditions = [];
    const params = [];

    // Role-based filtering
    if (userRole === 'employee' && userId) {
      conditions.push('user_id = ?');
      params.push(userId);
    }

    // Text search
    if (query && query.trim()) {
      conditions.push('(title LIKE ? OR description LIKE ? OR id LIKE ?)');
      const searchTerm = `%${query.trim()}%`;
      params.push(searchTerm, searchTerm, `%${query.trim()}%`);
    }

    // Status filter
    if (status) {
      if (Array.isArray(status)) {
        conditions.push(`status IN (${status.map(() => '?').join(',')})`);
        params.push(...status);
      } else {
        conditions.push('status = ?');
        params.push(status);
      }
    }

    // Priority filter
    if (priority) {
      if (Array.isArray(priority)) {
        conditions.push(`priority IN (${priority.map(() => '?').join(',')})`);
        params.push(...priority);
      } else {
        conditions.push('priority = ?');
        params.push(priority);
      }
    }

    // Category filter
    if (category) {
      conditions.push('category = ?');
      params.push(category);
    }

    // Assigned to filter
    if (assignedTo) {
      conditions.push('assigned_to = ?');
      params.push(assignedTo);
    }

    // Created by filter
    if (createdBy) {
      conditions.push('user_id = ?');
      params.push(createdBy);
    }

    // Date range filters
    if (dateFrom) {
      conditions.push('created_at >= ?');
      params.push(dateFrom);
    }

    if (dateTo) {
      conditions.push('created_at <= ?');
      params.push(dateTo);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    
    // Sorting
    const validSortColumns = ['id', 'title', 'status', 'priority', 'created_at', 'updated_at'];
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'created_at';
    const sortDirection = sortOrder.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    try {
      // Get total count
      const countQuery = `SELECT COUNT(*) as total FROM tickets ${whereClause}`;
      const countResult = this.db.prepare(countQuery).get(...params);
      const total = countResult.total;

      // Get results
      const query_sql = `
        SELECT 
          id, title, description, status, priority, category,
          user_id, assigned_to, created_at, updated_at,
          CASE 
            WHEN ? != '' AND (title LIKE ? OR description LIKE ?) THEN 2
            WHEN ? != '' AND id LIKE ? THEN 1
            ELSE 0
          END as relevance_score
        FROM tickets 
        ${whereClause}
        ORDER BY ${sortBy === 'relevance' ? 'relevance_score DESC, created_at DESC' : `${sortColumn} ${sortDirection}`}
        LIMIT ? OFFSET ?
      `;

      const searchTerm = query ? `%${query.trim()}%` : '';
      const queryParams = [
        query || '', searchTerm, searchTerm,
        query || '', searchTerm,
        ...params,
        limit, offset
      ];

      const tickets = this.db.prepare(query_sql).all(...queryParams);

      // Add user names for better display
      const enrichedTickets = await this.enrichTicketsWithUserNames(tickets);

      return {
        tickets: enrichedTickets,
        total,
        page: Math.floor(offset / limit) + 1,
        totalPages: Math.ceil(total / limit),
        limit
      };
    } catch (error) {
      console.error('[SEARCH] Ticket search error:', error);
      throw error;
    }
  }

  /**
   * Advanced access request search
   */
  async searchAccessRequests(query, options = {}) {
    const {
      status = null,
      resource = null,
      riskLevel = null,
      approvedBy = null,
      requestedBy = null,
      dateFrom = null,
      dateTo = null,
      limit = 20,
      offset = 0,
      sortBy = 'created_at',
      sortOrder = 'desc',
      userId = null,
      userRole = 'employee'
    } = options;

    const conditions = [];
    const params = [];

    // Role-based filtering
    if (userRole === 'employee' && userId) {
      conditions.push('user_id = ?');
      params.push(userId);
    }

    // Text search
    if (query && query.trim()) {
      conditions.push('(resource LIKE ? OR justification LIKE ? OR id LIKE ?)');
      const searchTerm = `%${query.trim()}%`;
      params.push(searchTerm, searchTerm, `%${query.trim()}%`);
    }

    // Filters
    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }

    if (resource) {
      conditions.push('resource LIKE ?');
      params.push(`%${resource}%`);
    }

    if (riskLevel) {
      conditions.push('risk_level = ?');
      params.push(riskLevel);
    }

    if (approvedBy) {
      conditions.push('approved_by = ?');
      params.push(approvedBy);
    }

    if (requestedBy) {
      conditions.push('user_id = ?');
      params.push(requestedBy);
    }

    if (dateFrom) {
      conditions.push('created_at >= ?');
      params.push(dateFrom);
    }

    if (dateTo) {
      conditions.push('created_at <= ?');
      params.push(dateTo);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    
    try {
      // Get total count
      const countQuery = `SELECT COUNT(*) as total FROM access_requests ${whereClause}`;
      const countResult = this.db.prepare(countQuery).get(...params);
      const total = countResult.total;

      // Get results
      const query_sql = `
        SELECT 
          id, resource, access_level, justification, status,
          risk_level, user_id, approved_by, approved_at,
          created_at, updated_at
        FROM access_requests 
        ${whereClause}
        ORDER BY ${sortBy} ${sortOrder.toUpperCase()}
        LIMIT ? OFFSET ?
      `;

      const requests = this.db.prepare(query_sql).all(...params, limit, offset);

      return {
        requests,
        total,
        page: Math.floor(offset / limit) + 1,
        totalPages: Math.ceil(total / limit),
        limit
      };
    } catch (error) {
      console.error('[SEARCH] Access request search error:', error);
      throw error;
    }
  }

  /**
   * User search (admin/hr only)
   */
  async searchUsers(query, options = {}) {
    const {
      role = null,
      status = 'active',
      limit = 20,
      offset = 0,
      sortBy = 'name',
      sortOrder = 'asc'
    } = options;

    const conditions = ['1=1']; // Base condition
    const params = [];

    // Text search
    if (query && query.trim()) {
      conditions.push('(name LIKE ? OR email LIKE ? OR id LIKE ?)');
      const searchTerm = `%${query.trim()}%`;
      params.push(searchTerm, searchTerm, `%${query.trim()}%`);
    }

    // Role filter
    if (role) {
      conditions.push('role = ?');
      params.push(role);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    try {
      // Get total count
      const countQuery = `SELECT COUNT(*) as total FROM users ${whereClause}`;
      const countResult = this.db.prepare(countQuery).get(...params);
      const total = countResult.total;

      // Get results (exclude password)
      const query_sql = `
        SELECT 
          id, name, email, role, created_at, last_login
        FROM users 
        ${whereClause}
        ORDER BY ${sortBy} ${sortOrder.toUpperCase()}
        LIMIT ? OFFSET ?
      `;

      const users = this.db.prepare(query_sql).all(...params, limit, offset);

      return {
        users,
        total,
        page: Math.floor(offset / limit) + 1,
        totalPages: Math.ceil(total / limit),
        limit
      };
    } catch (error) {
      console.error('[SEARCH] User search error:', error);
      throw error;
    }
  }

  /**
   * Onboarding search
   */
  async searchOnboarding(query, options = {}) {
    const {
      status = null,
      employeeName = null,
      dueDate = null,
      limit = 20,
      offset = 0,
      sortBy = 'created_at',
      sortOrder = 'desc',
      userId = null,
      userRole = 'employee'
    } = options;

    const conditions = [];
    const params = [];

    // Role-based filtering
    if (userRole === 'employee' && userId) {
      conditions.push('user_id = ?');
      params.push(userId);
    }

    // Text search
    if (query && query.trim()) {
      conditions.push('(employee_name LIKE ? OR department LIKE ? OR id LIKE ?)');
      const searchTerm = `%${query.trim()}%`;
      params.push(searchTerm, searchTerm, `%${query.trim()}%`);
    }

    // Filters
    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }

    if (employeeName) {
      conditions.push('employee_name LIKE ?');
      params.push(`%${employeeName}%`);
    }

    if (dueDate) {
      conditions.push('DATE(created_at) = DATE(?)');
      params.push(dueDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    try {
      // Get total count
      const countQuery = `SELECT COUNT(*) as total FROM onboarding ${whereClause}`;
      const countResult = this.db.prepare(countQuery).get(...params);
      const total = countResult.total;

      // Get results
      const query_sql = `
        SELECT 
          id, employee_name, department, role, start_date,
          checklist, status, created_at, updated_at
        FROM onboarding 
        ${whereClause}
        ORDER BY ${sortBy} ${sortOrder.toUpperCase()}
        LIMIT ? OFFSET ?
      `;

      const onboarding = this.db.prepare(query_sql).all(...params, limit, offset);

      return {
        onboarding,
        total,
        page: Math.floor(offset / limit) + 1,
        totalPages: Math.ceil(total / limit),
        limit
      };
    } catch (error) {
      console.error('[SEARCH] Onboarding search error:', error);
      throw error;
    }
  }

  /**
   * Get filter options for dynamic filter building
   */
  async getFilterOptions(entity, userRole = 'employee') {
    try {
      const options = {};

      switch (entity) {
        case 'tickets':
          options.status = this.db.prepare('SELECT DISTINCT status FROM tickets WHERE status IS NOT NULL ORDER BY status').all().map(r => r.status);
          options.priority = this.db.prepare('SELECT DISTINCT priority FROM tickets WHERE priority IS NOT NULL ORDER BY priority').all().map(r => r.priority);
          options.category = this.db.prepare('SELECT DISTINCT category FROM tickets WHERE category IS NOT NULL ORDER BY category').all().map(r => r.category);
          
          if (['admin', 'it_staff'].includes(userRole)) {
            options.assignedTo = this.db.prepare('SELECT DISTINCT assigned_to FROM tickets WHERE assigned_to IS NOT NULL ORDER BY assigned_to').all().map(r => r.assigned_to);
          }
          break;

        case 'access_requests':
          options.status = this.db.prepare('SELECT DISTINCT status FROM access_requests WHERE status IS NOT NULL ORDER BY status').all().map(r => r.status);
          options.resource = this.db.prepare('SELECT DISTINCT resource FROM access_requests WHERE resource IS NOT NULL ORDER BY resource').all().map(r => r.resource);
          options.riskLevel = this.db.prepare('SELECT DISTINCT risk_level FROM access_requests WHERE risk_level IS NOT NULL ORDER BY risk_level').all().map(r => r.risk_level);
          break;

        case 'users':
          if (['admin', 'hr'].includes(userRole)) {
            options.role = this.db.prepare('SELECT DISTINCT role FROM users WHERE role IS NOT NULL ORDER BY role').all().map(r => r.role);
          }
          break;

        case 'onboarding':
          options.status = this.db.prepare('SELECT DISTINCT status FROM onboarding WHERE status IS NOT NULL ORDER BY status').all().map(r => r.status);
          options.department = this.db.prepare('SELECT DISTINCT department FROM onboarding WHERE department IS NOT NULL ORDER BY department').all().map(r => r.department);
          break;
      }

      return options;
    } catch (error) {
      console.error('[SEARCH] Get filter options error:', error);
      return {};
    }
  }

  /**
   * Get search suggestions based on query
   */
  async getSearchSuggestions(query, entity = 'all', limit = 5) {
    if (!query || query.length < 2) return [];

    try {
      const suggestions = [];
      const searchTerm = `%${query.trim()}%`;

      // Ticket suggestions
      if (entity === 'all' || entity === 'tickets') {
        const ticketSuggestions = this.db.prepare(`
          SELECT DISTINCT title as suggestion, 'ticket' as type, id
          FROM tickets 
          WHERE title LIKE ? 
          ORDER BY created_at DESC 
          LIMIT ?
        `).all(searchTerm, limit);
        suggestions.push(...ticketSuggestions);
      }

      // Access request suggestions
      if (entity === 'all' || entity === 'access_requests') {
        const accessSuggestions = this.db.prepare(`
          SELECT DISTINCT resource as suggestion, 'access_request' as type, id
          FROM access_requests 
          WHERE resource LIKE ? 
          ORDER BY created_at DESC 
          LIMIT ?
        `).all(searchTerm, limit);
        suggestions.push(...accessSuggestions);
      }

      // User suggestions (if appropriate)
      if ((entity === 'all' || entity === 'users')) {
        const userSuggestions = this.db.prepare(`
          SELECT DISTINCT name as suggestion, 'user' as type, id
          FROM users 
          WHERE name LIKE ? 
          ORDER BY name 
          LIMIT ?
        `).all(searchTerm, Math.min(limit, 3));
        suggestions.push(...userSuggestions);
      }

      return suggestions.slice(0, limit);
    } catch (error) {
      console.error('[SEARCH] Get suggestions error:', error);
      return [];
    }
  }

  /**
   * Enhanced search with AI-powered relevance scoring
   */
  async intelligentSearch(query, options = {}) {
    // First perform regular search
    const results = await this.universalSearch(query, options);

    // Apply AI-based relevance scoring if OpenAI is available
    if (process.env.OPENAI_API_KEY) {
      results.results = await this.applyAIRelevanceScoring(query, results.results);
    }

    return results;
  }

  /**
   * Helper: Enrich tickets with user names
   */
  async enrichTicketsWithUserNames(tickets) {
    if (!tickets || tickets.length === 0) return tickets;

    try {
      const userIds = [...new Set(tickets.map(t => t.user_id).filter(Boolean))];
      const userMap = new Map();

      if (userIds.length > 0) {
        const users = this.db.prepare(`
          SELECT id, name FROM users WHERE id IN (${userIds.map(() => '?').join(',')})
        `).all(...userIds);

        users.forEach(user => userMap.set(user.id, user.name));
      }

      return tickets.map(ticket => ({
        ...ticket,
        created_by_name: userMap.get(ticket.user_id) || 'Unknown User'
      }));
    } catch (error) {
      console.error('[SEARCH] Enrich tickets error:', error);
      return tickets;
    }
  }

  /**
   * Helper: Track search terms for analytics
   */
  trackSearchTerm(query) {
    if (!query || query.length < 2) return;

    const normalizedQuery = query.toLowerCase().trim();
    const currentCount = this.searchStats.searchTerms.get(normalizedQuery) || 0;
    this.searchStats.searchTerms.set(normalizedQuery, currentCount + 1);

    // Keep only top 100 search terms
    if (this.searchStats.searchTerms.size > 100) {
      const entries = Array.from(this.searchStats.searchTerms.entries());
      entries.sort((a, b) => b[1] - a[1]);
      this.searchStats.searchTerms = new Map(entries.slice(0, 100));
    }
  }

  /**
   * Helper: Update response time statistics
   */
  updateResponseTime(responseTime) {
    const currentAvg = this.searchStats.avgResponseTime;
    const totalSearches = this.searchStats.totalSearches;
    
    this.searchStats.avgResponseTime = Math.round(
      (currentAvg * (totalSearches - 1) + responseTime) / totalSearches
    );
  }

  /**
   * Get search analytics
   */
  getSearchStats() {
    return {
      ...this.searchStats,
      topSearchTerms: Array.from(this.searchStats.searchTerms.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([term, count]) => ({ term, count }))
    };
  }

  /**
   * Advanced faceted search
   */
  async facetedSearch(query, facets = {}, options = {}) {
    const results = await this.universalSearch(query, { ...options, ...facets });
    
    // Add facet counts
    const facetCounts = await this.getFacetCounts(query, options);
    
    return {
      ...results,
      facets: facetCounts
    };
  }

  /**
   * Get facet counts for current search
   */
  async getFacetCounts(query, options = {}) {
    // This would calculate facet counts for various filters
    // Implementation would depend on specific faceting requirements
    return {
      status: {},
      priority: {},
      category: {},
      dateRange: {}
    };
  }

  /**
   * Full-text search with ranking
   */
  async fullTextSearch(query, entity, options = {}) {
    // This would implement proper full-text search with ranking
    // For SQLite, this could use FTS5 extension
    // For now, falling back to regular search
    return await this.universalSearch(query, { ...options, entities: [entity] });
  }
}

module.exports = { SearchService };