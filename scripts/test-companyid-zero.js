/**
 * Test script to verify companyID 0 (default/system company) works with validation
 */

import { config } from 'dotenv';
import { AutotaskService } from '../dist/services/autotask.service.js';
import winston from 'winston';

// Load environment variables
config();

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.simple(),
  transports: [new winston.transports.Console()],
});

async function testCompanyIdZero() {
  console.log('=== Testing companyID 0 (default/system company) ===\n');

  try {
    // Initialize service
    console.log('1. Initializing Autotask service...');
    const mcpConfig = {
      autotask: {
        username: process.env.AUTOTASK_USERNAME,
        secret: process.env.AUTOTASK_SECRET,
        integrationCode: process.env.AUTOTASK_INTEGRATION_CODE,
        apiUrl: process.env.AUTOTASK_API_URL || 'https://webservices2.autotask.net/ATServicesRest',
      },
    };
    const service = new AutotaskService(mcpConfig, logger);
    await service.initialize();
    console.log('   ✅ Service initialized\n');

    // Test searching tickets with companyID 0
    console.log('2. Testing search tickets with companyID 0...');
    const ticketResults = await service.searchTickets({
      companyID: 0,
      pageSize: 5,
    });
    console.log(`   ✅ Search successful - found ${ticketResults.items?.length || 0} tickets`);
    if (ticketResults.items?.length > 0) {
      console.log(`   First ticket: ID ${ticketResults.items[0].id}, Title: "${ticketResults.items[0].title}"`);
    }
    console.log();

    // Test searching contacts with companyID 0
    console.log('3. Testing search contacts with companyID 0...');
    const contactResults = await service.searchContacts({
      companyID: 0,
      pageSize: 5,
    });
    console.log(`   ✅ Search successful - found ${contactResults.items?.length || 0} contacts`);
    if (contactResults.items?.length > 0) {
      console.log(`   First contact: ID ${contactResults.items[0].id}, Name: "${contactResults.items[0].firstName} ${contactResults.items[0].lastName}"`);
    }
    console.log();

    // Test searching projects with companyID 0
    console.log('4. Testing search projects with companyID 0...');
    const projectResults = await service.searchProjects({
      companyID: 0,
      pageSize: 5,
    });
    console.log(`   ✅ Search successful - found ${projectResults.items?.length || 0} projects`);
    if (projectResults.items?.length > 0) {
      console.log(`   First project: ID ${projectResults.items[0].id}, Name: "${projectResults.items[0].projectName}"`);
    }
    console.log();

    console.log('=== All tests passed! companyID 0 is now allowed ===');
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.issues) {
      console.error('Validation errors:', JSON.stringify(error.issues, null, 2));
    }
    process.exit(1);
  }
}

testCompanyIdZero();
