import type { ScheduledEvent } from 'aws-lambda';
import {
    bulkInsertTeamHistory,
    fetchValidMLBPlayers,
    fetchValidMLBTeamsCSV,
    logCronExecution
} from '../../database';
import {
    formatEasternTime,
    getEnvironmentType,
    sendCronErrorNotification,
    sendCronSuccessNotification
} from '../../notifications';
import { MLBTransactionsAPIResponse, TeamHistoryRecord } from '../../types';

interface MLBUploadEvent extends ScheduledEvent {
  startDate?: string;
  endDate?: string;
}

const MLB_TRANSACTIONS_API_URL = "https://statsapi.mlb.com/api/v1/transactions";
const API_TIMEOUT = 30000; // 30 seconds

/**
 * Validate date string format and logic
 */
function validateDateParameters(startDate: string, endDate: string): void {
  // Check date format (YYYY-MM-DD)
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  
  if (!dateRegex.test(startDate)) {
    throw new Error(`Invalid startDate format: ${startDate}. Expected YYYY-MM-DD`);
  }
  
  if (!dateRegex.test(endDate)) {
    throw new Error(`Invalid endDate format: ${endDate}. Expected YYYY-MM-DD`);
  }
  
  // Check if dates are valid
  const startDateObj = new Date(startDate);
  const endDateObj = new Date(endDate);
  
  if (isNaN(startDateObj.getTime())) {
    throw new Error(`Invalid startDate: ${startDate}`);
  }
  
  if (isNaN(endDateObj.getTime())) {
    throw new Error(`Invalid endDate: ${endDate}`);
  }
  
  // Check startDate <= endDate
  if (startDateObj > endDateObj) {
    throw new Error(`startDate (${startDate}) must be less than or equal to endDate (${endDate})`);
  }
}

/**
 * Calculate yesterday's date in YYYY-MM-DD format
 */
function getYesterday(): string {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.toISOString().split('T')[0];
}

/**
 * Calculate tomorrow's date in YYYY-MM-DD format
 */
function getTomorrow(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().split('T')[0];
}

/**
 * Fetch MLB transactions from the API for the given date range and team filter
 */
async function fetchMLBTransactions(
  startDate: string, 
  endDate: string, 
  teamIds: string
): Promise<MLBTransactionsAPIResponse> {
  const url = `${MLB_TRANSACTIONS_API_URL}?startDate=${startDate}&endDate=${endDate}&teamId=${teamIds}`;
  
  console.log(`Fetching MLB transactions from: ${url}`);
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);
    
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'QuickGrade-MLBUploader/1.0',
      },
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    console.log(`Successfully fetched ${data.transactions?.length || 0} transactions`);
    return data;
    
  } catch (error) {
    console.error('Failed to fetch MLB transactions:', error);
    throw error;
  }
}

/**
 * Process transactions and filter for valid players
 */
function processTransactions(
  transactions: MLBTransactionsAPIResponse['transactions'],
  validPlayers: Set<number>,
  validTeamIdsCsv: string
): TeamHistoryRecord[] {
  const teamHistoryRecords: TeamHistoryRecord[] = [];
  const validTeamIds = new Set(validTeamIdsCsv.split(',').map(id => parseInt(id, 10)));

  for (const transaction of transactions) {
    // Skip transactions without a player
    if (!transaction.person?.id) {
      continue;
    }
    
    // Skip transactions for players not in our database
    if (!validPlayers.has(transaction.person.id)) {
      continue;
    }
    
    // Skip transactions without toTeam (already filtered by API, but double-check)
    if (!transaction.toTeam?.id) {
      continue;
    }

    // Filter by toTeam.id being in the provided list of valid team IDs
    if (!validTeamIds.has(transaction.toTeam.id)) {
      continue;
    }
    
    // Parse the transaction date
    const transactionDate = new Date(transaction.date);
    if (isNaN(transactionDate.getTime())) {
      console.warn(`Invalid date format for transaction ${transaction.id}: ${transaction.date}`);
      continue;
    }
    
    // Truncate description if too long
    let description = transaction.description || '';
    if (description.length > 255) {
      description = description.substring(0, 255);
    }
    
    teamHistoryRecords.push({
      MLBPlayer: transaction.person.id,
      Date: transactionDate,
      MLBTeam: transaction.toTeam.id,
      Description: description
    });
  }
  
  console.log(`Processed ${teamHistoryRecords.length} valid team history records from ${transactions.length} transactions`);
  return teamHistoryRecords;
}

export const handler = async (event: MLBUploadEvent) => {
  console.log('MLB Player Team History upload started:', event);
  const startTime = new Date();
  const environment = getEnvironmentType();
  const easternTimeString = formatEasternTime(startTime);
  
  console.log(`Handler running in ${environment.toUpperCase()} environment`);
  console.log(`Job started at: ${easternTimeString} ET`);
  
  try {
    // Log cron execution using the new shared function
    await logCronExecution(easternTimeString, environment);
    console.log(`Successfully logged cron execution for ${process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.CRON_JOB_NAME }`);

    // Get and validate date parameters
    let startDate: string, endDate: string;
    
    if (environment === 'local') {
      // Local: read from environment variables
      startDate = process.env.START_DATE || getYesterday();
      endDate = process.env.END_DATE || getTomorrow();
    } else {
      // Lambda: get from event or use default (yesterday/tomorrow)
      startDate = event.startDate || getYesterday();
      endDate = event.endDate || getTomorrow();
    }
    
    // Validate required parameters
    if (!startDate || !endDate) {
      throw new Error('Missing required parameters: startDate and endDate must be provided');
    }
    
    validateDateParameters(startDate, endDate);
    
    console.log(`Processing transactions for date range: ${startDate} to ${endDate}`);
    
    // Step 1: Fetch valid teams for API filtering
    console.log('Fetching valid MLB teams...');
    const validTeamsCsv = await fetchValidMLBTeamsCSV();
    
    if (!validTeamsCsv) {
      throw new Error('No valid MLB teams found in database');
    }
    
    console.log(`Using team filter: ${validTeamsCsv}`);
    
    // Step 2: Fetch valid players for client-side filtering
    console.log('Fetching valid MLB players...');
    const validPlayers = await fetchValidMLBPlayers();
    
    if (validPlayers.size === 0) {
      throw new Error('No valid MLB players found in database');
    }
    
    console.log(`Found ${validPlayers.size} valid players for filtering`);
    
    // Step 3: Fetch transactions from MLB API
    console.log('Fetching transactions from MLB API...');
    const apiResponse = await fetchMLBTransactions(startDate, endDate, validTeamsCsv);
    
    if (!apiResponse.transactions || apiResponse.transactions.length === 0) {
      console.log('No transactions found for the specified date range');
      
      // Send success notification even with no transactions
      await sendCronSuccessNotification({
        jobName: 'upload-mlb-player-team-history',
        stage: process.env.STAGE || 'unknown',
        startTime: easternTimeString,
        environment,
        additionalInfo: {
          'Date range': `${startDate} to ${endDate}`,
          'Transactions found': 0,
          'Records processed': 0,
          'Records inserted': 0
        }
      });
      
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No transactions found for the specified date range',
          startDate,
          endDate,
          transactionsFound: 0,
          recordsProcessed: 0,
          recordsInserted: 0,
          environment
        })
      };
    }
    
    // Step 4: Process and filter transactions
    console.log('Processing and filtering transactions...');
    const teamHistoryRecords = processTransactions(apiResponse.transactions, validPlayers, validTeamsCsv);
    
    // Step 5: Insert records into database
    if (teamHistoryRecords.length > 0) {
      console.log('Inserting team history records into database...');
      await bulkInsertTeamHistory(teamHistoryRecords);
    } else {
      console.log('No valid team history records to insert');
    }
    
    // Step 6: Send success notification
    await sendCronSuccessNotification({
      jobName: 'upload-mlb-player-team-history',
      stage: process.env.STAGE || 'unknown',
      startTime: easternTimeString,
      environment,
      additionalInfo: {
        'Date range': `${startDate} to ${endDate}`,
        'Transactions found': apiResponse.transactions.length,
        'Records processed': teamHistoryRecords.length,
        'Records inserted': teamHistoryRecords.length,
        'Valid teams': validTeamsCsv.split(',').length,
        'Valid players': validPlayers.size
      }
    });
    
    console.log('MLB Player Team History upload completed successfully');
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'MLB Player Team History upload completed successfully',
        startDate,
        endDate,
        transactionsFound: apiResponse.transactions.length,
        recordsProcessed: teamHistoryRecords.length,
        recordsInserted: teamHistoryRecords.length,
        environment
      })
    };
    
  } catch (error) {
    console.error('Error in MLB Player Team History upload:', error);
    
    // Send error notification
    await sendCronErrorNotification({
      jobName: 'upload-mlb-player-team-history',
      stage: process.env.STAGE || 'unknown',
      startTime: easternTimeString,
      environment,
      error: error instanceof Error ? error : new Error(String(error))
    });
    
    throw error;
  }
};

// Local development entry point
// This allows the handler to be run directly with Node.js for debugging
if (require.main === module) {
  console.log('🚀 Running uploadMLBPlayerTeamHistory handler locally...');
  
  // Create a mock event for local testing
  const mockEvent: MLBUploadEvent = {
    version: '0',
    id: 'local-test-event',
    'detail-type': 'Scheduled Event',
    source: 'aws.events',
    account: 'local',
    time: new Date().toISOString(),
    region: 'us-east-1',
    detail: {},
    resources: []
  };
  
  // Run the handler
  handler(mockEvent)
    .then((result) => {
      console.log('✅ Handler completed successfully:', result);
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Handler failed:', error);
      process.exit(1);
    });
} 