#!/usr/bin/env node

/**
 * Debug script to test resource search with and without filters
 */

import { config } from 'dotenv';
import { AutotaskService } from '../dist/services/autotask.service.js';
import winston from 'winston';

// Load environment variables
config();

const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.simple()
  ),
  transports: [
    new winston.transports.Console()
  ]
});

async function testResourceSearch() {
  console.log('🔍 Testing resource search...\n');

  // Create the service
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

  const autotaskService = new AutotaskService(serviceConfig, logger);

  try {
    // Initialize (but don't worry about metadata cache errors)
    console.log('📋 Initializing Autotask service...\n');
    await autotaskService.initialize();
    
    console.log('\n✅ Service initialized\n');
    
    // Test 1: Search without filter (first 5 active resources)
    console.log('Test 1: Searching for first 5 active resources (no email filter)...');
    const allResources = await autotaskService.searchResources({ pageSize: 5 });
    console.log(`Found ${allResources.length} resources`);
    
    if (allResources.length > 0) {
      console.log('\nFirst resource details:');
      console.log('  ID:', allResources[0].id);
      console.log('  Email:', allResources[0].email);
      console.log('  First Name:', allResources[0].firstName);
      console.log('  Last Name:', allResources[0].lastName);
      console.log('  Active:', allResources[0].isActive);
      
      console.log('\nAll resource emails:');
      allResources.forEach((r, idx) => {
        console.log(`  ${idx + 1}. ${r.email} (${r.firstName} ${r.lastName})`);
      });
    }
    
    // Test 2: Search with the API user's email
    const apiEmail = process.env.AUTOTASK_USERNAME;
    console.log(`\n\nTest 2: Searching with email filter: ${apiEmail}...`);
    const filteredResources = await autotaskService.searchResources({ 
      email: apiEmail,
      pageSize: 5 
    });
    console.log(`Found ${filteredResources.length} resources with exact email match`);
    
    if (filteredResources.length > 0) {
      console.log('\nMatched resource:');
      console.log('  ID:', filteredResources[0].id);
      console.log('  Email:', filteredResources[0].email);
      console.log('  Name:', `${filteredResources[0].firstName} ${filteredResources[0].lastName}`);
    }
    
    console.log('\n🎉 Test completed successfully!');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Test failed:');
    console.error('  Message:', error.message);
    if (error.response) {
      console.error('  Status:', error.response.status);
      console.error('  Data:', JSON.stringify(error.response.data, null, 2));
    }
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run the test
testResourceSearch().catch(error => {
  console.error('❌ Unexpected error:', error.message);
  console.error(error.stack);
  process.exit(1);
});
