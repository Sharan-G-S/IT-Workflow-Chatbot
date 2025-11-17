const { Server } = require('socket.io');

/**
 * WebSocket Service - Real-time updates and notifications
 * Provides live updates across the application for tickets, requests, and system events
 */
class WebSocketService {
  constructor(server, options = {}) {
    this.io = new Server(server, {
      cors: {
        origin: true,
        credentials: true
      },
      ...options
    });
    
    this.connectedUsers = new Map();
    this.roomUsers = new Map();
    this.stats = {
      totalConnections: 0,
      activeConnections: 0,
      messagesSent: 0,
      broadcastsSent: 0
    };
    
    this.setupEventHandlers();
    console.log('[WEBSOCKET] Service initialized');
  }

  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      this.handleConnection(socket);
    });
  }

  handleConnection(socket) {
    this.stats.totalConnections++;
    this.stats.activeConnections++;
    
    console.log(`[WEBSOCKET] User connected: ${socket.id}`);

    // Handle user authentication/identification
    socket.on('authenticate', (data) => {
      const { userId, role, name } = data;
      if (userId) {
        this.connectedUsers.set(socket.id, {
          userId,
          role,
          name,
          socketId: socket.id,
          connectedAt: new Date().toISOString()
        });
        
        // Join role-based rooms
        socket.join(`role:${role}`);
        socket.join(`user:${userId}`);
        
        // Notify user of successful authentication
        socket.emit('authenticated', {
          success: true,
          message: 'Connected to real-time updates',
          serverTime: new Date().toISOString()
        });
        
        // Broadcast user join to admins
        this.broadcastToRole('admin', 'user_connected', {
          userId,
          role,
          name,
          connectedAt: new Date().toISOString()
        });
        
        console.log(`[WEBSOCKET] User authenticated: ${name} (${role})`);
      }
    });

    // Handle real-time chat
    socket.on('chat_message', (data) => {
      const user = this.connectedUsers.get(socket.id);
      if (user) {
        const message = {
          ...data,
          userId: user.userId,
          userName: user.name,
          timestamp: new Date().toISOString(),
          socketId: socket.id
        };
        
        // Broadcast to relevant users based on message type
        if (data.target === 'support') {
          this.broadcastToRole('it_staff', 'chat_message', message);
          this.broadcastToRole('admin', 'chat_message', message);
        } else {
          socket.broadcast.emit('chat_message', message);
        }
      }
    });

    // Handle typing indicators
    socket.on('typing_start', () => {
      const user = this.connectedUsers.get(socket.id);
      if (user) {
        socket.broadcast.emit('user_typing', {
          userId: user.userId,
          userName: user.name,
          isTyping: true
        });
      }
    });

    socket.on('typing_stop', () => {
      const user = this.connectedUsers.get(socket.id);
      if (user) {
        socket.broadcast.emit('user_typing', {
          userId: user.userId,
          userName: user.name,
          isTyping: false
        });
      }
    });

    // Handle dashboard updates subscription
    socket.on('subscribe_dashboard', () => {
      socket.join('dashboard_updates');
      console.log(`[WEBSOCKET] ${socket.id} subscribed to dashboard updates`);
    });

    socket.on('unsubscribe_dashboard', () => {
      socket.leave('dashboard_updates');
      console.log(`[WEBSOCKET] ${socket.id} unsubscribed from dashboard updates`);
    });

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      const user = this.connectedUsers.get(socket.id);
      
      if (user) {
        console.log(`[WEBSOCKET] User disconnected: ${user.name} (${reason})`);
        
        // Broadcast user leave to admins
        this.broadcastToRole('admin', 'user_disconnected', {
          userId: user.userId,
          name: user.name,
          reason,
          disconnectedAt: new Date().toISOString()
        });
      } else {
        console.log(`[WEBSOCKET] Anonymous user disconnected: ${socket.id} (${reason})`);
      }
      
      this.connectedUsers.delete(socket.id);
      this.stats.activeConnections = Math.max(0, this.stats.activeConnections - 1);
    });

    // Handle ping/pong for connection health
    socket.on('ping', () => {
      socket.emit('pong', { timestamp: new Date().toISOString() });
    });
  }

  // Notification methods
  notifyTicketCreated(ticket, creatorId = null) {
    const notification = {
      type: 'ticket_created',
      ticket,
      timestamp: new Date().toISOString(),
      message: `New ticket created: ${ticket.title}`
    };

    // Notify IT staff and admins
    this.broadcastToRole('it_staff', 'notification', notification);
    this.broadcastToRole('admin', 'notification', notification);
    
    // Notify creator if specified and different from current user
    if (creatorId) {
      this.sendToUser(creatorId, 'notification', {
        ...notification,
        message: `Your ticket #${ticket.id} has been created`
      });
    }

    this.stats.broadcastsSent++;
  }

  notifyTicketUpdated(ticket, updatedBy = null) {
    const notification = {
      type: 'ticket_updated',
      ticket,
      updatedBy,
      timestamp: new Date().toISOString(),
      message: `Ticket #${ticket.id} updated: ${ticket.title}`
    };

    // Notify ticket creator
    if (ticket.user_id) {
      this.sendToUser(ticket.user_id, 'notification', notification);
    }

    // Notify relevant staff
    this.broadcastToRole('it_staff', 'notification', notification);
    this.broadcastToRole('admin', 'notification', notification);

    this.stats.broadcastsSent++;
  }

  notifyAccessRequestCreated(request, creatorId = null) {
    const notification = {
      type: 'access_request_created',
      request,
      timestamp: new Date().toISOString(),
      message: `New access request: ${request.resource}`
    };

    // Notify IT staff and admins
    this.broadcastToRole('it_staff', 'notification', notification);
    this.broadcastToRole('admin', 'notification', notification);
    
    // Notify creator
    if (creatorId) {
      this.sendToUser(creatorId, 'notification', {
        ...notification,
        message: `Your access request for ${request.resource} has been submitted`
      });
    }

    this.stats.broadcastsSent++;
  }

  notifyAccessRequestApproved(request) {
    const notification = {
      type: 'access_request_approved',
      request,
      timestamp: new Date().toISOString(),
      message: `Access request approved: ${request.resource}`
    };

    // Notify requester
    if (request.user_id) {
      this.sendToUser(request.user_id, 'notification', notification);
    }

    this.stats.broadcastsSent++;
  }

  notifySystemAlert(alert, targetRoles = ['admin']) {
    const notification = {
      type: 'system_alert',
      alert,
      timestamp: new Date().toISOString(),
      message: alert.message
    };

    targetRoles.forEach(role => {
      this.broadcastToRole(role, 'system_alert', notification);
    });

    this.stats.broadcastsSent++;
  }

  notifyOnboardingUpdate(update, targetUserId = null) {
    const notification = {
      type: 'onboarding_update',
      update,
      timestamp: new Date().toISOString(),
      message: `Onboarding update: ${update.message}`
    };

    if (targetUserId) {
      this.sendToUser(targetUserId, 'notification', notification);
    } else {
      this.broadcastToRole('hr', 'notification', notification);
      this.broadcastToRole('admin', 'notification', notification);
    }

    this.stats.broadcastsSent++;
  }

  // Dashboard real-time updates
  broadcastDashboardStats(stats) {
    this.io.to('dashboard_updates').emit('dashboard_stats_update', {
      stats,
      timestamp: new Date().toISOString()
    });

    this.stats.broadcastsSent++;
  }

  broadcastDashboardAlert(alert) {
    this.io.to('dashboard_updates').emit('dashboard_alert', {
      alert,
      timestamp: new Date().toISOString()
    });

    this.stats.broadcastsSent++;
  }

  // Utility methods
  sendToUser(userId, event, data) {
    this.io.to(`user:${userId}`).emit(event, {
      ...data,
      timestamp: new Date().toISOString()
    });
    this.stats.messagesSent++;
  }

  broadcastToRole(role, event, data) {
    this.io.to(`role:${role}`).emit(event, {
      ...data,
      timestamp: new Date().toISOString()
    });
    this.stats.broadcastsSent++;
  }

  broadcastToAll(event, data) {
    this.io.emit(event, {
      ...data,
      timestamp: new Date().toISOString()
    });
    this.stats.broadcastsSent++;
  }

  getConnectedUsers() {
    return Array.from(this.connectedUsers.values());
  }

  getUsersByRole(role) {
    return Array.from(this.connectedUsers.values()).filter(user => user.role === role);
  }

  getStats() {
    return {
      ...this.stats,
      connectedUsers: this.connectedUsers.size,
      usersByRole: this.getUserCountsByRole()
    };
  }

  getUserCountsByRole() {
    const counts = {};
    Array.from(this.connectedUsers.values()).forEach(user => {
      counts[user.role] = (counts[user.role] || 0) + 1;
    });
    return counts;
  }

  // Health check
  isHealthy() {
    return {
      status: 'healthy',
      connectedUsers: this.connectedUsers.size,
      stats: this.stats,
      timestamp: new Date().toISOString()
    };
  }

  // Graceful shutdown
  async shutdown() {
    console.log('[WEBSOCKET] Shutting down...');
    
    // Notify all connected users
    this.broadcastToAll('server_shutdown', {
      message: 'Server is shutting down. Please reconnect in a moment.',
      timestamp: new Date().toISOString()
    });

    // Wait a moment for messages to be sent
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Close all connections
    this.io.close();
    console.log('[WEBSOCKET] Shutdown complete');
  }
}

module.exports = { WebSocketService };