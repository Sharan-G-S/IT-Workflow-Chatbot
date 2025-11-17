const axios = require('axios');
const cron = require('node-cron');

/**
 * External Integrations Service
 * Bidirectional sync with Jira and ServiceNow for ticket management
 */
class ExternalIntegrationsService {
  constructor(database, options = {}) {
    this.db = database;
    this.config = {
      jira: {
        enabled: options.jira?.enabled || false,
        baseUrl: options.jira?.baseUrl || process.env.JIRA_BASE_URL,
        username: options.jira?.username || process.env.JIRA_USERNAME,
        apiToken: options.jira?.apiToken || process.env.JIRA_API_TOKEN,
        projectKey: options.jira?.projectKey || process.env.JIRA_PROJECT_KEY || 'ITSUPPORT',
        issueTypeId: options.jira?.issueTypeId || '10001' // Task
      },
      servicenow: {
        enabled: options.servicenow?.enabled || false,
        instanceUrl: options.servicenow?.instanceUrl || process.env.SERVICENOW_INSTANCE_URL,
        username: options.servicenow?.username || process.env.SERVICENOW_USERNAME,
        password: options.servicenow?.password || process.env.SERVICENOW_PASSWORD,
        table: options.servicenow?.table || 'incident'
      },
      sync: {
        enabled: options.sync?.enabled || false,
        interval: options.sync?.interval || '*/15 * * * *', // Every 15 minutes
        batchSize: options.sync?.batchSize || 10
      }
    };

    this.syncStats = {
      lastSync: null,
      totalSynced: 0,
      syncErrors: 0,
      jiraSynced: 0,
      servicenowSynced: 0
    };

    this.syncQueue = [];
    this.isInitialized = false;

    this.initializeServices();
  }

  async initializeServices() {
    try {
      // Test connections
      if (this.config.jira.enabled) {
        await this.testJiraConnection();
      }

      if (this.config.servicenow.enabled) {
        await this.testServiceNowConnection();
      }

      // Setup sync scheduler
      if (this.config.sync.enabled) {
        this.setupSyncScheduler();
      }

      // Create sync mapping table
      this.createSyncMappingTable();

      this.isInitialized = true;
      console.log('[INTEGRATIONS] External integrations initialized');
      console.log(`[INTEGRATIONS] Jira: ${this.config.jira.enabled ? 'enabled' : 'disabled'}`);
      console.log(`[INTEGRATIONS] ServiceNow: ${this.config.servicenow.enabled ? 'enabled' : 'disabled'}`);
    } catch (error) {
      console.error('[INTEGRATIONS] Initialization error:', error.message);
    }
  }

  /**
   * Create sync mapping table to track external system relationships
   */
  createSyncMappingTable() {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS external_sync_mappings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          local_id INTEGER NOT NULL,
          local_type VARCHAR(50) NOT NULL,
          external_system VARCHAR(50) NOT NULL,
          external_id VARCHAR(100) NOT NULL,
          external_key VARCHAR(100),
          sync_direction VARCHAR(20) DEFAULT 'bidirectional',
          last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          sync_status VARCHAR(20) DEFAULT 'active',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(local_id, local_type, external_system)
        )
      `);

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS sync_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          external_system VARCHAR(50) NOT NULL,
          operation VARCHAR(50) NOT NULL,
          local_id INTEGER,
          external_id VARCHAR(100),
          status VARCHAR(20) NOT NULL,
          error_message TEXT,
          sync_data TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      console.log('[INTEGRATIONS] Sync mapping tables created');
    } catch (error) {
      console.error('[INTEGRATIONS] Table creation error:', error);
    }
  }

  /**
   * JIRA Integration Methods
   */
  async testJiraConnection() {
    if (!this.config.jira.baseUrl || !this.config.jira.username || !this.config.jira.apiToken) {
      throw new Error('Jira configuration incomplete');
    }

    try {
      const auth = Buffer.from(`${this.config.jira.username}:${this.config.jira.apiToken}`).toString('base64');
      
      const response = await axios.get(`${this.config.jira.baseUrl}/rest/api/3/myself`, {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Accept': 'application/json'
        },
        timeout: 10000
      });

      console.log(`[INTEGRATIONS] Jira connection successful: ${response.data.displayName}`);
      return true;
    } catch (error) {
      console.error('[INTEGRATIONS] Jira connection failed:', error.message);
      throw error;
    }
  }

  async createJiraIssue(ticket) {
    if (!this.config.jira.enabled) {
      console.warn('[INTEGRATIONS] Jira not enabled, skipping issue creation');
      return null;
    }

    try {
      const auth = Buffer.from(`${this.config.jira.username}:${this.config.jira.apiToken}`).toString('base64');
      
      const jiraIssue = {
        fields: {
          project: {
            key: this.config.jira.projectKey
          },
          summary: ticket.title,
          description: {
            type: 'doc',
            version: 1,
            content: [{
              type: 'paragraph',
              content: [{
                type: 'text',
                text: ticket.description || 'No description provided'
              }]
            }]
          },
          issuetype: {
            id: this.config.jira.issueTypeId
          },
          priority: {
            name: this.mapPriorityToJira(ticket.priority)
          },
          labels: ['it-workflow-assistant', `priority-${ticket.priority}`]
        }
      };

      const response = await axios.post(
        `${this.config.jira.baseUrl}/rest/api/3/issue`,
        jiraIssue,
        {
          headers: {
            'Authorization': `Basic ${auth}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          timeout: 15000
        }
      );

      const jiraKey = response.data.key;
      const jiraId = response.data.id;

      // Store mapping
      await this.createSyncMapping(ticket.id, 'ticket', 'jira', jiraId, jiraKey);

      // Log sync
      this.logSync('jira', 'create_issue', ticket.id, jiraId, 'success', null, {
        jira_key: jiraKey,
        ticket_title: ticket.title
      });

      this.syncStats.jiraSynced++;
      console.log(`[INTEGRATIONS] Created Jira issue: ${jiraKey}`);

      return {
        id: jiraId,
        key: jiraKey,
        url: `${this.config.jira.baseUrl}/browse/${jiraKey}`
      };
    } catch (error) {
      console.error('[INTEGRATIONS] Jira issue creation failed:', error.message);
      this.logSync('jira', 'create_issue', ticket.id, null, 'error', error.message);
      this.syncStats.syncErrors++;
      throw error;
    }
  }

  async updateJiraIssue(ticket, jiraKey) {
    if (!this.config.jira.enabled) return null;

    try {
      const auth = Buffer.from(`${this.config.jira.username}:${this.config.jira.apiToken}`).toString('base64');
      
      const updateData = {
        fields: {
          summary: ticket.title,
          description: {
            type: 'doc',
            version: 1,
            content: [{
              type: 'paragraph',
              content: [{
                type: 'text',
                text: ticket.description || 'No description provided'
              }]
            }]
          },
          priority: {
            name: this.mapPriorityToJira(ticket.priority)
          }
        }
      };

      // Update status if needed
      if (ticket.status === 'resolved' || ticket.status === 'closed') {
        // Transition to Done (this would need to be configured based on Jira workflow)
        await this.transitionJiraIssue(jiraKey, '31'); // Done transition ID
      }

      await axios.put(
        `${this.config.jira.baseUrl}/rest/api/3/issue/${jiraKey}`,
        updateData,
        {
          headers: {
            'Authorization': `Basic ${auth}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          timeout: 15000
        }
      );

      this.logSync('jira', 'update_issue', ticket.id, jiraKey, 'success');
      console.log(`[INTEGRATIONS] Updated Jira issue: ${jiraKey}`);

      return true;
    } catch (error) {
      console.error('[INTEGRATIONS] Jira issue update failed:', error.message);
      this.logSync('jira', 'update_issue', ticket.id, jiraKey, 'error', error.message);
      this.syncStats.syncErrors++;
      return false;
    }
  }

  async transitionJiraIssue(issueKey, transitionId) {
    const auth = Buffer.from(`${this.config.jira.username}:${this.config.jira.apiToken}`).toString('base64');
    
    await axios.post(
      `${this.config.jira.baseUrl}/rest/api/3/issue/${issueKey}/transitions`,
      {
        transition: {
          id: transitionId
        }
      },
      {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      }
    );
  }

  mapPriorityToJira(priority) {
    const mapping = {
      'urgent': 'Highest',
      'high': 'High',
      'medium': 'Medium',
      'low': 'Low'
    };
    return mapping[priority] || 'Medium';
  }

  /**
   * ServiceNow Integration Methods
   */
  async testServiceNowConnection() {
    if (!this.config.servicenow.instanceUrl || !this.config.servicenow.username || !this.config.servicenow.password) {
      throw new Error('ServiceNow configuration incomplete');
    }

    try {
      const auth = Buffer.from(`${this.config.servicenow.username}:${this.config.servicenow.password}`).toString('base64');
      
      const response = await axios.get(
        `${this.config.servicenow.instanceUrl}/api/now/table/sys_user?sysparm_limit=1`,
        {
          headers: {
            'Authorization': `Basic ${auth}`,
            'Accept': 'application/json'
          },
          timeout: 10000
        }
      );

      console.log('[INTEGRATIONS] ServiceNow connection successful');
      return true;
    } catch (error) {
      console.error('[INTEGRATIONS] ServiceNow connection failed:', error.message);
      throw error;
    }
  }

  async createServiceNowIncident(ticket) {
    if (!this.config.servicenow.enabled) {
      console.warn('[INTEGRATIONS] ServiceNow not enabled, skipping incident creation');
      return null;
    }

    try {
      const auth = Buffer.from(`${this.config.servicenow.username}:${this.config.servicenow.password}`).toString('base64');
      
      const incident = {
        short_description: ticket.title,
        description: ticket.description || 'No description provided',
        priority: this.mapPriorityToServiceNow(ticket.priority),
        urgency: this.mapPriorityToServiceNow(ticket.priority),
        impact: '3', // Low impact by default
        category: 'Software',
        subcategory: 'IT Support',
        u_source: 'IT Workflow Assistant'
      };

      const response = await axios.post(
        `${this.config.servicenow.instanceUrl}/api/now/table/${this.config.servicenow.table}`,
        incident,
        {
          headers: {
            'Authorization': `Basic ${auth}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          timeout: 15000
        }
      );

      const sysId = response.data.result.sys_id;
      const incidentNumber = response.data.result.number;

      // Store mapping
      await this.createSyncMapping(ticket.id, 'ticket', 'servicenow', sysId, incidentNumber);

      // Log sync
      this.logSync('servicenow', 'create_incident', ticket.id, sysId, 'success', null, {
        incident_number: incidentNumber,
        ticket_title: ticket.title
      });

      this.syncStats.servicenowSynced++;
      console.log(`[INTEGRATIONS] Created ServiceNow incident: ${incidentNumber}`);

      return {
        id: sysId,
        number: incidentNumber,
        url: `${this.config.servicenow.instanceUrl}/nav_to.do?uri=incident.do?sys_id=${sysId}`
      };
    } catch (error) {
      console.error('[INTEGRATIONS] ServiceNow incident creation failed:', error.message);
      this.logSync('servicenow', 'create_incident', ticket.id, null, 'error', error.message);
      this.syncStats.syncErrors++;
      throw error;
    }
  }

  async updateServiceNowIncident(ticket, sysId) {
    if (!this.config.servicenow.enabled) return null;

    try {
      const auth = Buffer.from(`${this.config.servicenow.username}:${this.config.servicenow.password}`).toString('base64');
      
      const updateData = {
        short_description: ticket.title,
        description: ticket.description || 'No description provided',
        priority: this.mapPriorityToServiceNow(ticket.priority),
        urgency: this.mapPriorityToServiceNow(ticket.priority),
        state: this.mapStatusToServiceNow(ticket.status)
      };

      await axios.put(
        `${this.config.servicenow.instanceUrl}/api/now/table/${this.config.servicenow.table}/${sysId}`,
        updateData,
        {
          headers: {
            'Authorization': `Basic ${auth}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          timeout: 15000
        }
      );

      this.logSync('servicenow', 'update_incident', ticket.id, sysId, 'success');
      console.log(`[INTEGRATIONS] Updated ServiceNow incident: ${sysId}`);

      return true;
    } catch (error) {
      console.error('[INTEGRATIONS] ServiceNow incident update failed:', error.message);
      this.logSync('servicenow', 'update_incident', ticket.id, sysId, 'error', error.message);
      this.syncStats.syncErrors++;
      return false;
    }
  }

  mapPriorityToServiceNow(priority) {
    const mapping = {
      'urgent': '1',
      'high': '2',
      'medium': '3',
      'low': '4'
    };
    return mapping[priority] || '3';
  }

  mapStatusToServiceNow(status) {
    const mapping = {
      'open': '1',       // New
      'in_progress': '2', // In Progress
      'resolved': '6',    // Resolved
      'closed': '7'       // Closed
    };
    return mapping[status] || '1';
  }

  /**
   * Sync Management Methods
   */
  async syncTicketToExternalSystems(ticket) {
    const results = {};

    try {
      // Check if already synced
      const existingMappings = this.getSyncMappings(ticket.id, 'ticket');

      // Sync to Jira
      if (this.config.jira.enabled) {
        const jiraMapping = existingMappings.find(m => m.external_system === 'jira');
        
        if (jiraMapping) {
          // Update existing
          results.jira = await this.updateJiraIssue(ticket, jiraMapping.external_key);
        } else {
          // Create new
          results.jira = await this.createJiraIssue(ticket);
        }
      }

      // Sync to ServiceNow
      if (this.config.servicenow.enabled) {
        const snowMapping = existingMappings.find(m => m.external_system === 'servicenow');
        
        if (snowMapping) {
          // Update existing
          results.servicenow = await this.updateServiceNowIncident(ticket, snowMapping.external_id);
        } else {
          // Create new
          results.servicenow = await this.createServiceNowIncident(ticket);
        }
      }

      return results;
    } catch (error) {
      console.error('[INTEGRATIONS] Sync error:', error.message);
      throw error;
    }
  }

  /**
   * Bidirectional sync - pull updates from external systems
   */
  async syncFromExternalSystems() {
    if (!this.config.sync.enabled) return;

    console.log('[INTEGRATIONS] Starting bidirectional sync...');
    
    try {
      // Get all active mappings
      const mappings = this.db.prepare(`
        SELECT * FROM external_sync_mappings 
        WHERE sync_status = 'active' 
        AND sync_direction IN ('inbound', 'bidirectional')
        ORDER BY last_synced_at ASC
        LIMIT ?
      `).all(this.config.sync.batchSize);

      for (const mapping of mappings) {
        try {
          if (mapping.external_system === 'jira') {
            await this.syncFromJira(mapping);
          } else if (mapping.external_system === 'servicenow') {
            await this.syncFromServiceNow(mapping);
          }

          // Update last synced timestamp
          this.updateSyncMapping(mapping.id, { last_synced_at: new Date().toISOString() });
        } catch (error) {
          console.error(`[INTEGRATIONS] Failed to sync mapping ${mapping.id}:`, error.message);
          this.syncStats.syncErrors++;
        }
      }

      this.syncStats.lastSync = new Date().toISOString();
      this.syncStats.totalSynced += mappings.length;
      
      console.log(`[INTEGRATIONS] Bidirectional sync completed: ${mappings.length} items processed`);
    } catch (error) {
      console.error('[INTEGRATIONS] Bidirectional sync error:', error.message);
    }
  }

  async syncFromJira(mapping) {
    if (!this.config.jira.enabled) return;

    try {
      const auth = Buffer.from(`${this.config.jira.username}:${this.config.jira.apiToken}`).toString('base64');
      
      const response = await axios.get(
        `${this.config.jira.baseUrl}/rest/api/3/issue/${mapping.external_id}`,
        {
          headers: {
            'Authorization': `Basic ${auth}`,
            'Accept': 'application/json'
          }
        }
      );

      const jiraIssue = response.data;
      
      // Update local ticket if changed
      const localTicket = this.db.prepare('SELECT * FROM tickets WHERE id = ?').get(mapping.local_id);
      
      if (localTicket) {
        const updates = {};
        let hasUpdates = false;

        // Check for status changes
        const jiraStatus = this.mapJiraStatusToLocal(jiraIssue.fields.status.name);
        if (jiraStatus && jiraStatus !== localTicket.status) {
          updates.status = jiraStatus;
          hasUpdates = true;
        }

        // Check for priority changes
        const jiraPriority = this.mapJiraPriorityToLocal(jiraIssue.fields.priority?.name);
        if (jiraPriority && jiraPriority !== localTicket.priority) {
          updates.priority = jiraPriority;
          hasUpdates = true;
        }

        if (hasUpdates) {
          updates.updated_at = new Date().toISOString();
          updates.sync_note = 'Updated from Jira';
          
          const updateQuery = Object.keys(updates).map(key => `${key} = ?`).join(', ');
          const updateValues = Object.values(updates);
          
          this.db.prepare(`UPDATE tickets SET ${updateQuery} WHERE id = ?`).run(...updateValues, mapping.local_id);
          
          console.log(`[INTEGRATIONS] Updated ticket ${mapping.local_id} from Jira ${mapping.external_key}`);
        }
      }
    } catch (error) {
      console.error(`[INTEGRATIONS] Jira sync error for ${mapping.external_key}:`, error.message);
      throw error;
    }
  }

  async syncFromServiceNow(mapping) {
    // Similar implementation for ServiceNow
    // This would pull updates from ServiceNow incidents and update local tickets
  }

  mapJiraStatusToLocal(jiraStatus) {
    const mapping = {
      'To Do': 'open',
      'In Progress': 'in_progress',
      'Done': 'resolved',
      'Closed': 'closed'
    };
    return mapping[jiraStatus];
  }

  mapJiraPriorityToLocal(jiraPriority) {
    const mapping = {
      'Highest': 'urgent',
      'High': 'high',
      'Medium': 'medium',
      'Low': 'low'
    };
    return mapping[jiraPriority];
  }

  /**
   * Database helper methods
   */
  async createSyncMapping(localId, localType, externalSystem, externalId, externalKey = null) {
    try {
      this.db.prepare(`
        INSERT OR REPLACE INTO external_sync_mappings 
        (local_id, local_type, external_system, external_id, external_key, last_synced_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(localId, localType, externalSystem, externalId, externalKey, new Date().toISOString());
    } catch (error) {
      console.error('[INTEGRATIONS] Create mapping error:', error);
    }
  }

  getSyncMappings(localId, localType) {
    return this.db.prepare(`
      SELECT * FROM external_sync_mappings 
      WHERE local_id = ? AND local_type = ? AND sync_status = 'active'
    `).all(localId, localType);
  }

  updateSyncMapping(mappingId, updates) {
    const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = Object.values(updates);
    
    this.db.prepare(`UPDATE external_sync_mappings SET ${setClause} WHERE id = ?`)
      .run(...values, mappingId);
  }

  logSync(externalSystem, operation, localId, externalId, status, errorMessage = null, syncData = null) {
    try {
      this.db.prepare(`
        INSERT INTO sync_logs 
        (external_system, operation, local_id, external_id, status, error_message, sync_data)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        externalSystem, 
        operation, 
        localId, 
        externalId, 
        status, 
        errorMessage, 
        syncData ? JSON.stringify(syncData) : null
      );
    } catch (error) {
      console.error('[INTEGRATIONS] Log sync error:', error);
    }
  }

  /**
   * Scheduler setup
   */
  setupSyncScheduler() {
    console.log(`[INTEGRATIONS] Setting up sync scheduler: ${this.config.sync.interval}`);
    
    cron.schedule(this.config.sync.interval, async () => {
      await this.syncFromExternalSystems();
    });
  }

  /**
   * Public API methods
   */
  async getIntegrationStatus() {
    return {
      jira: {
        enabled: this.config.jira.enabled,
        configured: !!(this.config.jira.baseUrl && this.config.jira.username && this.config.jira.apiToken),
        lastSync: this.syncStats.lastSync
      },
      servicenow: {
        enabled: this.config.servicenow.enabled,
        configured: !!(this.config.servicenow.instanceUrl && this.config.servicenow.username && this.config.servicenow.password),
        lastSync: this.syncStats.lastSync
      },
      sync: {
        enabled: this.config.sync.enabled,
        stats: this.syncStats
      }
    };
  }

  async getSyncLogs(limit = 50, system = null) {
    let query = 'SELECT * FROM sync_logs';
    let params = [];
    
    if (system) {
      query += ' WHERE external_system = ?';
      params.push(system);
    }
    
    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    
    return this.db.prepare(query).all(...params);
  }

  async forceSyncTicket(ticketId) {
    try {
      const ticket = this.db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
      if (!ticket) {
        throw new Error('Ticket not found');
      }

      const results = await this.syncTicketToExternalSystems(ticket);
      return {
        success: true,
        results,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Cleanup and maintenance
   */
  async cleanupOldLogs(daysToKeep = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
      
      const result = this.db.prepare(`
        DELETE FROM sync_logs 
        WHERE created_at < ?
      `).run(cutoffDate.toISOString());
      
      console.log(`[INTEGRATIONS] Cleaned up ${result.changes} old sync logs`);
      return result.changes;
    } catch (error) {
      console.error('[INTEGRATIONS] Cleanup error:', error);
      return 0;
    }
  }
}

module.exports = { ExternalIntegrationsService };