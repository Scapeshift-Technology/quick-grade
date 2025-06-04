#!/usr/bin/env python3
"""
MLB Player Team History Uploader

This script fetches player transaction data from the MLB Stats API for a specified
range of player IDs and loads it into the MLBPlayer_TeamHistory table.

Usage:
    python upload_mlb_player_team_history.py --player-range=[110001,833238]

Environment Variables Required:
    DB_CONNECTION_STRING - SQL Server connection string

Author: Assistant
Date: Jan 1, 2025
"""

import os
import json
import logging
import asyncio
import aiohttp
import pyodbc
import argparse
import time
from typing import List, Dict, Any, Set, Tuple
from datetime import datetime, date

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Database connection
CONNECTION_STRING = os.getenv("DB_CONNECTION_STRING")
if not CONNECTION_STRING:
    logger.error("DB_CONNECTION_STRING environment variable not set.")
    raise EnvironmentError("DB_CONNECTION_STRING environment variable not set")

# API configuration
MLB_TRANSACTIONS_API_URL = "https://statsapi.mlb.com/api/v1/transactions"
API_TIMEOUT = 30
MAX_CONCURRENT_REQUESTS = 10  # Throttle to 10 concurrent requests


def fetch_valid_mlb_teams() -> Set[int]:
    """
    Fetch all valid MLBTeam IDs from the database.
    
    Returns:
        Set of valid MLBTeam IDs
    """
    logger.info("Fetching valid MLBTeam IDs from database")
    
    try:
        conn = pyodbc.connect(CONNECTION_STRING)
        cursor = conn.cursor()
        
        cursor.execute("SELECT MLBTeam FROM MLBTeam")
        results = cursor.fetchall()
        
        valid_teams = {row[0] for row in results}
        logger.info(f"Found {len(valid_teams)} valid MLBTeam IDs")
        
        return valid_teams
        
    except Exception as e:
        logger.error(f"Failed to fetch valid MLBTeam IDs: {e}")
        raise
    finally:
        if 'cursor' in locals():
            cursor.close()
        if 'conn' in locals():
            conn.close()


def fetch_valid_mlb_players(start_id: int, end_id: int) -> Set[int]:
    """
    Fetch all valid MLBPlayer IDs from the database within the specified range.
    
    Args:
        start_id: Start of player ID range
        end_id: End of player ID range
        
    Returns:
        Set of valid MLBPlayer IDs that exist in our database
    """
    logger.info(f"Fetching valid MLBPlayer IDs from database for range {start_id}-{end_id}")
    
    try:
        conn = pyodbc.connect(CONNECTION_STRING)
        cursor = conn.cursor()
        
        cursor.execute("SELECT Player FROM MLBPlayer WHERE Player BETWEEN ? AND ?", (start_id, end_id))
        results = cursor.fetchall()
        
        valid_players = {row[0] for row in results}
        logger.info(f"Found {len(valid_players)} valid MLBPlayer IDs in the specified range")
        
        return valid_players
        
    except Exception as e:
        logger.error(f"Failed to fetch valid MLBPlayer IDs: {e}")
        raise
    finally:
        if 'cursor' in locals():
            cursor.close()
        if 'conn' in locals():
            conn.close()


async def fetch_player_transactions(session: aiohttp.ClientSession, semaphore: asyncio.Semaphore, 
                                  player_id: int, valid_teams: Set[int]) -> List[Tuple[int, date, int, str]]:
    """
    Fetch transactions for a single player from MLB Stats API using async HTTP.
    
    Args:
        session: aiohttp ClientSession
        semaphore: asyncio Semaphore for throttling
        player_id: MLB player ID
        valid_teams: Set of valid MLBTeam IDs for filtering
        
    Returns:
        List of tuples (MLBPlayer, Date, MLBTeam, Description)
    """
    url = f"{MLB_TRANSACTIONS_API_URL}?playerId={player_id}"
    
    async with semaphore:  # Throttle concurrent requests
        try:
            logger.debug(f"Fetching transactions for player {player_id}")
            
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=API_TIMEOUT)) as response:
                response.raise_for_status()
                data = await response.json()
                
            transactions = data.get('transactions', [])
            team_history_records = []
            
            for transaction in transactions:
                # Skip transactions without toTeam
                to_team = transaction.get('toTeam')
                if not to_team:
                    continue
                    
                team_id = to_team.get('id')
                if not team_id or team_id not in valid_teams:
                    continue
                    
                # Parse the transaction date
                transaction_date_str = transaction.get('date')
                if not transaction_date_str:
                    continue
                    
                try:
                    # Parse date string (format: "2023-06-17")
                    transaction_date = datetime.strptime(transaction_date_str, '%Y-%m-%d').date()
                except ValueError:
                    logger.warning(f"Invalid date format for player {player_id}: {transaction_date_str}")
                    continue
                
                description = transaction.get('description', '').strip()
                if len(description) > 255:
                    description = description[:255]
                
                team_history_records.append((
                    player_id,           # MLBPlayer
                    transaction_date,    # Date
                    team_id,            # MLBTeam
                    description         # Description
                ))
            
            logger.debug(f"Player {player_id}: {len(team_history_records)} valid transactions")
            return team_history_records
            
        except aiohttp.ClientError as e:
            logger.warning(f"HTTP request failed for player {player_id}: {e}")
            return []
        except asyncio.TimeoutError as e:
            logger.warning(f"Request timeout for player {player_id}: {e}")
            return []
        except json.JSONDecodeError as e:
            logger.warning(f"JSON decode failed for player {player_id}: {e}")
            return []
        except Exception as e:
            logger.error(f"Unexpected error for player {player_id}: {e}")
            return []


async def process_players_batch(player_ids: List[int], valid_teams: Set[int], valid_players: Set[int]) -> List[Tuple[int, date, int, str]]:
    """
    Process a batch of players concurrently using async HTTP.
    
    Args:
        player_ids: List of player IDs to process (should all be valid)
        valid_teams: Set of valid MLBTeam IDs for filtering
        valid_players: Set of valid MLBPlayer IDs for validation
        
    Returns:
        List of all team history records from the batch
    """
    # Double-check that all player IDs are valid before making any API calls
    invalid_players = [pid for pid in player_ids if pid not in valid_players]
    if invalid_players:
        logger.error(f"Attempting to process invalid player IDs: {invalid_players}")
        raise ValueError(f"Invalid player IDs detected: {invalid_players}")
    
    logger.info(f"Making async API calls for {len(player_ids)} valid players: {player_ids}")
    
    # Create semaphore for throttling concurrent requests
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)
    
    # Create aiohttp session
    connector = aiohttp.TCPConnector(limit=MAX_CONCURRENT_REQUESTS * 2)  # Allow more connections in pool
    async with aiohttp.ClientSession(connector=connector) as session:
        # Create tasks for all players
        tasks = [
            fetch_player_transactions(session, semaphore, player_id, valid_teams)
            for player_id in player_ids
        ]
        
        # Execute all tasks concurrently
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Collect successful results
        all_records = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error(f"Error processing player {player_ids[i]}: {result}")
            else:
                all_records.extend(result)
    
    logger.info(f"Batch completed: {len(all_records)} total team history records collected")
    return all_records


def bulk_insert_team_history(records: List[Tuple[int, date, int, str]]) -> None:
    """
    Bulk insert team history records into the database.
    
    Args:
        records: List of tuples (MLBPlayer, Date, MLBTeam, Description)
    """
    if not records:
        logger.info("No records to insert")
        return
    
    logger.info(f"Inserting {len(records)} team history records")
    
    try:
        conn = pyodbc.connect(CONNECTION_STRING)
        cursor = conn.cursor()
        cursor.fast_executemany = True
        conn.autocommit = False
        
        # Use MERGE statement to handle potential duplicates (based on primary key)
        merge_sql = """
        MERGE MLBPlayer_TeamHistory AS target
        USING (VALUES (?, ?, ?, ?)) AS source (MLBPlayer, Date, MLBTeam, Description)
        ON target.MLBPlayer = source.MLBPlayer AND target.Date = source.Date
        WHEN MATCHED THEN
            UPDATE SET MLBTeam = source.MLBTeam, Description = source.Description
        WHEN NOT MATCHED THEN
            INSERT (MLBPlayer, Date, MLBTeam, Description)
            VALUES (source.MLBPlayer, source.Date, source.MLBTeam, source.Description);
        """
        
        cursor.executemany(merge_sql, records)
        
        # Commit the transaction
        conn.commit()
        logger.info(f"Successfully inserted/updated {len(records)} team history records")
        
    except Exception as e:
        logger.error(f"Failed to insert team history records: {e}")
        if 'conn' in locals():
            conn.rollback()
        raise
    finally:
        if 'cursor' in locals():
            cursor.close()
        if 'conn' in locals():
            conn.close()


def parse_player_range(range_str: str) -> Tuple[int, int]:
    """
    Parse player range string like "[110001,833238]" into start and end IDs.
    
    Args:
        range_str: Range string in format "[start,end]"
        
    Returns:
        Tuple of (start_id, end_id)
    """
    try:
        # Remove brackets and split
        range_str = range_str.strip('[]')
        start_str, end_str = range_str.split(',')
        
        start_id = int(start_str.strip())
        end_id = int(end_str.strip())
        
        if start_id > end_id:
            raise ValueError("Start ID must be less than or equal to end ID")
            
        return start_id, end_id
        
    except Exception as e:
        raise ValueError(f"Invalid player range format: {range_str}. Expected format: [start,end]") from e


async def main():
    """
    Main async function to process player team history.
    """
    # Parse command line arguments
    parser = argparse.ArgumentParser(description='Upload MLB Player Team History')
    parser.add_argument('--player-range', required=True, 
                       help='Player ID range in format [start,end], e.g., [110001,833238]')
    parser.add_argument('--batch-size', type=int, default=100,
                       help='Number of players to process in each batch (default: 500)')
    
    args = parser.parse_args()
    
    # Parse player range
    start_id, end_id = parse_player_range(args.player_range)
    total_players_requested = end_id - start_id + 1
    
    logger.info("Starting MLB Player Team History Upload")
    logger.info("=" * 60)
    logger.info(f"Requested player ID range: {start_id} to {end_id}")
    logger.info(f"Total players requested: {total_players_requested}")
    logger.info(f"Batch size: {args.batch_size}")
    logger.info(f"Max concurrent requests: {MAX_CONCURRENT_REQUESTS}")
    
    try:
        # Step 1: Fetch valid MLBTeam IDs
        valid_teams = fetch_valid_mlb_teams()
        
        # Step 2: Fetch valid MLBPlayer IDs in the requested range
        valid_players = fetch_valid_mlb_players(start_id, end_id)
        
        if not valid_players:
            logger.warning(f"No players found in MLBPlayer table for range {start_id}-{end_id}")
            logger.info("=" * 60)
            logger.info("Script completed - no players to process")
            return
        
        # Convert to sorted list for batch processing
        valid_player_ids = sorted(list(valid_players))
        total_valid_players = len(valid_player_ids)
        
        logger.info(f"Found {total_valid_players} valid players in our database")
        logger.info(f"Processing players: {valid_player_ids[:5]}{'...' if total_valid_players > 5 else ''}")
        
        # Step 3: Process players in batches
        all_records = []
        processed_players = 0
        
        for i in range(0, total_valid_players, args.batch_size):
            batch_player_ids = valid_player_ids[i:i + args.batch_size]
            batch_start = batch_player_ids[0]
            batch_end = batch_player_ids[-1]
            
            logger.info(f"Processing batch: {len(batch_player_ids)} players ({batch_start} to {batch_end})")
            
            # Process this batch asynchronously
            batch_records = await process_players_batch(batch_player_ids, valid_teams, valid_players)
            all_records.extend(batch_records)
            
            processed_players += len(batch_player_ids)
            logger.info(f"Progress: {processed_players}/{total_valid_players} players processed "
                       f"({processed_players/total_valid_players*100:.1f}%)")
            logger.info(f"Batch yielded {len(batch_records)} team history records")
            logger.info(f"Total records accumulated: {len(all_records)}")
            
            # Insert records in chunks to avoid memory issues
            if len(all_records) >= 100:
                bulk_insert_team_history(all_records)
                all_records = []  # Clear the accumulator
        
        # Insert any remaining records
        if all_records:
            bulk_insert_team_history(all_records)
        
        logger.info("=" * 60)
        logger.info("MLB Player Team History upload completed successfully")
        
    except Exception as e:
        logger.error(f"Script failed with error: {e}")
        raise


if __name__ == "__main__":
    asyncio.run(main()) 