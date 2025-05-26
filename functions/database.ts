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
    // Create connection pool
    pool = await sql.connect(Resource.DATABASE_CONNECTION_STRING.value);
    
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
    
    // Extract the specific error message after ": " if it exists
    const colonIndex = errorMessage.indexOf(': ');
    let userMessage = "Registration failed, error unknown.";
    
    if (colonIndex !== -1 && colonIndex < errorMessage.length - 2) {
      // Extract everything after ": "
      const specificError = errorMessage.substring(colonIndex + 2).trim();
      if (specificError) {
        userMessage = specificError;
      }
    }
    
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