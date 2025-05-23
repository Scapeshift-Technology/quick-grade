#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const sql = require('mssql'); // SQL Server driver
// Type Definitions

export interface Match {
    Date: Date;
    Team1: string;
    Team2?: string;
    DaySequence?: number; // DaySequence is optional
}

export interface Period {
    PeriodTypeCode: string; // CHAR(2)
    PeriodNumber: number;
}

export interface Contract_Match_Base {
    Period: Period;
    Match: Match;
}

export interface Contract_Match_Total extends Contract_Match_Base {
    Line: number; // Must be divisible by 0.5 (runtime validation)
    IsOver: boolean;
}

export interface Contract_Match_TeamTotal extends Contract_Match_Total {
    Team: string;
}

export type Contract_Match = Contract_Match_Total | Contract_Match_TeamTotal;

export interface Bet {
    ExecutionDtm: Date;
    Price: number; // Assuming money is represented as a number
    Size: number; // Assuming money is represented as a number
    ContractMatch: Contract_Match;
}

// Default value for DaySequence can be handled in functions creating Match objects
// const defaultMatch: Match = { Date: new Date(), Team1: "Team A", DaySequence: 1 };

// --- BEGIN toString UTILITY FUNCTIONS ---

export function periodToString(period: Period): string {
    return `${period.PeriodTypeCode}${period.PeriodNumber}`;
}

export function matchToString(match: Match): string {
    const dateStr = `${match.Date.getMonth() + 1}/${match.Date.getDate()}/${match.Date.getFullYear()}`;
    let str = `${dateStr} ${match.Team1}`;
    if (match.Team2) {
        str += `/${match.Team2}`;
    }
    if (match.DaySequence && match.DaySequence > 1) {
        str += ` #${match.DaySequence}`;
    }
    return str;
}

export function contractMatchToString(contract: Contract_Match): string {
    const matchStr = matchToString(contract.Match);
    const overUnder = contract.IsOver ? 'o' : 'u';

    if ('Team' in contract) { // Contract_Match_TeamTotal
        // Example: "5/12/2025 MIL #2: MIL u4.5"
        // Period is not shown for TeamTotal in this format based on user example.
        return `${matchStr}: ${contract.Team} ${overUnder}${contract.Line}`;
    } else { // Contract_Match_Total
        // Example: "5/12/2025 MIL/CLE: H1 o5"
        const periodStr = periodToString(contract.Period);
        return `${matchStr}: ${periodStr} ${overUnder}${contract.Line}`;
    }
}

// --- END toString UTILITY FUNCTIONS ---

// --- BEGIN NEW HELPER FUNCTION for Risk/ToWin ---

export function calculateRiskAndToWin(price: number, betSize: number): { risk: number; toWin: number } | null {
    let risk: number;
    let toWin: number;

    if (price >= 100) {
        risk = betSize;
        toWin = betSize * (price / 100);
    } else if (price <= -100) {
        // For negative odds, 'betSize' is the 'toWin' amount.
        // Risk = ToWin / (100 / abs(Price)) = ToWin * (abs(Price) / 100)
        toWin = betSize;
        risk = betSize * (Math.abs(price) / 100);
    } else {
        // Price is not in the specified ranges (e.g. -99 to 99, excluding 0, or 0 itself).
        // The user's definition of 'betSize' interpretation doesn't apply.
        console.warn(`[calculateRiskAndToWin WARN] Price ${price} is not >= 100 or <= -100. Cannot determine Risk/ToWin based on standard American odds interpretation of Size.`);
        return null;
    }
    // Round to 4 decimal places to avoid floating point inaccuracies
    risk = parseFloat(risk.toFixed(4));
    toWin = parseFloat(toWin.toFixed(4));

    return { risk, toWin };
}

// --- END NEW HELPER FUNCTION for Risk/ToWin ---

// --- BEGIN SUMMARY HELPER FUNCTIONS ---

function formatDateForSummary(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = date.getFullYear();
    return `${month}/${day}/${year}`;
}

function formatPnlForSummary(pnl: number): string {
    // Format to 2 decimal places first
    const pnlWithPennies = parseFloat(pnl.toFixed(2)); // Ensures we're working with a number rounded to 2 decimal places

    const sign = pnlWithPennies >= 0 ? '+' : '-';
    
    // Get the absolute value, format with commas and 2 decimal places for consistency
    const absPnlStr = Math.abs(pnlWithPennies).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }); // e.g., "5,230.75", "300.10", "0.00"

    const parts = absPnlStr.split('.');
    const integerPart = parts[0]; // e.g., "5,230", "300", "0"
    const decimalPart = parts[1]; // e.g., "75", "10", "00"

    // Pad the integer part to maintain alignment similar to the original examples
    const paddedIntegerPart = integerPart.padStart(5, ' '); 
    
    return `${sign}$${paddedIntegerPart}.${decimalPart}`;
}

function getMonday(d: Date): Date {
    const date = new Date(d.valueOf()); // Clone date
    const dayOfWeek = date.getDay(); // Sunday = 0, Monday = 1, ..., Saturday = 6
    const diff = date.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // Adjust for Sunday
    return new Date(date.setDate(diff));
}

function printDailySummary(pnlSummariesData: { date: Date, pnl: number }[]) {
    if (pnlSummariesData.length === 0) return;

    console.log("\n--- DAILIES ---");
    const dailyTotals: Map<string, number> = new Map();

    for (const item of pnlSummariesData) {
        const dateKey = item.date.toISOString().split('T')[0]; // YYYY-MM-DD for sorting and grouping
        dailyTotals.set(dateKey, (dailyTotals.get(dateKey) || 0) + item.pnl);
    }

    const sortedDays = Array.from(dailyTotals.keys()).sort();

    for (const dateKey of sortedDays) {
        const pnl = dailyTotals.get(dateKey)!;
        // Create a new Date object from YYYY-MM-DD to ensure correct local date formatting
        const parts = dateKey.split('-').map(Number);
        const displayDateObj = new Date(parts[0], parts[1] - 1, parts[2]);
        console.log(`${formatDateForSummary(displayDateObj)}, ${formatPnlForSummary(pnl)}`);
    }
}

function printWeeklySummary(pnlSummariesData: { date: Date, pnl: number }[]) {
    if (pnlSummariesData.length === 0) return;

    console.log("\n--- WEEKLIES (Monday thru Sunday) ---");
    const weeklyTotals: Map<string, number> = new Map(); // Key is Monday's YYYY-MM-DD

    for (const item of pnlSummariesData) {
        const monday = getMonday(item.date);
        const mondayKey = monday.toISOString().split('T')[0];
        weeklyTotals.set(mondayKey, (weeklyTotals.get(mondayKey) || 0) + item.pnl);
    }

    const sortedMondays = Array.from(weeklyTotals.keys()).sort();

    for (const mondayKey of sortedMondays) {
        const pnl = weeklyTotals.get(mondayKey)!;
        const parts = mondayKey.split('-').map(Number);
        const mondayDate = new Date(parts[0], parts[1] - 1, parts[2]);
        
        const sundayDate = new Date(mondayDate);
        sundayDate.setDate(mondayDate.getDate() + 6);

        const dateRangeStr = `${formatDateForSummary(mondayDate)} - ${formatDateForSummary(sundayDate)}`;
        console.log(`${dateRangeStr}, ${formatPnlForSummary(pnl)}`);
    }
}

function printTotalSummary(pnlSummariesData: { date: Date, pnl: number }[]) {
    if (pnlSummariesData.length === 0) {
      // Print total as $0 if no PNL data, to match example structure if sections are always shown
      console.log("\n--- TOTAL: +$    0 ---");
      return;
    }
    const totalPnl = pnlSummariesData.reduce((sum, item) => sum + item.pnl, 0);
    console.log(`\n--- TOTAL: ${formatPnlForSummary(totalPnl)} ---`);
}

// --- END SUMMARY HELPER FUNCTIONS ---

// --- BEGIN NEW PARSING LOGIC ---

// Function to parse USA style odds
// Based on user's Python snippet and examples, handles "ev", "even" and numeric odds (including decimals).
export function parse_usa_price(rawPriceStr: string): number {
    const cleanedPriceStr = rawPriceStr.trim().toLowerCase();

    if (cleanedPriceStr === 'ev' || cleanedPriceStr === 'even') {
        return 100;
    }

    // Matches standard odds like +150, -200, or decimal odds like -115.5
    // User regex was: /(?P<usa_price>[+-]?\\d{3,}|ev(?:en)?(?: |$))/
    // This version is more aligned with the example Price: -115.5
    const pricePattern = /^[+-]?\d+(\.\d+)?$/;
    if (pricePattern.test(cleanedPriceStr)) {
        const price = parseFloat(cleanedPriceStr);
        if (isNaN(price)) {
            throw new Error(`Price string "${rawPriceStr}" resulted in NaN after parseFloat.`);
        }
        return price;
    }
    throw new Error(`Invalid USA price format: "${rawPriceStr}"`);
}

const periodStringMap: { [key: string]: Period } = {
    "1st inning": { PeriodTypeCode: 'I', PeriodNumber: 1 },
    "f5": { PeriodTypeCode: 'H', PeriodNumber: 1 },
    "fg": { PeriodTypeCode: 'M', PeriodNumber: 0 }
};
const defaultPeriodDetails: Period = { PeriodTypeCode: 'M', PeriodNumber: 0 };

// Regex for OU_PATT based on user: /(?P<over_or_under>[ou])(?P<line>\d+(?:[.]5)?)( *runs)?/
// JS version, matching at the end of the relevant string segment.
// Assumes 'o' or 'u' must be lowercase as per examples.
const ouPatternRegex = /(?<over_or_under>[ou])(?<line>\d+(?:\.5)?)(?: *runs)?$/;

export function parseBetDetails(dateOnlyStr: string, timeOnlyStr: string, rawDetailsYg: string): Bet | null {
    try {
        // Create date in local timezone then adjust to UTC
        const localDate = new Date(`${dateOnlyStr} ${timeOnlyStr}`);
        if (isNaN(localDate.getTime())) {
            console.warn(`[DetailParse WARN] Invalid date/time for ExecutionDtm: ${dateOnlyStr} ${timeOnlyStr} from line part: ${rawDetailsYg}`);
            return null;
        }
        // Keep ExecutionDtm as is (local timezone interpretation)
        const executionDtm = localDate;

        // For Match.Date, we only care about the date portion, not the time
        const matchDate = new Date(dateOnlyStr);
        if (isNaN(matchDate.getTime())) {
            console.warn(`[DetailParse WARN] Invalid date for Match.Date: ${dateOnlyStr} from line part: ${rawDetailsYg}`);
            return null;
        }

        if (!rawDetailsYg.toUpperCase().startsWith("YG")) {
            // This should be caught by validateLine logic, but as a safeguard.
            console.warn(`[DetailParse WARN] Details string does not start with YG (should be pre-validated): ${rawDetailsYg}`);
            return null;
        }
        let details = rawDetailsYg.substring(2).trimStart(); // Remove "YG" and leading spaces

        const atSplit = details.split(/ @ /);
        if (atSplit.length !== 2) {
            console.warn(`[DetailParse WARN] Details string missing ' @ ' separator or has too many: "${details}"`);
            return null;
        }
        let teamPeriodLineInfo = atSplit[0].trim();
        const priceAndSizeInfo = atSplit[1].trim();

        const eqSplit = priceAndSizeInfo.split(/ = /);
        if (eqSplit.length !== 2) {
            console.warn(`[DetailParse WARN] Price/Size string missing ' = ' separator or has too many: "${priceAndSizeInfo}"`);
            return null;
        }
        const priceStr = eqSplit[0].trim();
        const sizeStr = eqSplit[1].trim();

        const betPrice = parse_usa_price(priceStr); // Can throw error

        const rawSize = parseFloat(sizeStr);
        if (isNaN(rawSize)) {
            console.warn(`[DetailParse WARN] Invalid size (not a number): ${sizeStr}`);
            return null;
        }
        const betSize = rawSize * 1000;


        const ouMatch = teamPeriodLineInfo.match(ouPatternRegex);
        if (!ouMatch || !ouMatch.groups) {
            console.warn(`[DetailParse WARN] Details string does not match Over/Under pattern: "${teamPeriodLineInfo}"`);
            return null;
        }
        const { over_or_under, line: lineStr } = ouMatch.groups;
        const isOver = over_or_under === 'o'; // Assumes 'o' or 'u' (lowercase)
        const parsedLineVal = parseFloat(lineStr);

        if (isNaN(parsedLineVal) || parsedLineVal < 0 || parsedLineVal * 10 % 5 !== 0) { // check for divisibility by 0.5
            console.warn(`[DetailParse WARN] Invalid line value "${lineStr}" (not a non-negative number divisible by 0.5). Input: ${rawDetailsYg}`);
            return null;
        }

        // ---- Start of refactored section for team, period, TT, game number ----
        let baseTeamPeriodString = teamPeriodLineInfo.substring(0, ouMatch.index).trim();

        let currentPeriod: Period = defaultPeriodDetails;
        let daySequence: number | undefined = undefined;
        let team1: string;
        let team2: string | undefined;
        let isTeamTotal = false;

        const gameNumberPattern = /(?:\s+(?:GM?|#)([12]))$/i; // Matches " G1", " GM2", " #1" at the end of a segment

        const ttIndex = baseTeamPeriodString.toUpperCase().indexOf(" TT");
        
        // Check if " TT" is found and is a standalone marker (followed by space or end of string)
        if (ttIndex !== -1 && (baseTeamPeriodString.length === ttIndex + 3 || baseTeamPeriodString.charAt(ttIndex + 3) === ' ')) {
            isTeamTotal = true;
            let prefixBeforeTT = baseTeamPeriodString.substring(0, ttIndex).trim(); // e.g., "MIA F5", "SEA G2"
            let teamProcessingString = prefixBeforeTT;

            // 1. Extract Period from the string before TT
            for (const key in periodStringMap) {
                if (teamProcessingString.toLowerCase().endsWith(key)) {
                    currentPeriod = periodStringMap[key];
                    teamProcessingString = teamProcessingString.substring(0, teamProcessingString.toLowerCase().lastIndexOf(key)).trim();
                    break;
                }
            }

            // 2. Extract Game Number from the remaining string
            const gameMatch = teamProcessingString.match(gameNumberPattern);
            if (gameMatch && gameMatch[1]) {
                daySequence = parseInt(gameMatch[1], 10);
                teamProcessingString = teamProcessingString.substring(0, gameMatch.index).trim();
            }
            
            // 3. The rest is the team for TT
            const ttTeams = teamProcessingString.split("/").map(t => t.trim()).filter(t => t.length > 0);
            if (ttTeams.length === 1) {
                team1 = ttTeams[0];
                // team2 remains undefined for TT
            } else {
                console.warn(`[DetailParse WARN] Invalid team specification for TT: "${teamProcessingString}" (expected one team). Original: "${baseTeamPeriodString}". Input: ${rawDetailsYg}`);
                return null;
            }
        } else { // Not a Team Total
            isTeamTotal = false; // Explicitly set
            let nonTTProcessingStr = baseTeamPeriodString; // e.g., "Padres/Pirates 1st inning", "COL gm2 F5"

            // 1. Extract Period
            for (const key in periodStringMap) {
                if (nonTTProcessingStr.toLowerCase().endsWith(key)) {
                    currentPeriod = periodStringMap[key];
                    nonTTProcessingStr = nonTTProcessingStr.substring(0, nonTTProcessingStr.toLowerCase().lastIndexOf(key)).trim();
                    break;
                }
            }

            // 2. Extract Game Number
            const gameMatch = nonTTProcessingStr.match(gameNumberPattern);
            if (gameMatch && gameMatch[1]) {
                daySequence = parseInt(gameMatch[1], 10);
                nonTTProcessingStr = nonTTProcessingStr.substring(0, gameMatch.index).trim();
            }

            // 3. The rest is team(s)
            const gameTeams = nonTTProcessingStr.split("/").map(t => t.trim()).filter(t => t.length > 0);
            if (gameTeams.length === 0) {
                console.warn(`[DetailParse WARN] No teams found in: "${nonTTProcessingStr}". Original: "${baseTeamPeriodString}". Input: ${rawDetailsYg}`);
                return null;
            }
            team1 = gameTeams[0];
            team2 = gameTeams.length > 1 ? gameTeams[1] : undefined;
        }
        // ---- End of refactored section ----
        
        const matchInfo: Match = {
            Date: matchDate,
            Team1: team1,
            Team2: team2,
            DaySequence: daySequence // Use extracted or undefined DaySequence
        };

        let contractMatch: Contract_Match;
        if (isTeamTotal) {
            contractMatch = {
                Period: currentPeriod,
                Match: matchInfo,
                Line: parsedLineVal,
                IsOver: isOver,
                Team: team1
            } as Contract_Match_TeamTotal;
        } else {
            contractMatch = {
                Period: currentPeriod,
                Match: matchInfo,
                Line: parsedLineVal,
                IsOver: isOver
            } as Contract_Match_Total;
        }

        const bet: Bet = {
            ExecutionDtm: executionDtm,
            Price: betPrice,
            Size: betSize,
            ContractMatch: contractMatch
        };
        return bet;

    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[DetailParse ERROR] Failed parsing details for "${rawDetailsYg}": ${message}`);
        return null;
    }
}

// --- END NEW PARSING LOGIC ---

function printTable(headers: string[], rows: (string | number | Date | undefined)[][]) {
    if (rows.length === 0) {
        console.log("No valid lines to display.");
        return;
    }

    const columnWidths = headers.map((header, index) => {
        const maxLength = Math.max(
            header.length,
            ...rows.map(row => String(row[index] !== undefined ? row[index] : '').length)
        );
        return maxLength;
    });

    const headerLine = headers.map((header, index) => header.padEnd(columnWidths[index])).join(' | ');
    const separatorLine = columnWidths.map(width => '-'.repeat(width)).join('-|-');

    console.log(headerLine);
    console.log(separatorLine);

    rows.forEach(row => {
        const rowLine = row.map((cell, index) => String(cell !== undefined ? cell : '').padEnd(columnWidths[index])).join(' | ');
        console.log(rowLine);
    });
}

export function validateLine(line: string): { date: string; time: string; details: string } | null {
    const parts = line.split(',').map(part => part.trim());
    if (parts.length !== 3) {
        return null;
    }

    const [dateStr, timeStr, detailsStr] = parts;

    const dateRegex = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
    const timeRegex = /^\d{1,2}:\d{2} [AP]M$/;
    const detailsRegex = /^YG/;

    if (dateRegex.test(dateStr) && timeRegex.test(timeStr) && detailsRegex.test(detailsStr)) {
        return { date: dateStr, time: timeStr, details: detailsStr };
    }
    return null;
}

// Modified to be async and accept sql.ConnectionPool
export async function processFile(filePath: string, pool: import('mssql').ConnectionPool) {
    if (!fs.existsSync(filePath)) {
        console.error(`Error: File not found at ${filePath}`);
        return;
    }

    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const lines = fileContent.split('\n');

    const parsedBets: Bet[] = []; // Store successfully parsed Bet objects
    const linesToWarnBasicFormat: string[] = []; // For lines failing basic CSV structure

    // Define regex patterns for conditions
    const nothingOnRegex = /^["']?(nothing (on|for)|had late)/i; // Case-insensitive, optional leading quote
    const hyphenLineRegex = /^[-]+$/; // Matches one or more hyphens
    const commentLineRegex = /^#/; // Matches lines starting with #

    lines.forEach((line: string) => {
        const trimmedLine = line.trim();
        if (trimmedLine === '') {
            // Skip empty lines silently
            return;
        }

        const validatedParts = validateLine(trimmedLine); // validateLine returns { date, time, details } | null
        
        if (validatedParts) {
            // Line has basic valid structure, now try to parse into Bet object
            const bet = parseBetDetails(validatedParts.date, validatedParts.time, validatedParts.details);
            if (bet) {
                parsedBets.push(bet);
            } else {
                // parseBetDetails already logged a warning with specifics via console.warn
                // Log the problematic line for context if detailed parsing fails
                console.log(`INFO: Line failed detailed parsing (see warnings above): '${trimmedLine}'`);
            }
        } else {
            // Line is invalid, determine if a warning should be logged
            let suppressWarning = false;

            if (hyphenLineRegex.test(trimmedLine)) {
                suppressWarning = true;
            }
            else if (nothingOnRegex.test(trimmedLine)) {
                suppressWarning = true;
            }
            else if (commentLineRegex.test(trimmedLine)) {
                suppressWarning = true;
            }
            else {
                const parts = trimmedLine.split(',').map((part: string) => part.trim());
                if (parts.length === 3 && nothingOnRegex.test(parts[2])) {
                    suppressWarning = true;
                }
            }

            if (!suppressWarning) {
                linesToWarnBasicFormat.push(trimmedLine);
            }
        }
    });

    // Print warnings for lines that failed basic format validation
    linesToWarnBasicFormat.forEach(line => {
        console.log(`WARNING: invalid line (basic format): '${line}'`);
    });

    if (linesToWarnBasicFormat.length > 0 && parsedBets.length > 0) {
        console.log('\n'); // Separator
    }

    const printFormattedTable = (title: string, headers: string[], rowsData: (string | number | Date | boolean | undefined)[][]) => {
        if (rowsData.length === 0) {
            // console.log(`No data for table: ${title}`); // Optional: log if no data for a specific table
            return;
        }

        const columnWidths = headers.map((header, colIndex) => {
            let maxWidth = header.length;
            for (const row of rowsData) {
                const cellValue = row[colIndex];
                const cellLength = String(cellValue ?? '').length;
                if (cellLength > maxWidth) {
                    maxWidth = cellLength;
                }
            }
            return maxWidth;
        });

        const outputTableLines: string[] = [];
        outputTableLines.push(
            headers.map((header, i) => header.padEnd(columnWidths[i])).join(', ')
        );

        rowsData.forEach(row => {
            outputTableLines.push(
                row.map((cell, i) => {
                    return String(cell ?? '').padEnd(columnWidths[i]);
                }).join(', ')
            );
        });
        
        const finalStringToPrint = `\n${title}\n${outputTableLines.join('\n')}`;
        console.log(finalStringToPrint);
    };

    if (parsedBets.length > 0) {
        const headers = ['Contract', 'Price', 'Size', 'Grade', 'PNL'];
        
        const rowsData = await Promise.all(parsedBets.map(async (bet) => {
            const contractStr = contractMatchToString(bet.ContractMatch);
            let grade = 'N/A'; // Default grade
            const matchDate = bet.ContractMatch.Match.Date; // Common for both types
            const formattedMatchDate = `${matchDate.getFullYear()}-${String(matchDate.getMonth() + 1).padStart(2, '0')}-${String(matchDate.getDate()).padStart(2, '0')}`;

            try {
                if ('Team' in bet.ContractMatch) { // It's a Contract_Match_TeamTotal
                    const contractMatch = bet.ContractMatch as Contract_Match_TeamTotal;
                    let daySequenceSqlArgument = 'DEFAULT';
                    const request = pool.request()
                        .input('MatchScheduledDate', sql.Date, formattedMatchDate)
                        .input('SelectedTeam', sql.Char(50), contractMatch.Team)
                        .input('PeriodTypeCode', sql.Char(2), contractMatch.Period.PeriodTypeCode)
                        .input('PeriodNumber', sql.TinyInt, contractMatch.Period.PeriodNumber)
                        .input('Line', sql.Decimal(5, 2), contractMatch.Line)
                        .input('IsOver', sql.Bit, contractMatch.IsOver ? 1 : 0);

                    if (typeof contractMatch.Match.DaySequence === 'number') {
                        request.input('DaySequenceParam', sql.TinyInt, contractMatch.Match.DaySequence);
                        daySequenceSqlArgument = '@DaySequenceParam';
                    }

                    const query = `
                        SELECT dbo.UserAPICall_Contract_TeamTotal_Grade_fn(
                            @MatchScheduledDate,
                            @SelectedTeam,
                            @PeriodTypeCode,
                            @PeriodNumber,
                            @Line,
                            @IsOver,
                            ${daySequenceSqlArgument}
                        ) AS GradeValue;`;

                    const result = await request.query(query);
                    if (result.recordset && result.recordset.length > 0 && result.recordset[0] && result.recordset[0].GradeValue !== null && result.recordset[0].GradeValue !== undefined) {
                        grade = String(result.recordset[0].GradeValue).trim();
                    } else {
                        console.warn(`[Grade WARN] No grade returned or unexpected SQL result for TeamTotal: ${contractMatch.Team} on ${formattedMatchDate}, Line: ${contractMatch.Line}, Over: ${contractMatch.IsOver}`);
                    }
                } else { // It's a Contract_Match_Total
                    const contractMatch = bet.ContractMatch as Contract_Match_Total;
                    let daySequenceSqlArgument = 'DEFAULT';
                    const request = pool.request()
                        .input('MatchScheduledDate', sql.Date, formattedMatchDate)
                        .input('Team1', sql.Char(50), contractMatch.Match.Team1)
                        .input('Team2', sql.Char(50), contractMatch.Match.Team2 ?? null)
                        .input('PeriodTypeCode', sql.Char(2), contractMatch.Period.PeriodTypeCode)
                        .input('PeriodNumber', sql.TinyInt, contractMatch.Period.PeriodNumber)
                        .input('Line', sql.Decimal(5, 2), contractMatch.Line)
                        .input('IsOver', sql.Bit, contractMatch.IsOver ? 1 : 0);

                    if (typeof contractMatch.Match.DaySequence === 'number') {
                        request.input('DaySequenceParam', sql.TinyInt, contractMatch.Match.DaySequence);
                        daySequenceSqlArgument = '@DaySequenceParam';
                    }

                    const query = `
                        SELECT dbo.UserAPICall_Contract_MatchTotal_Grade_fn(
                            @MatchScheduledDate,
                            @Team1,
                            @Team2,
                            @PeriodTypeCode,
                            @PeriodNumber,
                            @Line,
                            @IsOver,
                            ${daySequenceSqlArgument}
                        ) AS GradeValue;`;
                        
                    const result = await request.query(query);
                    if (result.recordset && result.recordset.length > 0 && result.recordset[0] && result.recordset[0].GradeValue !== null && result.recordset[0].GradeValue !== undefined) {
                        grade = String(result.recordset[0].GradeValue).trim();
                    } else {
                        console.warn(`[Grade WARN] No grade returned or unexpected SQL result for Total: ${contractMatch.Match.Team1}/${contractMatch.Match.Team2 || 'N/A'} on ${formattedMatchDate}, Line: ${contractMatch.Line}, Over: ${contractMatch.IsOver}`);
                    }
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                // Construct a more informative error message using the contract string
                console.error(`[Grade ERROR] Failed to fetch grade for ${contractMatchToString(bet.ContractMatch)}: ${message}`);
                grade = 'ERR';
            }

            let pnlDisplay: string | number = '';
            const riskAndToWin = calculateRiskAndToWin(bet.Price, bet.Size);

            if (riskAndToWin) {
                const { risk, toWin } = riskAndToWin;
                if (grade === 'L') {
                    pnlDisplay = -risk;
                } else if (grade === 'W') {
                    pnlDisplay = toWin;
                } else if (grade === 'P' || grade === 'C' || grade === 'T') {
                    pnlDisplay = 0;
                }
            }
            // Format PNL if it's a number
            if (typeof pnlDisplay === 'number') {
                pnlDisplay = pnlDisplay.toFixed(2);
            }

            const formattedSize = bet.Size.toFixed(2); // Format Size to two decimal places

            return [
                contractMatchToString(bet.ContractMatch),
                bet.Price,
                formattedSize, // Use the formatted Size string
                grade,
                pnlDisplay
            ];
        }));
        printFormattedTable("--- Processed Bets ---", headers, rowsData);

        // --- BEGIN SUMMARY CALCULATIONS AND PRINTING ---
        const pnlSummariesData: { date: Date, pnl: number }[] = [];
        if (rowsData.length === parsedBets.length) { // Ensure rowsData is populated and matches parsedBets
            for (let i = 0; i < parsedBets.length; i++) {
                const bet = parsedBets[i];
                const row = rowsData[i] as (string | number | Date | boolean | undefined)[]; // Type assertion
                const pnlDisplay = row[4]; // pnlDisplay is the 5th element (string or number)

                let pnlValue: number | undefined = undefined;

                if (typeof pnlDisplay === 'string' && pnlDisplay.trim() !== '') {
                    const parsedPnl = parseFloat(pnlDisplay);
                    if (!isNaN(parsedPnl)) {
                        pnlValue = parsedPnl;
                    }
                } else if (typeof pnlDisplay === 'number') {
                    pnlValue = pnlDisplay;
                }

                if (pnlValue !== undefined) {
                    pnlSummariesData.push({
                        date: new Date(bet.ContractMatch.Match.Date.valueOf()), 
                        pnl: pnlValue
                    });
                }
            }
        }
        
        printDailySummary(pnlSummariesData);
        printWeeklySummary(pnlSummariesData);
        printTotalSummary(pnlSummariesData);
        // --- END SUMMARY CALCULATIONS AND PRINTING ---

    } else {
        console.log("No processable bets found in the file after detailed parsing.");
    }
}

// New async function to manage database operations and subsequent file processing
async function runOperations() {
    const dbConnectionString = process.env.DB_CONNECTION_STRING;
    if (!dbConnectionString) {
        console.error('Error: DB_CONNECTION_STRING environment variable is not set.');
        process.exit(1);
    }

    let pool: import('mssql').ConnectionPool | undefined;
    try {
        pool = await sql.connect(dbConnectionString);
        console.log("connection succeeded");

        if (!pool) { // Guard for TypeScript CFA
            throw new Error("Database pool not initialized after connect call.");
        }

        const args = process.argv.slice(2);
        if (args.length > 0 && (args[0] === '-h' || args[0] === '--help')) {
            console.log("Usage: ts-node scripts/mlb_quick_grade.ts <file_path>");
            console.log("Processes a CSV-like file, parsing lines into Bet objects.");
            console.log("Connects to DB specified by DB_CONNECTION_STRING and runs a test query before file processing.");
            process.exit(0);
        }

        if (args.length !== 1) {
            console.error("Usage: ./mlb_quick_grade.js <file_path> or node mlb_quick_grade.js <file_path>");
            process.exit(1);
        }
        const filePath = args[0];

        if (!pool) { // Guard for TypeScript CFA before passing to processFile
            throw new Error("Database pool is not available for file processing due to an unexpected state.");
        }
        await processFile(filePath, pool);

    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('Operation failed:', message);
        if (err && typeof err === 'object' && 'originalError' in err && err.originalError && typeof err.originalError === 'object' && 'message' in err.originalError) {
             console.error('Original error:', err.originalError.message);
        }
        // No explicit process.exit(1) here; error will propagate to main catch
        // or if not caught, finally will run and then process will exit with error status.
        // Forcing re-throw to ensure main catch handler is invoked for consistent exit code management.
        throw err;
    } finally {
        if (pool && pool.connected) { // Check if pool exists and is connected
            try {
                await pool.close();
                console.log("Database connection closed.");
            } catch (closeErr: unknown) {
                const message = closeErr instanceof Error ? closeErr.message : String(closeErr);
                console.error('Error closing database connection:', message);
            }
        }
    }
}

if (require.main === module) {
    runOperations().catch(err => {
        // Catch any unhandled errors from the async runOperations function
        // Error message is already logged by runOperations' catch block
        // console.error("Unhandled error during script execution:", err.message || String(err));
        process.exit(1);
    });
}

// For CommonJS compatibility
module.exports = {
    processFile, validateLine, parseBetDetails, parse_usa_price,
    periodToString, matchToString, contractMatchToString,
    calculateRiskAndToWin
};
// This export ensures compatibility with both ES modules and CommonJS 