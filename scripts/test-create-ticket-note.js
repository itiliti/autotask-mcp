#!/usr/bin/env node

/**
 * Test script for creating a ticket note
 * Tests the required fields validation and API call
 */

import { config } from 'dotenv';
import { AutotaskService } from '../dist/services/autotask.service.js';
import winston from 'winston';

// Load environment variables
config();

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.simple()
  ),
  transports: [
    new winston.transports.Console()
  ]
});

async function testCreateTicketNote() {
  try {
    console.log('🚀 Starting ticket note creation test...\n');

    // Create service config
    const serviceConfig = {
      autotask: {
        username: process.env.AUTOTASK_USERNAME,
        secret: process.env.AUTOTASK_SECRET,
        integrationCode: process.env.AUTOTASK_INTEGRATION_CODE
      }
    };

    if (!serviceConfig.autotask.username || !serviceConfig.autotask.secret || !serviceConfig.autotask.integrationCode) {
      console.error('❌ Missing required environment variables');
      process.exit(1);
    }

    // Initialize Autotask service
    const service = new AutotaskService(serviceConfig, logger);
    await service.initialize();

    console.log('✅ Service initialized successfully');

    // First, find an existing open ticket to test with
    console.log('\n📋 Searching for an open ticket...');
    const tickets = await service.searchTickets({ pageSize: 1 });
    
    if (tickets.length === 0) {
      console.error('❌ No tickets found to test with');
      process.exit(1);
    }
    
    const testTicket = tickets[0];
    console.log(`✅ Found ticket: ${testTicket.ticketNumber} - ${testTicket.title}`);
    console.log(`   Ticket ID: ${testTicket.id}`);

    // Test data - NO creatorResourceID to test without it
    const noteData = {
      title: 'Ready to Close',
      publish: 1,
      ticketID: testTicket.id,
      description: 'iPhone has been purchased and the ticket is ready to close',
      // Intentionally NOT passing creatorResourceID - API should handle this
    };

    console.log('\n📝 Creating ticket note WITHOUT creatorResourceID:');
    console.log(JSON.stringify(noteData, null, 2));

    // Attempt to create the ticket note
    const result = await service.createTicketNote(noteData);

    console.log('✅ Ticket note created successfully!');
    console.log('Note details:', JSON.stringify({
      id: result.id,
      ticketID: result.ticketID,
      title: result.title,
      description: result.description,
      publish: result.publish,
      noteType: result.noteType,
      createDateTime: result.createDateTime,
    }, null, 2));

    console.log('🎉 Test completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Error details:', error);
    
    if (error.response) {
      console.error('API Response:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data,
      });
    }
    
    process.exit(1);
  }
}

// Run the test
testCreateTicketNote();
