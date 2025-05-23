import { parseBetDetails, parse_usa_price, Bet, Contract_Match_Total, Contract_Match_TeamTotal, Period, Match as MatchType, calculateRiskAndToWin } from './mlb_quick_grade'; // Adjust path as needed
import { periodToString, matchToString, contractMatchToString } from './mlb_quick_grade'; // Adjust path as needed

describe('MLB Quick Grade Parsing', () => {
    describe('parse_usa_price', () => {
        test('should parse positive integer odds', () => {
            expect(parse_usa_price('+150')).toBe(150);
        });
        test('should parse negative integer odds', () => {
            expect(parse_usa_price('-200')).toBe(-200);
        });
        test('should parse "ev" as 100', () => {
            expect(parse_usa_price('ev')).toBe(100);
            expect(parse_usa_price('EV')).toBe(100);
        });
        test('should parse "even" as 100', () => {
            expect(parse_usa_price('even')).toBe(100);
            expect(parse_usa_price('EVEN')).toBe(100);
        });
        test('should parse decimal odds', () => {
            expect(parse_usa_price('-115.5')).toBe(-115.5);
            expect(parse_usa_price('150.0')).toBe(150);
        });
        test('should throw error for invalid price string', () => {
            expect(() => parse_usa_price('invalid')).toThrow('Invalid USA price format: "invalid"');
            expect(() => parse_usa_price('')).toThrow('Invalid USA price format: ""');
            expect(() => parse_usa_price('+-150')).toThrow('Invalid USA price format: "+-150"');
        });
    });

    describe('parseBetDetails', () => {
        test('Example 1: Padres/Pirates 1st inning u0.5', () => {
            const line = "5/2/2025, 6:43 PM, YG Padres/Pirates 1st inning u0.5 @ +100 = 0.094";
            const [dateStr, timeStr, detailsStr] = line.split(',').map(s => s.trim());
            const result = parseBetDetails(dateStr, timeStr, detailsStr);

            expect(result).not.toBeNull();
            const bet = result as Bet;

            expect(bet.ExecutionDtm.getFullYear()).toBe(2025);
            expect(bet.ExecutionDtm.getMonth()).toBe(4); // 0-indexed month
            expect(bet.ExecutionDtm.getDate()).toBe(2);
            
            // Test time in a timezone-agnostic way
            // Check that hours and minutes match the input time in local timezone
            const inputDate = new Date(`2025-05-02T18:43:00`);
            expect(bet.ExecutionDtm.getHours()).toBe(inputDate.getHours());
            expect(bet.ExecutionDtm.getMinutes()).toBe(43);
            
            expect(bet.Price).toBe(100);
            expect(bet.Size).toBe(94);

            const cm = bet.ContractMatch as Contract_Match_Total;
            expect(cm.Period.PeriodTypeCode).toBe('I');
            expect(cm.Period.PeriodNumber).toBe(1);

            expect(cm.Match.Date.getFullYear()).toBe(2025); 
            expect(cm.Match.Date.getMonth()).toBe(4); // May (0-indexed)
            expect(cm.Match.Date.getDate()).toBe(2);
            
            expect(cm.Match.Team1).toBe("Padres");
            expect(cm.Match.Team2).toBe("Pirates");
            expect(cm.Match.DaySequence).toBeUndefined();

            expect(cm.Line).toBe(0.5);
            expect(cm.IsOver).toBe(false);
        });

        test('Example 2: LAA TT o3.5', () => {
            const line = "5/17/2025, 9:12 AM, YG LAA TT o3.5 @ -115.5 = 8.925";
            const [dateStr, timeStr, detailsStr] = line.split(',').map(s => s.trim());
            const result = parseBetDetails(dateStr, timeStr, detailsStr);

            expect(result).not.toBeNull();
            const bet = result as Bet;
            
            // Simplified date check for brevity, similar to above for full check
            expect(bet.ExecutionDtm.getFullYear()).toBe(2025);
            expect(bet.ExecutionDtm.getMonth()).toBe(4); // May
            expect(bet.ExecutionDtm.getDate()).toBe(17);
            
            // Test time in a timezone-agnostic way
            const inputDate = new Date(`2025-05-17T09:12:00`);
            expect(bet.ExecutionDtm.getHours()).toBe(inputDate.getHours());
            expect(bet.ExecutionDtm.getMinutes()).toBe(12);

            expect(bet.Price).toBe(-115.5);
            expect(bet.Size).toBe(8925);

            const cm = bet.ContractMatch as Contract_Match_TeamTotal;
            expect(cm.Period.PeriodTypeCode).toBe('M'); // Default FG
            expect(cm.Period.PeriodNumber).toBe(0);

            expect(cm.Match.Team1).toBe("LAA");
            expect(cm.Match.Team2).toBeUndefined();
            expect(cm.Match.DaySequence).toBeUndefined();
            // Match Date check: expect(cm.Match.Date).toEqual(new Date("2025-05-17T00:00:00.000Z"));

            // Instead check date parts
            expect(cm.Match.Date.getFullYear()).toBe(2025);
            expect(cm.Match.Date.getMonth()).toBe(4); // May (0-indexed)
            expect(cm.Match.Date.getDate()).toBe(17);

            expect(cm.Line).toBe(3.5);
            expect(cm.IsOver).toBe(true);
            expect(cm.Team).toBe("LAA");
        });

        test('Example 3: ATH/SF F5 o4.5', () => {
            const line = "5/18/2025, 3:39 PM, YG ATH/SF F5 o4.5 @ -117 = 2.7";
            const [dateStr, timeStr, detailsStr] = line.split(',').map(s => s.trim());
            const result = parseBetDetails(dateStr, timeStr, detailsStr);

            expect(result).not.toBeNull();
            const bet = result as Bet;

            // Simplified date check
            expect(bet.ExecutionDtm.getFullYear()).toBe(2025);
            expect(bet.ExecutionDtm.getMonth()).toBe(4); // May
            expect(bet.ExecutionDtm.getDate()).toBe(18);
            
            // Test time in a timezone-agnostic way
            const inputDate = new Date(`2025-05-18T15:39:00`);
            expect(bet.ExecutionDtm.getHours()).toBe(inputDate.getHours());
            expect(bet.ExecutionDtm.getMinutes()).toBe(39);

            expect(bet.Price).toBe(-117);
            expect(bet.Size).toBe(2700);

            const cm = bet.ContractMatch as Contract_Match_Total;
            expect(cm.Period.PeriodTypeCode).toBe('H'); // F5
            expect(cm.Period.PeriodNumber).toBe(1);
            
            expect(cm.Match.Team1).toBe("ATH");
            expect(cm.Match.Team2).toBe("SF");
            // Match Date check: expect(cm.Match.Date).toEqual(new Date("2025-05-18T00:00:00.000Z"));
            
            // Instead check date parts
            expect(cm.Match.Date.getFullYear()).toBe(2025);
            expect(cm.Match.Date.getMonth()).toBe(4); // May (0-indexed)
            expect(cm.Match.Date.getDate()).toBe(18);

            expect(cm.Line).toBe(4.5);
            expect(cm.IsOver).toBe(true);
        });

        test('Example 4a: Astros/White Sox 1st inning o0.5', () => {
            const line = "5/2/2025, 7:39 PM, YG Astros/White Sox 1st inning o0.5 @ +123 = 0.216";
            const [dateStr, timeStr, detailsStr] = line.split(',').map(s => s.trim());
            const result = parseBetDetails(dateStr, timeStr, detailsStr);

            expect(result).not.toBeNull();
            const bet = result as Bet;
            const cm = bet.ContractMatch as Contract_Match_Total;

            expect(cm.Match.Team1).toBe("Astros");
            expect(cm.Match.Team2).toBe("White Sox");
        });
        test('Example 4b: White Sox/Astros 1st inning o0.5', () => {
            const line = "5/2/2025, 7:39 PM, YG White Sox/Astros 1st inning o0.5 @ +123 = 0.216";
            const [dateStr, timeStr, detailsStr] = line.split(',').map(s => s.trim());
            const result = parseBetDetails(dateStr, timeStr, detailsStr);

            expect(result).not.toBeNull();
            const bet = result as Bet;
            const cm = bet.ContractMatch as Contract_Match_Total;

            expect(cm.Match.Team1).toBe("White Sox");
            expect(cm.Match.Team2).toBe("Astros");
        });
        // Add more test cases for edge conditions and errors:
        // - Line not divisible by 0.5
        // - Missing parts of the string
        // - "TT" with two teams
        // - Invalid price
        // - Invalid date/time
        // - Unknown period string

        test('should parse DaySequence G2 correctly: YG SEA G2 TT u4.5', () => {
            const line = "5/20/2025, 10:00 AM, YG SEA G2 TT u4.5 @ -110 = 1.0";
            const [dateStr, timeStr, detailsStr] = line.split(',').map(s => s.trim());
            const result = parseBetDetails(dateStr, timeStr, detailsStr);

            expect(result).not.toBeNull();
            const bet = result! as Bet;
            const cm = bet.ContractMatch as Contract_Match_TeamTotal;

            expect(cm.Match.Team1).toBe("SEA");
            expect(cm.Match.DaySequence).toBe(2);
            expect(cm.Team).toBe("SEA");
            expect(cm.Line).toBe(4.5);
            expect(cm.IsOver).toBe(false);
            expect(cm.Period.PeriodTypeCode).toBe('M'); // Default FG
            expect(cm.Period.PeriodNumber).toBe(0);
        });

        test('should parse DaySequence #2 correctly: YG COL/ARI #2 1st inning u0.5', () => {
            const line = "5/21/2025, 1:00 PM, YG COL/ARI #2 1st inning u0.5 @ +120 = 2.0";
            const [dateStr, timeStr, detailsStr] = line.split(',').map(s => s.trim());
            const result = parseBetDetails(dateStr, timeStr, detailsStr);

            expect(result).not.toBeNull();
            const bet = result! as Bet;
            const cm = bet.ContractMatch as Contract_Match_Total;

            expect(cm.Match.Team1).toBe("COL");
            expect(cm.Match.Team2).toBe("ARI");
            expect(cm.Match.DaySequence).toBe(2);
            expect(cm.Line).toBe(0.5);
            expect(cm.IsOver).toBe(false);
            expect(cm.Period.PeriodTypeCode).toBe('I');
            expect(cm.Period.PeriodNumber).toBe(1);
        });

        test('should parse DaySequence gm2 correctly: YG COL gm2 F5 u5', () => {
            const line = "5/22/2025, 4:00 PM, YG COL gm2 F5 u5 @ -105 = 3.0";
            const [dateStr, timeStr, detailsStr] = line.split(',').map(s => s.trim());
            const result = parseBetDetails(dateStr, timeStr, detailsStr);

            expect(result).not.toBeNull();
            const bet = result! as Bet;
            const cm = bet.ContractMatch as Contract_Match_Total; // Team total not specified by TT, so it's a game total for COL

            expect(cm.Match.Team1).toBe("COL");
            expect(cm.Match.Team2).toBeUndefined(); // No second team, not a team total explicitly
            expect(cm.Match.DaySequence).toBe(2);
            expect(cm.Line).toBe(5);
            expect(cm.IsOver).toBe(false);
            expect(cm.Period.PeriodTypeCode).toBe('H'); // F5
            expect(cm.Period.PeriodNumber).toBe(1);
        });

        test('should have undefined DaySequence if no game number specified', () => {
            const line = "5/23/2025, 2:00 PM, YG NYY/BOS o9.5 @ -110 = 1.1";
            const [dateStr, timeStr, detailsStr] = line.split(',').map(s => s.trim());
            const result = parseBetDetails(dateStr, timeStr, detailsStr);
            expect(result).not.toBeNull();
            const bet = result! as Bet;
            const cm = bet.ContractMatch as Contract_Match_Total;
            expect(cm.Match.DaySequence).toBeUndefined();
        });

        test('should correctly parse "YG MIA F5 TT u1.5" as H1 Team Total', () => {
            const line = "5/24/2025, 10:00 AM, YG MIA F5 TT u1.5 @ -110 = 1.0";
            const [dateStr, timeStr, detailsStr] = line.split(',').map(s => s.trim());
            const result = parseBetDetails(dateStr, timeStr, detailsStr);

            expect(result).not.toBeNull();
            const bet = result! as Bet;
            const cm = bet.ContractMatch as Contract_Match_TeamTotal;

            // Check ExecutionDtm
            expect(bet.ExecutionDtm.getFullYear()).toBe(2025);
            expect(bet.ExecutionDtm.getMonth()).toBe(4); // May
            expect(bet.ExecutionDtm.getDate()).toBe(24);
            const inputDate = new Date(`2025-05-24T10:00:00`);
            expect(bet.ExecutionDtm.getHours()).toBe(inputDate.getHours());
            expect(bet.ExecutionDtm.getMinutes()).toBe(0);


            expect(bet.Price).toBe(-110);
            expect(bet.Size).toBe(1000);

            // Check ContractMatch details
            expect(cm.Period.PeriodTypeCode).toBe('H'); // F5 should map to H1
            expect(cm.Period.PeriodNumber).toBe(1);

            expect(cm.Match.Date.getFullYear()).toBe(2025);
            expect(cm.Match.Date.getMonth()).toBe(4); // May
            expect(cm.Match.Date.getDate()).toBe(24);
            expect(cm.Match.Team1).toBe("MIA");
            expect(cm.Match.Team2).toBeUndefined();
            expect(cm.Match.DaySequence).toBeUndefined();

            expect(cm.Line).toBe(1.5);
            expect(cm.IsOver).toBe(false);
            expect(cm.Team).toBe("MIA");
        });

    });
});

describe('calculateRiskAndToWin', () => {
    test('should correctly calculate for positive odds (price >= 100)', () => {
        expect(calculateRiskAndToWin(200, 100)).toEqual({ risk: 100, toWin: 200 });
        expect(calculateRiskAndToWin(100, 50)).toEqual({ risk: 50, toWin: 50 });
        expect(calculateRiskAndToWin(150.5, 1000)).toEqual({ risk: 1000, toWin: 1505 });
        // Test with typical betSize from parsing (e.g. rawSize 0.094 -> betSize 94)
        expect(calculateRiskAndToWin(100, 94)).toEqual({ risk: 94, toWin: 94 }); 
    });

    test('should correctly calculate for negative odds (price <= -100)', () => {
        expect(calculateRiskAndToWin(-110, 110)).toEqual({ risk: 121, toWin: 110 });
        expect(calculateRiskAndToWin(-100, 75)).toEqual({ risk: 75, toWin: 75 });
        expect(calculateRiskAndToWin(-200, 100)).toEqual({ risk: 200, toWin: 100 });
        expect(calculateRiskAndToWin(-120.5, 1000)).toEqual({ risk: 1205, toWin: 1000 });
        // Test with typical betSize from parsing (e.g. rawSize 8.925 -> betSize 8925)
        // Price -115.5, betSize 8925 -> toWin 8925, risk = 8925 * 1.155 = 10308.375
        expect(calculateRiskAndToWin(-115.5, 8925)).toEqual({ risk: 10308.375, toWin: 8925 });
    });

    test('should return null for prices not in specified American odds ranges', () => {
        const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

        expect(calculateRiskAndToWin(50, 100)).toBeNull();
        expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('[calculateRiskAndToWin WARN] Price 50 is not >= 100 or <= -100'));
        
        expect(calculateRiskAndToWin(-50, 100)).toBeNull();
        expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('[calculateRiskAndToWin WARN] Price -50 is not >= 100 or <= -100'));

        expect(calculateRiskAndToWin(0, 100)).toBeNull();
        expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('[calculateRiskAndToWin WARN] Price 0 is not >= 100 or <= -100'));

        expect(calculateRiskAndToWin(99.9, 100)).toBeNull();
        expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('[calculateRiskAndToWin WARN] Price 99.9 is not >= 100 or <= -100'));
        
        expect(calculateRiskAndToWin(-99.9, 100)).toBeNull();
        expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('[calculateRiskAndToWin WARN] Price -99.9 is not >= 100 or <= -100'));

        consoleWarnSpy.mockRestore();
    });
});

describe('toString Utility Functions', () => {
    describe('periodToString', () => {
        test('should format period correctly', () => {
            const period: Period = { PeriodTypeCode: 'H', PeriodNumber: 1 };
            expect(periodToString(period)).toBe('H1');
        });
        test('should format another period correctly', () => {
            const period: Period = { PeriodTypeCode: 'M', PeriodNumber: 0 };
            expect(periodToString(period)).toBe('M0');
        });
    });

    describe('matchToString', () => {
        test('should format match with two teams', () => {
            const match: MatchType = { Date: new Date(2025, 4, 12), Team1: 'MIL', Team2: 'CLE' }; // Month is 0-indexed
            expect(matchToString(match)).toBe('5/12/2025 MIL/CLE');
        });

        test('should format match with one team and DaySequence 2', () => {
            const match: MatchType = { Date: new Date(2025, 4, 12), Team1: 'MIL', DaySequence: 2 };
            expect(matchToString(match)).toBe('5/12/2025 MIL #2');
        });

        test('should format match with one team and DaySequence 1 (not shown)', () => {
            const match: MatchType = { Date: new Date(2025, 4, 12), Team1: 'MIL', DaySequence: 1 };
            expect(matchToString(match)).toBe('5/12/2025 MIL');
        });

        test('should format match with one team and no DaySequence (not shown)', () => {
            const match: MatchType = { Date: new Date(2025, 4, 12), Team1: 'NYY' };
            expect(matchToString(match)).toBe('5/12/2025 NYY');
        });
    });

    describe('contractMatchToString', () => {
        test('should format Contract_Match_Total correctly', () => {
            const contract: Contract_Match_Total = {
                Match: { Date: new Date(2025, 4, 12), Team1: 'MIL', Team2: 'CLE' }, // Month is 0-indexed
                Period: { PeriodTypeCode: 'H', PeriodNumber: 1 },
                Line: 5,
                IsOver: true
            };
            expect(contractMatchToString(contract)).toBe('5/12/2025 MIL/CLE: H1 o5');
        });

        test('should format Contract_Match_TeamTotal correctly', () => {
            const contract: Contract_Match_TeamTotal = {
                Match: { Date: new Date(2025, 4, 12), Team1: 'MIL', DaySequence: 2 }, // Month is 0-indexed
                Period: { PeriodTypeCode: 'M', PeriodNumber: 0 }, // Period info for TT is not in output string per example
                Team: 'MIL',
                Line: 4.5,
                IsOver: false
            };
            expect(contractMatchToString(contract)).toBe('5/12/2025 MIL #2: MIL u4.5');
        });

        test('should format another Contract_Match_Total (under)', () => {
            const contract: Contract_Match_Total = {
                Match: { Date: new Date(2025, 6, 20), Team1: 'BOS', Team2: 'NYY' }, // Month is 0-indexed (July)
                Period: { PeriodTypeCode: 'I', PeriodNumber: 1 },
                Line: 0.5,
                IsOver: false
            };
            expect(contractMatchToString(contract)).toBe('7/20/2025 BOS/NYY: I1 u0.5');
        });
    });
}); 