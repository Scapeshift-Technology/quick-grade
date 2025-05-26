import { registerUser, validateRegistrationInput } from '../functions/database';

// Mock the mssql module
jest.mock('mssql', () => ({
  connect: jest.fn(),
  Char: (size: number) => ({ type: 'char', size }),
  BigInt: { type: 'bigint' },
  Bit: { type: 'bit' }
}));

// Mock the sst module
jest.mock('sst', () => ({
  Resource: {
    TELEGRAM_BOT_TOKEN: { value: 'test-bot-token' },
    DATABASE_CONNECTION_STRING: { value: 'Driver={ODBC Driver 18 for SQL Server};Server=tcp:test-server.database.windows.net,1433;Database=test-database;Uid=test-user;Pwd=test-password;Encrypt=yes;TrustServerCertificate=no;Connection Timeout=30;' }
  }
}));

// Import after mocking
import * as sql from 'mssql';
const mockConnect = sql.connect as jest.MockedFunction<any>;

describe('Registration Input Validation', () => {
  describe('validateRegistrationInput', () => {
    test('should pass validation for valid username and token', () => {
      const username = 'UsrUnder16ch';
      const token = 'TokenIsOkBecauseItsExactly32Char';   // 32 characters
      
      const result = validateRegistrationInput(username, token);
      
      expect(result.isValid).toBe(true);
    });

    test('should fail validation when username exceeds 32 characters', () => {
      const username = 'ThisUsernameTooLong';  // 19 characters
      const token = 'TokenIsOkBecauseItsExactly32Char';  // Valid token
      
      const result = validateRegistrationInput(username, token);
      
      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.message).toBe('username is too long (max 16 chars)');
      }
    });

    test('should fail validation when token exceeds 32 characters', () => {
      const username = 'UsernameOK';  // Valid username
      const token = 'TokenIsUnder32Chars';
      
      const result = validateRegistrationInput(username, token);
      
      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.message).toBe('token is not the expected length (32 chars)');
      }
    });

    test('should fail validation when both username and token exceed 32 characters', () => {
      const username = 'ThisUsernameIsTooLongExceeds32Chars';  // 35 characters
      const token = 'TokenIsNotExactly32CharsItsTooLong';  // 34 characters
      
      const result = validateRegistrationInput(username, token);
      
      expect(result.isValid).toBe(false);
      // Should fail on username first (order of validation)
      if (!result.isValid) {
        expect(result.message).toBe('username is too long (max 16 chars)');
      }
    });
  });
});

describe('Database Registration', () => {
  let mockPool: any;
  let mockRequest: any;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create mock objects
    mockRequest = {
      input: jest.fn().mockReturnThis(),
      execute: jest.fn()
    };
    
    mockPool = {
      request: jest.fn().mockReturnValue(mockRequest),
      connected: true,
      close: jest.fn()
    };
    
    // Mock sql.connect to return our mock pool
    (mockConnect as jest.MockedFunction<any>).mockResolvedValue(mockPool);
  });

  describe('registerUser', () => {
    test('should successfully register user with valid credentials', async () => {
      // Mock successful database execution
      mockRequest.execute.mockResolvedValue({ recordset: [] });
      
      const telegramUserId = 123456789;
      const isBot = false;
      const firstName = 'John';
      const lastName = 'Doe';
      const telegramUsername = 'johndoe';
      
      const result = await registerUser('testuser', 'testtoken', telegramUserId, isBot, firstName, lastName, telegramUsername);
      
      expect(result.success).toBe(true);
      expect(result.message).toBe('Registration successful! Welcome testuser');
      
      // Verify database calls
      expect(mockConnect).toHaveBeenCalledWith('Driver={ODBC Driver 18 for SQL Server};Server=tcp:test-server.database.windows.net,1433;Database=test-database;Uid=test-user;Pwd=test-password;Encrypt=yes;TrustServerCertificate=no;Connection Timeout=30;');
      expect(mockPool.request).toHaveBeenCalled();
      expect(mockRequest.input).toHaveBeenCalledWith('Party', { type: 'char', size: 32 }, 'testuser');
      expect(mockRequest.input).toHaveBeenCalledWith('Token', { type: 'char', size: 32 }, 'testtoken');
      expect(mockRequest.input).toHaveBeenCalledWith('TelegramUser', { type: 'bigint' }, telegramUserId);
      expect(mockRequest.input).toHaveBeenCalledWith('IsBot', { type: 'bit' }, isBot);
      expect(mockRequest.input).toHaveBeenCalledWith('FirstName', { type: 'char', size: 64 }, firstName);
      expect(mockRequest.input).toHaveBeenCalledWith('LastName', { type: 'char', size: 64 }, lastName);
      expect(mockRequest.input).toHaveBeenCalledWith('UserName', { type: 'char', size: 32 }, telegramUsername);
      expect(mockRequest.execute).toHaveBeenCalledWith('dbo.PartyTelegramUser_REGISTER_tr');
      expect(mockPool.close).toHaveBeenCalled();
    });

    test('should handle database connection failure', async () => {
      // Mock connection failure
      (mockConnect as jest.MockedFunction<any>).mockRejectedValue(new Error('Connection failed'));
      
      const telegramUserId = 123456789;
      const isBot = false;
      const firstName = 'John';
      
      const result = await registerUser('testuser', 'testtoken', telegramUserId, isBot, firstName);
      
      expect(result.success).toBe(false);
      expect(result.message).toBe('Registration failed, error unknown.');
    });

    test('should handle stored procedure execution failure', async () => {
      // Mock successful connection but failed execution
      mockRequest.execute.mockRejectedValue(new Error('Stored procedure failed'));
      
      const telegramUserId = 123456789;
      const isBot = false;
      const firstName = 'John';
      
      const result = await registerUser('testuser', 'testtoken', telegramUserId, isBot, firstName);
      
      expect(result.success).toBe(false);
      expect(result.message).toBe('Registration failed, error unknown.');
      expect(mockPool.close).toHaveBeenCalled();
    });

    test('should successfully register user with minimal required parameters', async () => {
      // Mock successful database execution
      mockRequest.execute.mockResolvedValue({ recordset: [] });
      
      const telegramUserId = 123456789;
      const isBot = false;
      const firstName = 'Jane';
      
      const result = await registerUser('testuser2', 'testtoken2', telegramUserId, isBot, firstName);
      
      expect(result.success).toBe(true);
      expect(result.message).toBe('Registration successful! Welcome testuser2');
      
      // Verify database calls with null values for optional parameters
      expect(mockRequest.input).toHaveBeenCalledWith('Party', { type: 'char', size: 32 }, 'testuser2');
      expect(mockRequest.input).toHaveBeenCalledWith('Token', { type: 'char', size: 32 }, 'testtoken2');
      expect(mockRequest.input).toHaveBeenCalledWith('TelegramUser', { type: 'bigint' }, telegramUserId);
      expect(mockRequest.input).toHaveBeenCalledWith('IsBot', { type: 'bit' }, isBot);
      expect(mockRequest.input).toHaveBeenCalledWith('FirstName', { type: 'char', size: 64 }, firstName);
      expect(mockRequest.input).toHaveBeenCalledWith('LastName', { type: 'char', size: 64 }, null);
      expect(mockRequest.input).toHaveBeenCalledWith('UserName', { type: 'char', size: 32 }, null);
      expect(mockRequest.execute).toHaveBeenCalledWith('dbo.PartyTelegramUser_REGISTER_tr');
      expect(mockPool.close).toHaveBeenCalled();
    });

    test('should extract and return specific error message after colon from database error', async () => {
      // Mock database error with specific format like the example
      const databaseError = new Error("[S0008][50000] Line 139: Token for 'devtestparty' expired, try generating a new token using dbo. PartyTelegramRegistrationToken_CREATE_tr");
      mockRequest.execute.mockRejectedValue(databaseError);
      
      const telegramUserId = 123456789;
      const isBot = false;
      const firstName = 'John';
      
      const result = await registerUser('testuser', 'testtoken', telegramUserId, isBot, firstName);
      
      expect(result.success).toBe(false);
      expect(result.message).toBe("Token for 'devtestparty' expired, try generating a new token using dbo. PartyTelegramRegistrationToken_CREATE_tr");
      expect(mockPool.close).toHaveBeenCalled();
    });

    test('should extract error message after first colon when multiple colons exist', async () => {
      // Mock database error with multiple colons
      const databaseError = new Error("Error code: Database error: Invalid token: Token has expired");
      mockRequest.execute.mockRejectedValue(databaseError);
      
      const telegramUserId = 123456789;
      const isBot = false;
      const firstName = 'John';
      
      const result = await registerUser('testuser', 'testtoken', telegramUserId, isBot, firstName);
      
      expect(result.success).toBe(false);
      expect(result.message).toBe("Database error: Invalid token: Token has expired");
      expect(mockPool.close).toHaveBeenCalled();
    });

    test('should return default error message when no colon exists in error', async () => {
      // Mock database error without colon
      const databaseError = new Error("Database connection failed");
      mockRequest.execute.mockRejectedValue(databaseError);
      
      const telegramUserId = 123456789;
      const isBot = false;
      const firstName = 'John';
      
      const result = await registerUser('testuser', 'testtoken', telegramUserId, isBot, firstName);
      
      expect(result.success).toBe(false);
      expect(result.message).toBe("Registration failed, error unknown.");
      expect(mockPool.close).toHaveBeenCalled();
    });

    test('should return default error message when colon is at the end', async () => {
      // Mock database error with colon at the end
      const databaseError = new Error("Database error:");
      mockRequest.execute.mockRejectedValue(databaseError);
      
      const telegramUserId = 123456789;
      const isBot = false;
      const firstName = 'John';
      
      const result = await registerUser('testuser', 'testtoken', telegramUserId, isBot, firstName);
      
      expect(result.success).toBe(false);
      expect(result.message).toBe("Registration failed, error unknown.");
      expect(mockPool.close).toHaveBeenCalled();
    });

    test('should return default error message when text after colon is only whitespace', async () => {
      // Mock database error with only whitespace after colon
      const databaseError = new Error("Database error:   ");
      mockRequest.execute.mockRejectedValue(databaseError);
      
      const telegramUserId = 123456789;
      const isBot = false;
      const firstName = 'John';
      
      const result = await registerUser('testuser', 'testtoken', telegramUserId, isBot, firstName);
      
      expect(result.success).toBe(false);
      expect(result.message).toBe("Registration failed, error unknown.");
      expect(mockPool.close).toHaveBeenCalled();
    });
  });
});