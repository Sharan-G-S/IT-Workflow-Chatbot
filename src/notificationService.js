const crypto = require('crypto');
const https = require('https');

class NotificationService {
  constructor(opts = {}) {
    this.config = {
      // Email settings (if using SMTP)
      emailEnabled: process.env.EMAIL_NOTIFICATIONS === 'true',
      smtpHost: process.env.SMTP_HOST,
      smtpPort: process.env.SMTP_PORT || 587,
      smtpUser: process.env.SMTP_USER,
      smtpPass: process.env.SMTP_PASS,
      fromEmail: process.env.FROM_EMAIL || 'noreply@company.com',
      
      // Webhook settings
      webhookEnabled: process.env.WEBHOOK_NOTIFICATIONS === 'true',
      webhookUrl: process.env.WEBHOOK_URL,
      webhookSecret: process.env.WEBHOOK_SECRET,
      
      // Notification targets
      escalationEmails: (process.env.ESCALATION_EMAILS || '').split(',').filter(e => e.trim()),
      
      ...opts
    };
  }

  async sendEscalationNotification(ticket, escalationInfo = {}) {
    const message = {
      type: 'ticket_escalation',
      timestamp: new Date().toISOString(),
      ticket: {
        id: ticket.id,
        title: ticket.title,
        priority: ticket.priority,
        category: ticket.category,
        created_at: ticket.created_at,
        escalated_at: escalationInfo.escalated_at || new Date().toISOString(),
        escalation_level: escalationInfo.escalation_level || 1
      },
      message: `Ticket #${ticket.id} "${ticket.title}" has been escalated to level ${escalationInfo.escalation_level || 1}. Priority: ${ticket.priority}`
    };

    const results = {
      email: { sent: false, error: null },
      webhook: { sent: false, error: null }
    };

    // Send email notification
    if (this.config.emailEnabled && this.config.escalationEmails.length > 0) {
      try {
        await this.sendEmail(
          this.config.escalationEmails,
          `Ticket Escalation Alert: #${ticket.id}`,
          this.formatEscalationEmail(message)
        );
        results.email.sent = true;
      } catch (err) {
        results.email.error = err.message;
        console.warn('[Notification] Email failed:', err.message);
      }
    }

    // Send webhook notification
    if (this.config.webhookEnabled && this.config.webhookUrl) {
      try {
        await this.sendWebhook(message);
        results.webhook.sent = true;
      } catch (err) {
        results.webhook.error = err.message;
        console.warn('[Notification] Webhook failed:', err.message);
      }
    }

    return results;
  }

  formatEscalationEmail(message) {
    const { ticket } = message;
    return `
Ticket Escalation Alert

Ticket ID: #${ticket.id}
Title: ${ticket.title}
Priority: ${ticket.priority}
Category: ${ticket.category}
Created: ${ticket.created_at}
Escalated: ${ticket.escalated_at}
Escalation Level: ${ticket.escalation_level}

This ticket has exceeded its SLA threshold and requires immediate attention.

View in dashboard: ${process.env.APP_BASE_URL || 'http://localhost:3000'}/dashboard.html

--
IT Workflow Chatbot
Automated Escalation System
    `.trim();
  }

  async sendEmail(recipients, subject, body) {
    // Simple email implementation using nodemailer would go here
    // For now, we'll simulate/log the email
    console.log('[Email Notification]', {
      to: recipients,
      subject,
      body: body.substring(0, 100) + '...'
    });
    
    // In a real implementation, you'd use nodemailer:
    // const nodemailer = require('nodemailer');
    // const transporter = nodemailer.createTransporter({ ... });
    // await transporter.sendMail({ from, to: recipients, subject, text: body });
    
    return { sent: true, recipients: recipients.length };
  }

  async sendWebhook(payload) {
    return new Promise((resolve, reject) => {
      if (!this.config.webhookUrl) {
        return reject(new Error('Webhook URL not configured'));
      }

      const data = JSON.stringify(payload);
      const signature = this.config.webhookSecret 
        ? crypto.createHmac('sha256', this.config.webhookSecret).update(data).digest('hex')
        : null;

      const url = new URL(this.config.webhookUrl);
      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          'User-Agent': 'IT-Workflow-Chatbot/1.0'
        }
      };

      if (signature) {
        options.headers['X-Signature-SHA256'] = `sha256=${signature}`;
      }

      const req = https.request(options, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => responseBody += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ sent: true, status: res.statusCode, response: responseBody });
          } else {
            reject(new Error(`Webhook failed: ${res.statusCode} ${responseBody}`));
          }
        });
      });

      req.on('error', (err) => {
        reject(new Error(`Webhook request failed: ${err.message}`));
      });

      req.write(data);
      req.end();
    });
  }

  // Test notification method
  async sendTestNotification(type = 'webhook') {
    const testPayload = {
      type: 'test_notification',
      timestamp: new Date().toISOString(),
      message: 'Test notification from IT Workflow Chatbot',
      source: 'notification_service'
    };

    if (type === 'webhook') {
      return await this.sendWebhook(testPayload);
    } else if (type === 'email') {
      return await this.sendEmail(
        this.config.escalationEmails,
        'Test Notification - IT Workflow Chatbot',
        'This is a test notification to verify email delivery is working.'
      );
    }
  }

  getConfig() {
    return {
      emailEnabled: this.config.emailEnabled,
      webhookEnabled: this.config.webhookEnabled,
      emailTargets: this.config.escalationEmails.length,
      webhookConfigured: !!this.config.webhookUrl
    };
  }
}

module.exports = new NotificationService();