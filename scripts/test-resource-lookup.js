#!/usr/bin/env node

/**
 * Test script to verify resource lookup during server initialization
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

async function testResourceLookup() {
  console.log('🔍 Testing resource lookup during initialization...\n');

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
    console.log('📋 Initializing Autotask service (this will trigger resource lookup)...\n');
    await autotaskService.initialize();
    
    console.log('\n✅ Initialization complete!\n');
    
    // Check if default resource was found
    const defaultResourceId = autotaskService.getDefaultResourceId();
    const cacheInfo = autotaskService.getApiUserCache();
    
    if (defaultResourceId) {
      console.log('✅ Default Resource ID found:', defaultResourceId);
      console.log('📧 Email:', cacheInfo?.email);
      console.log('👤 Name:', cacheInfo?.resourceName);
      console.log('🕒 Last Updated:', cacheInfo?.lastUpdated);
    } else {
      console.log('⚠️  No default resource ID found');
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
    process.exit(1);
  }
}

// Run the test
testResourceLookup().catch(error => {
  console.error('❌ Unexpected error:', error.message);
  console.error(error.stack);
  process.exit(1);
});
