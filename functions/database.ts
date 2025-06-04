import * as sql from 'mssql';
import { Resource } from 'sst';
import { TeamHistoryRecord } from './types';

export interface RegistrationResult {
  success: boolean;
  message: string;
}

export interface ValidationError {
  isValid: false;
  message: string;
}

export interface ValidationSuccess {
  isValid: true;
}

export type ValidationResult = ValidationError | ValidationSuccess;

export interface DatabaseConfig {
  connectionString: string;
}

export type DatabaseService = 'telegram-bot' | 'espn-scraper' | 'steamer-upload' | 'persister';

// Get database connection string for different services
export function getDatabaseConfig(service: DatabaseService): DatabaseConfig {
  let connectionString: string;
  
  switch (service) {
    case 'telegram-bot':
      connectionString = Resource.DATABASE_CONNECTION_STRING_TELEGRAM_BOT.value;
      break;
    case 'persister':
      connectionString = Resource.DATABASE_CONNECTION_STRING_PERSISTER.value;
      break;
    case 'espn-scraper':
      // Resource not yet configured in SST - will be added as DATABASE_CONNECTION_STRING_ESPN_SCRAPER.value when ESPN scraper is implemented
      throw new Error(`ESPN scraper database connection not configured yet`);
    case 'steamer-upload':
      // Resource not yet configured in SST - will be added as DATABASE_CONNECTION_STRING_STEAMER_UPLOAD.value when Steamer upload is implemented
      throw new Error(`Steamer upload database connection not configured yet`);
    default:
      throw new Error(`Unknown database service: ${service}`);
  }

  return { connectionString };
}

// Create a database connection pool for a specific service
export async function createDatabaseConnection(service: DatabaseService): Promise<sql.ConnectionPool> {
  const config = getDatabaseConfig(service);
  return await sql.connect(config.connectionString);
}

// Validate input parameters according to database constraints
export function validateRegistrationInput(username: string, token: string): ValidationResult {
  // Check username length (CHAR(32) constraint)
  if (username.length > 16) {
    return {
      isValid: false,
      message: "username is too long (max 16 chars)"
    };
  }
  
  // Check token length (CHAR(32) constraint)
  if (token.length !== 32) {
    return {
      isValid: false,
      message: "token is not the expected length (32 chars)"
    };
  }
  
  return { isValid: true };
}

// Call the database stored procedure for user registration
export async function registerUser(
  username: string, 
  token: string, 
  telegramUserId: number,
  isBot: boolean,
  firstName: string,
  lastName?: string,
  telegramUsername?: string
): Promise<RegistrationResult> {
  let pool: sql.ConnectionPool | undefined;
  
  try {
    // Create connection pool using telegram-bot service
    pool = await createDatabaseConnection('telegram-bot');
    
    // Create request with parameters
    const request = pool.request()
      .input('Party', sql.Char(32), username)
      .input('Token', sql.Char(32), token)
      .input('TelegramUser', sql.BigInt, telegramUserId)
      .input('IsBot', sql.Bit, isBot)
      .input('FirstName', sql.Char(64), firstName)
      .input('LastName', sql.Char(64), lastName || null)
      .input('UserName', sql.Char(32), telegramUsername || null);
    
    // Execute stored procedure
    const result = await request.execute('dbo.PartyTelegramUser_REGISTER_tr');
    
    // Check if the procedure executed successfully
    // Note: The exact return structure depends on how the stored procedure is implemented
    // For now, we'll assume success if no error is thrown
    return {
      success: true,
      message: `Registration successful! Welcome ${username}`
    };
    
  } catch (error) {
    console.error('Database registration error:', error);
    
    // Handle specific database errors if needed
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('errorMessage=', errorMessage);
    
    const userMessage = `Registration failed, error: ${errorMessage}`;
    
    return {
      success: false,
      message: userMessage
    };
    
  } finally {
    // Clean up connection
    if (pool && pool.connected) {
      try {
        await pool.close();
      } catch (closeError) {
        console.error('Error closing database connection:', closeError);
      }
    }
  }
}

// MLB-specific database functions

/**
 * Fetch all valid MLBTeam IDs from the database and return as CSV string for API calls
 */
export async function fetchValidMLBTeamsCSV(): Promise<string> {
  let pool: sql.ConnectionPool | undefined;
  
  try {
    pool = await createDatabaseConnection('persister');
    
    const result = await pool.request().query('SELECT MLBTeam FROM MLBTeam ORDER BY MLBTeam');
    const teamIds = result.recordset.map(row => row.MLBTeam);
    
    console.log(`Found ${teamIds.length} valid MLBTeam IDs`);
    return teamIds.join(',');
    
  } catch (error) {
    console.error('Failed to fetch valid MLBTeam IDs:', error);
    throw error;
  } finally {
    if (pool && pool.connected) {
      try {
        await pool.close();
      } catch (closeError) {
        console.error('Error closing database connection:', closeError);
      }
    }
  }
}

/**
 * Fetch all valid MLBPlayer IDs from the database
 */
export async function fetchValidMLBPlayers(): Promise<Set<number>> {
  let pool: sql.ConnectionPool | undefined;
  
  try {
    pool = await createDatabaseConnection('persister');
    
    const result = await pool.request().query('SELECT Player FROM MLBPlayer');
    const playerIds = new Set(result.recordset.map(row => row.Player));
    
    console.log(`Found ${playerIds.size} valid MLBPlayer IDs`);
    return playerIds;
    
  } catch (error) {
    console.error('Failed to fetch valid MLBPlayer IDs:', error);
    throw error;
  } finally {
    if (pool && pool.connected) {
      try {
        await pool.close();
      } catch (closeError) {
        console.error('Error closing database connection:', closeError);
      }
    }
  }
}

/**
 * Bulk insert team history records into the database using MERGE for upsert behavior
 */
export async function bulkInsertTeamHistory(records: TeamHistoryRecord[]): Promise<{ inserted: number; updated: number; total: number }> {
  if (!records.length) {
    console.log('No team history records to insert');
    return { inserted: 0, updated: 0, total: 0 };
  }

  let pool: sql.ConnectionPool | undefined;
  
  try {
    pool = await createDatabaseConnection('persister');
    
    console.log(`Inserting ${records.length} team history records using batch processing`);
    
    // Process records in chunks to avoid SQL Server parameter limits (2100 parameters max)
    // Each record has 4 parameters, so use chunks of 500 records (2000 parameters)
    const CHUNK_SIZE = 500;
    let totalInserted = 0;
    let totalUpdated = 0;
    
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    
    try {
      for (let i = 0; i < records.length; i += CHUNK_SIZE) {
        const chunk = records.slice(i, i + CHUNK_SIZE);
        
        // Build the VALUES clause for this chunk
        const valuesClause = chunk.map((_, index) => {
          return `(@MLBPlayer${index}, @Date${index}, @MLBTeam${index}, @Description${index})`;
        }).join(', ');
        
        const request = new sql.Request(transaction);
        
        // Add input parameters for this chunk
        chunk.forEach((record, index) => {
          request.input(`MLBPlayer${index}`, sql.Int, record.MLBPlayer);
          request.input(`Date${index}`, sql.Date, record.Date);
          request.input(`MLBTeam${index}`, sql.SmallInt, record.MLBTeam);
          request.input(`Description${index}`, sql.VarChar(255), record.Description);
        });
        
        // Use OUTPUT clause to capture insert/update statistics
        const mergeQuery = `
          MERGE MLBPlayer_TeamHistory AS target
          USING (VALUES ${valuesClause}) AS source (MLBPlayer, Date, MLBTeam, Description)
          ON target.MLBPlayer = source.MLBPlayer AND target.Date = source.Date
          WHEN MATCHED THEN
            UPDATE SET MLBTeam = source.MLBTeam, Description = source.Description
          WHEN NOT MATCHED THEN
            INSERT (MLBPlayer, Date, MLBTeam, Description)
            VALUES (source.MLBPlayer, source.Date, source.MLBTeam, source.Description)
          OUTPUT $action;
        `;
        
        const result = await request.query(mergeQuery);
        
        // Count the actions from the OUTPUT
        let chunkInserted = 0;
        let chunkUpdated = 0;
        
        result.recordset.forEach(row => {
          if (row.$action === 'INSERT') {  // The OUTPUT $action column name is empty string
            chunkInserted++;
          } else if (row.$action === 'UPDATE') {
            chunkUpdated++;
          }
        });
        
        totalInserted += chunkInserted;
        totalUpdated += chunkUpdated;
        
        console.log(`Processed chunk ${Math.floor(i / CHUNK_SIZE) + 1}: ${chunk.length} records (${chunkInserted} inserted, ${chunkUpdated} updated)`);
      }
      
      await transaction.commit();
      
      const totalProcessed = totalInserted + totalUpdated;
      console.log(`Successfully processed ${records.length} team history records: ${totalInserted} inserted, ${totalUpdated} updated (${totalProcessed} total database operations)`);
      
      return {
        inserted: totalInserted,
        updated: totalUpdated,
        total: totalProcessed
      };
      
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    
  } catch (error) {
    console.error('Failed to insert team history records:', error);
    throw error;
  } finally {
    if (pool && pool.connected) {
      try {
        await pool.close();
      } catch (closeError) {
        console.error('Error closing database connection:', closeError);
      }
    }
  }
}

/**
 * Logs the execution of a cron job into the _CronLogins table.
 * Actor is automatically determined from environment variables.
 * Description is constructed based on provided time and environment.
 */
export async function logCronExecution(easternTimeString: string, currentEnvironment: string): Promise<void> {
  let pool: sql.ConnectionPool | undefined;

  const actor = process.env.CRON_JOB_NAME || process.env.AWS_LAMBDA_FUNCTION_NAME || 'unknown-actor';
  
  const stage = process.env.STAGE || 'unknown';
  const environmentContext = currentEnvironment === 'local'
    ? 'local-dev'
    : `deployed-${stage}`;
  const description = `cron job started at ${easternTimeString} from ${environmentContext} environment`;

  try {
    // Use 'persister' service for cron job logging
    pool = await createDatabaseConnection('persister');

    const insertQuery = `
      INSERT INTO dbo._CronLogins (Dtm, Actor, Description)
      VALUES (GETUTCDATE(), @actor, @description)
    `;

    const request = pool.request();
    request.input('actor', sql.Char(100), actor);
    request.input('description', sql.Char(100), description);
    await request.query(insertQuery);

    console.log(`Successfully logged cron execution for actor: ${actor}`);

  } catch (error) {
    console.error(`Failed to log cron execution for actor ${actor}:`, error);
    // We might not want to throw an error here to prevent the main cron job from failing
    // if logging fails, but this can be decided based on requirements.
    // For now, let's re-throw to be aware of logging issues.
    throw error;
  } finally {
    if (pool && pool.connected) {
      try {
        await pool.close();
      } catch (closeError) {
        console.error('Error closing database connection after logging cron execution:', closeError);
      }
    }
  }
} 