# MSSQL Database Scripts

Database setup and test data generation scripts for the Excel Export Streaming project.

## Overview

This workspace contains SQL scripts for setting up and testing the Excel export functionality with MSSQL Server.

## Files

### `/DB/spGenerateData.sql`

Stored procedure that generates test data with 10 varied columns:
- `Id` - Sequential row number
- `ColInt` - Random integer (0-999,999)
- `ColBigInt` - Random large integer
- `ColDecimal` - Random decimal with 2 decimal places
- `ColFloat` - Random floating-point number
- `ColBit` - Random boolean (0 or 1)
- `ColGuid` - Random GUID
- `ColDate` - Random datetime (within ~10 years)
- `ColVarchar` - Short random text string
- `ColJson` - JSON object with nested random data

**Usage:**
```sql
-- Generate 100k rows
EXEC spGenerateData @RowCount = 100000;

-- Default: 300k rows
EXEC spGenerateData;
```

### `/exec.sql` & `/query.sql`

Helper scripts for executing and testing the stored procedure.

## Setup

1. Create a database for testing
2. Run `DB/spGenerateData.sql` to create the stored procedure
3. Configure `.env` in the project root with database credentials
4. Use `exec.sql` or `query.sql` to verify the setup

## Performance Notes

- Uses `sys.all_objects` as a fast row source (no user tables required)
- Generates data on-the-fly without persisting to disk
- Suitable for stress testing streaming exports
- Can generate 1M+ rows efficiently

## See Also

- [Stress Test Guide](../documentation/STRESS-TEST.md) - Performance testing with generated data
- [API README](../api/README.md) - How the API consumes this stored procedure
