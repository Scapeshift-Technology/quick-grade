import * as sql from 'mssql';
import { Resource } from 'sst';

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

export type DatabaseService = 'telegram-bot' | 'espn-scraper' | 'steamer-upload';

// Get database connection string for different services
export function getDatabaseConfig(service: DatabaseService): DatabaseConfig {
  let connectionString: string;
  
  switch (service) {
    case 'telegram-bot':
      connectionString = Resource.DATABASE_CONNECTION_STRING_TELEGRAM_BOT.value;
      break;
    case 'espn-scraper':
      connectionString = Resource.DATABASE_CONNECTION_STRING_ESPN_SCRAPER.value;
      break;
    case 'steamer-upload':
      connectionString = Resource.DATABASE_CONNECTION_STRING_STEAMER_UPLOAD.value;
      break;
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