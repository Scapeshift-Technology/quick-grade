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

  // First pass: collect all valid transactions
  const candidateRecords: Array<TeamHistoryRecord & { transactionId: number }> = [];

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
    
    // Skip transactions without an ID (needed for deduplication)
    if (!transaction.id) {
      console.warn(`Transaction missing ID for player ${transaction.person.id}`);
      continue;
    }
    
    // Truncate description if too long
    let description = transaction.description || '';
    if (description.length > 255) {
      description = description.substring(0, 255);
    }
    
    candidateRecords.push({
      MLBPlayer: transaction.person.id,
      Date: transactionDate,
      MLBTeam: transaction.toTeam.id,
      Description: description,
      transactionId: transaction.id
    });
  }

  // Second pass: deduplicate by (MLBPlayer, Date, MLBTeam) keeping the transaction with highest ID
  const deduplicationMap = new Map<string, typeof candidateRecords[0]>();
  
  for (const record of candidateRecords) {
    const key = `${record.MLBPlayer}-${record.Date.toISOString().split('T')[0]}-${record.MLBTeam}`;
    const existing = deduplicationMap.get(key);
    
    if (!existing || record.transactionId > existing.transactionId) {
      // Keep this record (either first occurrence or has higher transaction ID)
      deduplicationMap.set(key, record);
    }
    // Otherwise discard this record (has lower transaction ID)
  }
  
  // Convert back to TeamHistoryRecord[] (removing transactionId)
  const finalRecords = Array.from(deduplicationMap.values()).map(record => ({
    MLBPlayer: record.MLBPlayer,
    Date: record.Date,
    MLBTeam: record.MLBTeam,
    Description: record.Description
  }));
  
  const duplicatesRemoved = candidateRecords.length - finalRecords.length;
  if (duplicatesRemoved > 0) {
    console.log(`Deduplication: ${candidateRecords.length} -> ${finalRecords.length} records (removed ${duplicatesRemoved} duplicates based on highest transaction ID)`);
  }
  
  console.log(`Processed ${finalRecords.length} valid team history records from ${transactions.length} transactions`);
  return finalRecords;
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
          'Records inserted': 0,
          'Records updated': 0,
          'Total DB operations': 0
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
          recordsUpdated: 0,
          totalDbOperations: 0,
          environment
        })
      };
    }
    
    // Step 4: Process and filter transactions
    console.log('Processing and filtering transactions...');
    const teamHistoryRecords = processTransactions(apiResponse.transactions, validPlayers, validTeamsCsv);
    
    // Step 5: Insert records into database
    let insertStats = { inserted: 0, updated: 0, total: 0 };
    if (teamHistoryRecords.length > 0) {
      console.log('Inserting team history records into database...');
      insertStats = await bulkInsertTeamHistory(teamHistoryRecords);
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
        'Records inserted': insertStats.inserted,
        'Records updated': insertStats.updated,
        'Total DB operations': insertStats.total,
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
        recordsInserted: insertStats.inserted,
        recordsUpdated: insertStats.updated,
        totalDbOperations: insertStats.total,
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
  console.log('=' .repeat(60));
  
  // Read custom dates from environment variables if provided
  const startDate = process.env.START_DATE;
  const endDate = process.env.END_DATE;
  
  console.log('🔧 Debug Configuration:');
  console.log(`   NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);
  console.log(`   START_DATE: ${startDate || 'not set (will use yesterday)'}`);
  console.log(`   END_DATE: ${endDate || 'not set (will use tomorrow)'}`);
  console.log(`   STAGE: ${process.env.STAGE || 'not set'}`);
  console.log('');
  
  // Create a mock event for local testing
  const mockEvent: MLBUploadEvent = {
    version: '0',
    id: `local-debug-${Date.now()}`,
    'detail-type': 'Scheduled Event',
    source: 'local.debug',
    account: 'local',
    time: new Date().toISOString(),
    region: 'us-east-1',
    detail: {},
    resources: [],
    // Include custom dates in the event if provided
    ...(startDate && { startDate }),
    ...(endDate && { endDate })
  };
  
  console.log('📅 Mock Event:');
  console.log(JSON.stringify(mockEvent, null, 2));
  console.log('');
  console.log('🎯 Starting handler execution...');
  console.log('');
  
  // Run the handler
  handler(mockEvent)
    .then((result) => {
      console.log('');
      console.log('=' .repeat(60));
      console.log('✅ Handler completed successfully!');
      console.log('📊 Result:');
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch((error) => {
      console.log('');
      console.log('=' .repeat(60));
      console.error('❌ Handler failed with error:');
      console.error(error);
      if (error instanceof Error) {
        console.error('Error stack:', error.stack);
      }
      process.exit(1);
    });
} 