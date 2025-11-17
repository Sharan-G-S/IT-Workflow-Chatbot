const nodemailer = require('nodemailer');
const cron = require('node-cron');

/**
 * Email Notification Service
 * Comprehensive email system for ticket updates, access requests, and system notifications
 */
class EmailService {
  constructor(options = {}) {
    this.config = {
      host: options.host || process.env.SMTP_HOST || 'smtp.gmail.com',
      port: options.port || process.env.SMTP_PORT || 587,
      secure: options.secure || false,
      user: options.user || process.env.SMTP_USER,
      password: options.password || process.env.SMTP_PASSWORD,
      fromAddress: options.fromAddress || process.env.FROM_EMAIL || 'noreply@itworkflow.com',
      fromName: options.fromName || 'IT Workflow Assistant',
      ...options
    };

    this.transporter = null;
    this.emailQueue = [];
    this.isProcessing = false;
    this.stats = {
      sent: 0,
      failed: 0,
      queued: 0,
      lastError: null
    };

    this.templates = this.initializeTemplates();
    this.setupTransporter();
    this.startQueueProcessor();
    
    console.log('[EMAIL] Service initialized');
  }

  setupTransporter() {
    if (!this.config.user || !this.config.password) {
      console.warn('[EMAIL] SMTP credentials not configured. Email notifications disabled.');
      return;
    }

    try {
      this.transporter = nodemailer.createTransporter({
        host: this.config.host,
        port: this.config.port,
        secure: this.config.secure,
        auth: {
          user: this.config.user,
          pass: this.config.password
        },
        tls: {
          rejectUnauthorized: false
        }
      });

      // Verify connection
      this.transporter.verify((error, success) => {
        if (error) {
          console.error('[EMAIL] SMTP verification failed:', error.message);
          this.stats.lastError = error.message;
        } else {
          console.log('[EMAIL] SMTP connection verified successfully');
        }
      });
    } catch (error) {
      console.error('[EMAIL] Failed to setup transporter:', error.message);
      this.stats.lastError = error.message;
    }
  }

  initializeTemplates() {
    return {
      ticketCreated: {
        subject: 'New Support Ticket Created - #{ticketId}',
        template: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; text-align: center;">
              <h1 style="color: white; margin: 0;">IT Workflow Assistant</h1>
            </div>
            <div style="padding: 30px; background: #f9f9f9;">
              <h2 style="color: #333;">New Support Ticket Created</h2>
              <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <p><strong>Ticket ID:</strong> #{ticketId}</p>
                <p><strong>Title:</strong> {title}</p>
                <p><strong>Priority:</strong> <span style="color: {priorityColor};">{priority}</span></p>
                <p><strong>Description:</strong></p>
                <p style="background: #f5f5f5; padding: 15px; border-radius: 4px;">{description}</p>
                <p><strong>Created by:</strong> {createdBy}</p>
                <p><strong>Created at:</strong> {createdAt}</p>
              </div>
              <div style="text-align: center; margin: 30px 0;">
                <a href="{dashboardUrl}" style="background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">View in Dashboard</a>
              </div>
            </div>
            <div style="background: #333; color: white; padding: 15px; text-align: center; font-size: 12px;">
              <p>This is an automated notification from IT Workflow Assistant</p>
            </div>
          </div>
        `
      },

      ticketUpdated: {
        subject: 'Ticket Update - #{ticketId}: {title}',
        template: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; text-align: center;">
              <h1 style="color: white; margin: 0;">IT Workflow Assistant</h1>
            </div>
            <div style="padding: 30px; background: #f9f9f9;">
              <h2 style="color: #333;">Ticket Updated</h2>
              <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <p><strong>Ticket ID:</strong> #{ticketId}</p>
                <p><strong>Title:</strong> {title}</p>
                <p><strong>Status:</strong> <span style="color: {statusColor};">{status}</span></p>
                <p><strong>Priority:</strong> <span style="color: {priorityColor};">{priority}</span></p>
                {updateNote}
                <p><strong>Updated by:</strong> {updatedBy}</p>
                <p><strong>Updated at:</strong> {updatedAt}</p>
              </div>
              <div style="text-align: center; margin: 30px 0;">
                <a href="{dashboardUrl}" style="background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">View Ticket Details</a>
              </div>
            </div>
            <div style="background: #333; color: white; padding: 15px; text-align: center; font-size: 12px;">
              <p>This is an automated notification from IT Workflow Assistant</p>
            </div>
          </div>
        `
      },

      accessRequestCreated: {
        subject: 'New Access Request - {resource}',
        template: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); padding: 20px; text-align: center;">
              <h1 style="color: white; margin: 0;">IT Workflow Assistant</h1>
            </div>
            <div style="padding: 30px; background: #f9f9f9;">
              <h2 style="color: #333;">New Access Request</h2>
              <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <p><strong>Request ID:</strong> #{requestId}</p>
                <p><strong>Resource:</strong> {resource}</p>
                <p><strong>Access Level:</strong> {accessLevel}</p>
                <p><strong>Business Justification:</strong></p>
                <p style="background: #f5f5f5; padding: 15px; border-radius: 4px;">{justification}</p>
                <p><strong>Requested by:</strong> {requestedBy}</p>
                <p><strong>Requested at:</strong> {requestedAt}</p>
                <p><strong>Risk Level:</strong> <span style="color: {riskColor};">{riskLevel}</span></p>
              </div>
              <div style="text-align: center; margin: 30px 0;">
                <a href="{dashboardUrl}" style="background: #11998e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">Review Request</a>
              </div>
            </div>
            <div style="background: #333; color: white; padding: 15px; text-align: center; font-size: 12px;">
              <p>This is an automated notification from IT Workflow Assistant</p>
            </div>
          </div>
        `
      },

      accessRequestApproved: {
        subject: 'Access Request Approved - {resource}',
        template: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #56ab2f 0%, #a8e6cf 100%); padding: 20px; text-align: center;">
              <h1 style="color: white; margin: 0;">IT Workflow Assistant</h1>
            </div>
            <div style="padding: 30px; background: #f9f9f9;">
              <h2 style="color: #28a745;">✅ Access Request Approved</h2>
              <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <p><strong>Request ID:</strong> #{requestId}</p>
                <p><strong>Resource:</strong> {resource}</p>
                <p><strong>Access Level:</strong> {accessLevel}</p>
                <p><strong>Approved by:</strong> {approvedBy}</p>
                <p><strong>Approved at:</strong> {approvedAt}</p>
                <div style="background: #d4edda; padding: 15px; border-radius: 4px; border-left: 4px solid #28a745;">
                  <strong>Next Steps:</strong>
                  <p>{nextSteps}</p>
                </div>
              </div>
              <div style="text-align: center; margin: 30px 0;">
                <a href="{dashboardUrl}" style="background: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">View Details</a>
              </div>
            </div>
            <div style="background: #333; color: white; padding: 15px; text-align: center; font-size: 12px;">
              <p>This is an automated notification from IT Workflow Assistant</p>
            </div>
          </div>
        `
      },

      onboardingReminder: {
        subject: 'Onboarding Task Reminder - {taskName}',
        template: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #ffeaa7 0%, #fab1a0 100%); padding: 20px; text-align: center;">
              <h1 style="color: #2d3436; margin: 0;">IT Workflow Assistant</h1>
            </div>
            <div style="padding: 30px; background: #f9f9f9;">
              <h2 style="color: #e17055;">⏰ Onboarding Task Reminder</h2>
              <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <p><strong>Employee:</strong> {employeeName}</p>
                <p><strong>Task:</strong> {taskName}</p>
                <p><strong>Due Date:</strong> <span style="color: {dueDateColor};">{dueDate}</span></p>
                <p><strong>Status:</strong> {status}</p>
                <div style="background: #fff3cd; padding: 15px; border-radius: 4px; border-left: 4px solid #ffc107;">
                  <strong>Description:</strong>
                  <p>{taskDescription}</p>
                </div>
              </div>
              <div style="text-align: center; margin: 30px 0;">
                <a href="{dashboardUrl}" style="background: #e17055; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">Complete Task</a>
              </div>
            </div>
            <div style="background: #333; color: white; padding: 15px; text-align: center; font-size: 12px;">
              <p>This is an automated notification from IT Workflow Assistant</p>
            </div>
          </div>
        `
      },

      systemAlert: {
        subject: '🚨 System Alert - {alertType}',
        template: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%); padding: 20px; text-align: center;">
              <h1 style="color: white; margin: 0;">🚨 IT Workflow Assistant Alert</h1>
            </div>
            <div style="padding: 30px; background: #f9f9f9;">
              <h2 style="color: #e74c3c;">System Alert</h2>
              <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <p><strong>Alert Type:</strong> {alertType}</p>
                <p><strong>Severity:</strong> <span style="color: {severityColor};">{severity}</span></p>
                <p><strong>Time:</strong> {alertTime}</p>
                <div style="background: #f8d7da; padding: 15px; border-radius: 4px; border-left: 4px solid #dc3545;">
                  <strong>Message:</strong>
                  <p>{message}</p>
                </div>
                {actionRequired}
              </div>
              <div style="text-align: center; margin: 30px 0;">
                <a href="{dashboardUrl}" style="background: #dc3545; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">View System Status</a>
              </div>
            </div>
            <div style="background: #333; color: white; padding: 15px; text-align: center; font-size: 12px;">
              <p>This is an automated notification from IT Workflow Assistant</p>
            </div>
          </div>
        `
      },

      weeklyDigest: {
        subject: 'Weekly IT Summary - {weekOf}',
        template: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; text-align: center;">
              <h1 style="color: white; margin: 0;">Weekly IT Summary</h1>
              <p style="color: #e6e9ff; margin: 5px 0;">Week of {weekOf}</p>
            </div>
            <div style="padding: 30px; background: #f9f9f9;">
              <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h3>📊 This Week's Activity</h3>
                <div style="display: flex; justify-content: space-around; text-align: center; margin: 20px 0;">
                  <div>
                    <div style="font-size: 24px; font-weight: bold; color: #667eea;">{ticketsCreated}</div>
                    <div>New Tickets</div>
                  </div>
                  <div>
                    <div style="font-size: 24px; font-weight: bold; color: #28a745;">{ticketsClosed}</div>
                    <div>Tickets Closed</div>
                  </div>
                  <div>
                    <div style="font-size: 24px; font-weight: bold; color: #ffc107;">{accessRequests}</div>
                    <div>Access Requests</div>
                  </div>
                </div>
              </div>
              
              <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h3>🎯 Key Highlights</h3>
                {highlights}
              </div>
              
              <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h3>⚠️ Items Requiring Attention</h3>
                {attentionItems}
              </div>
              
              <div style="text-align: center; margin: 30px 0;">
                <a href="{dashboardUrl}" style="background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">View Full Dashboard</a>
              </div>
            </div>
            <div style="background: #333; color: white; padding: 15px; text-align: center; font-size: 12px;">
              <p>This is an automated weekly summary from IT Workflow Assistant</p>
            </div>
          </div>
        `
      }
    };
  }

  // Queue email for processing
  queueEmail(emailData) {
    const email = {
      id: Date.now() + Math.random(),
      ...emailData,
      createdAt: new Date().toISOString(),
      attempts: 0,
      maxAttempts: 3
    };
    
    this.emailQueue.push(email);
    this.stats.queued++;
    
    console.log(`[EMAIL] Queued email: ${email.subject}`);
  }

  // Process email queue
  startQueueProcessor() {
    setInterval(() => {
      this.processEmailQueue();
    }, 5000); // Process every 5 seconds

    // Weekly digest scheduler (every Monday at 9 AM)
    cron.schedule('0 9 * * 1', () => {
      this.sendWeeklyDigests();
    });
  }

  async processEmailQueue() {
    if (this.isProcessing || this.emailQueue.length === 0 || !this.transporter) {
      return;
    }

    this.isProcessing = true;

    while (this.emailQueue.length > 0) {
      const email = this.emailQueue.shift();
      
      try {
        await this.sendEmail(email);
        this.stats.sent++;
        console.log(`[EMAIL] Sent successfully: ${email.subject}`);
      } catch (error) {
        email.attempts++;
        console.error(`[EMAIL] Failed to send (attempt ${email.attempts}):`, error.message);
        
        if (email.attempts < email.maxAttempts) {
          // Re-queue for retry
          this.emailQueue.push(email);
        } else {
          this.stats.failed++;
          this.stats.lastError = error.message;
          console.error(`[EMAIL] Max attempts reached, giving up: ${email.subject}`);
        }
      }

      // Rate limiting - wait between emails
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    this.isProcessing = false;
  }

  async sendEmail(email) {
    if (!this.transporter) {
      throw new Error('Email transporter not configured');
    }

    const mailOptions = {
      from: `${this.config.fromName} <${this.config.fromAddress}>`,
      to: email.to,
      subject: email.subject,
      html: email.html || email.template,
      text: email.text
    };

    if (email.cc) mailOptions.cc = email.cc;
    if (email.bcc) mailOptions.bcc = email.bcc;

    return await this.transporter.sendMail(mailOptions);
  }

  // Template methods
  sendTicketCreatedEmail(ticket, userEmail) {
    const template = this.templates.ticketCreated;
    const html = this.populateTemplate(template.template, {
      ticketId: ticket.id,
      title: ticket.title,
      description: ticket.description,
      priority: ticket.priority,
      priorityColor: this.getPriorityColor(ticket.priority),
      createdBy: ticket.created_by || 'System',
      createdAt: new Date(ticket.created_at).toLocaleString(),
      dashboardUrl: `${process.env.BASE_URL || 'http://localhost:3000'}/dashboard.html`
    });

    this.queueEmail({
      to: userEmail,
      subject: template.subject.replace('{ticketId}', ticket.id),
      html
    });
  }

  sendTicketUpdatedEmail(ticket, userEmail, updateNote = '') {
    const template = this.templates.ticketUpdated;
    const html = this.populateTemplate(template.template, {
      ticketId: ticket.id,
      title: ticket.title,
      status: ticket.status,
      statusColor: this.getStatusColor(ticket.status),
      priority: ticket.priority,
      priorityColor: this.getPriorityColor(ticket.priority),
      updateNote: updateNote ? `<p><strong>Update:</strong></p><p style="background: #f5f5f5; padding: 15px; border-radius: 4px;">${updateNote}</p>` : '',
      updatedBy: ticket.updated_by || 'System',
      updatedAt: new Date(ticket.updated_at || Date.now()).toLocaleString(),
      dashboardUrl: `${process.env.BASE_URL || 'http://localhost:3000'}/dashboard.html`
    });

    this.queueEmail({
      to: userEmail,
      subject: template.subject.replace('{ticketId}', ticket.id).replace('{title}', ticket.title),
      html
    });
  }

  sendAccessRequestEmail(request, userEmail, isCreated = true) {
    const template = isCreated ? this.templates.accessRequestCreated : this.templates.accessRequestApproved;
    const templateData = {
      requestId: request.id,
      resource: request.resource,
      accessLevel: request.access_level || 'Standard',
      justification: request.justification,
      requestedBy: request.requested_by || 'System',
      requestedAt: new Date(request.created_at).toLocaleString(),
      riskLevel: request.risk_level || 'Medium',
      riskColor: this.getRiskColor(request.risk_level),
      dashboardUrl: `${process.env.BASE_URL || 'http://localhost:3000'}/dashboard.html`
    };

    if (!isCreated) {
      templateData.approvedBy = request.approved_by || 'System';
      templateData.approvedAt = new Date(request.approved_at || Date.now()).toLocaleString();
      templateData.nextSteps = this.getNextStepsForAccess(request.resource);
    }

    const html = this.populateTemplate(template.template, templateData);

    this.queueEmail({
      to: userEmail,
      subject: template.subject.replace('{resource}', request.resource),
      html
    });
  }

  sendSystemAlertEmail(alert, recipientEmails) {
    const template = this.templates.systemAlert;
    const html = this.populateTemplate(template.template, {
      alertType: alert.type,
      severity: alert.severity,
      severityColor: this.getSeverityColor(alert.severity),
      alertTime: new Date(alert.timestamp).toLocaleString(),
      message: alert.message,
      actionRequired: alert.actionRequired ? 
        `<div style="background: #fff3cd; padding: 15px; border-radius: 4px; border-left: 4px solid #ffc107;">
          <strong>Action Required:</strong>
          <p>${alert.actionRequired}</p>
        </div>` : '',
      dashboardUrl: `${process.env.BASE_URL || 'http://localhost:3000'}/dashboard.html`
    });

    recipientEmails.forEach(email => {
      this.queueEmail({
        to: email,
        subject: template.subject.replace('{alertType}', alert.type),
        html
      });
    });
  }

  async sendWeeklyDigests() {
    // This would fetch analytics data and send weekly summaries
    console.log('[EMAIL] Sending weekly digest emails...');
    // Implementation would fetch data from analytics service
  }

  // Helper methods
  populateTemplate(template, data) {
    let populated = template;
    Object.keys(data).forEach(key => {
      const regex = new RegExp(`{${key}}`, 'g');
      populated = populated.replace(regex, data[key] || '');
    });
    return populated;
  }

  getPriorityColor(priority) {
    const colors = {
      'urgent': '#dc3545',
      'high': '#fd7e14',
      'medium': '#ffc107',
      'low': '#28a745'
    };
    return colors[priority] || '#6c757d';
  }

  getStatusColor(status) {
    const colors = {
      'open': '#007bff',
      'in_progress': '#ffc107',
      'resolved': '#28a745',
      'closed': '#6c757d'
    };
    return colors[status] || '#6c757d';
  }

  getRiskColor(risk) {
    const colors = {
      'low': '#28a745',
      'medium': '#ffc107',
      'high': '#dc3545'
    };
    return colors[risk] || '#6c757d';
  }

  getSeverityColor(severity) {
    const colors = {
      'info': '#17a2b8',
      'warning': '#ffc107',
      'error': '#dc3545',
      'critical': '#bd2130'
    };
    return colors[severity] || '#6c757d';
  }

  getNextStepsForAccess(resource) {
    const nextSteps = {
      'Figma': 'You will receive an invitation email to join the Figma organization within 24 hours.',
      'GitHub': 'Your GitHub access will be provisioned within 2 hours. Check your email for the invitation.',
      'Slack': 'You should receive a Slack invitation within 1 hour. Check your email and accept the invitation.',
      'Jira': 'Your Jira account will be created within 4 hours. Login credentials will be sent separately.',
      'VPN': 'VPN setup instructions and credentials will be provided by the IT team within 24 hours.'
    };
    return nextSteps[resource] || 'The IT team will contact you with next steps within 24 hours.';
  }

  getStats() {
    return {
      ...this.stats,
      queueLength: this.emailQueue.length,
      isProcessing: this.isProcessing,
      transporterConfigured: !!this.transporter
    };
  }

  // Health check
  async testConnection() {
    if (!this.transporter) {
      return { success: false, error: 'Transporter not configured' };
    }

    try {
      await this.transporter.verify();
      return { success: true, message: 'SMTP connection verified' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = { EmailService };