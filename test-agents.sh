#!/bin/bash

# IT Workflow Assistant - Comprehensive Testing Script
echo "🚀 Starting Comprehensive Agent Testing..."

BASE_URL="http://localhost:3000"

# Check if server is running
echo "📡 Checking server status..."
response=$(curl -s -o /dev/null -w "%{http_code}" $BASE_URL)
if [ $response -eq 200 ]; then
    echo "✅ Server is running on port 3000"
else
    echo "❌ Server not responding. Starting server..."
    npm start > server.log 2>&1 &
    sleep 5
fi

echo "🔧 Testing Agent Endpoints..."

# Test 1: Performance Monitoring Agent
echo "📊 Testing Performance Monitoring Agent..."
performance_test=$(curl -s -X POST "$BASE_URL/api/agents/orchestrate" \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=test-session" \
  -d '{"query": "Check system performance and CPU usage"}')

echo "Performance Agent Response: $performance_test"

# Test 2: Knowledge Base Agent  
echo "📚 Testing Knowledge Base Agent..."
knowledge_test=$(curl -s -X POST "$BASE_URL/api/agents/orchestrate" \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=test-session" \
  -d '{"query": "How do I reset my password?"}')

echo "Knowledge Agent Response: $knowledge_test"

# Test 3: Auto Ticket Generation
echo "🎫 Testing Auto Ticket Generation..."
ticket_test=$(curl -s -X POST "$BASE_URL/api/tickets/auto-generate" \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=test-session" \
  -d '{"description": "My laptop is broken and I cannot work urgently", "title": "Critical Hardware Issue"}')

echo "Auto Ticket Response: $ticket_test"

# Test 4: Auto Access Approval
echo "🔐 Testing Auto Access Approval..."
access_test=$(curl -s -X POST "$BASE_URL/api/access/auto-approve" \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=test-session" \
  -d '{"resource": "Figma", "reason": "Need design access for project"}')

echo "Auto Access Response: $access_test"

# Test 5: SLA Monitoring
echo "⏰ Testing SLA Monitoring..."
sla_test=$(curl -s -X GET "$BASE_URL/api/sla/monitor" \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=test-session")

echo "SLA Monitor Response: $sla_test"

# Test 6: Agent Analytics
echo "📈 Testing Agent Analytics..."
analytics_test=$(curl -s -X GET "$BASE_URL/api/agents/analytics" \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=test-session")

echo "Agent Analytics Response: $analytics_test"

echo "✅ All agent tests completed!"
echo "🎯 Check responses above for any errors or issues."
echo "🌐 Access dashboard at: http://localhost:3000/dashboard.html"