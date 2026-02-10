CREATE PROCEDURE [dbo].[spPagedData]
  @PageNumber int = 1,
  @PageSize int = 100,
  @RowCount int = 300000
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @Offset int = (@PageNumber - 1) * @PageSize;

  -- Generate paged results from spGenerateData
  ;WITH nums AS (
    SELECT TOP (@RowCount) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n
    FROM sys.all_objects a
    CROSS JOIN sys.all_objects b
  )
  SELECT
    n AS Id,
    -- 1: fairly small random int
    ABS(CHECKSUM(NEWID())) % 1000000 AS ColInt,
    -- 2: larger random bigint
    CAST(ABS(CHECKSUM(NEWID())) AS BIGINT) * 1000 + n AS ColBigInt,
    -- 3: decimal with two places
    CAST((ABS(CHECKSUM(NEWID())) % 100000) AS DECIMAL(10,2)) / 100.0 AS ColDecimal,
    -- 4: float
    CAST((ABS(CHECKSUM(NEWID())) % 100000) AS FLOAT) / 100.0 AS ColFloat,
    -- 5: boolean-ish
    CASE WHEN ABS(CHECKSUM(NEWID())) % 2 = 1 THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END AS ColBit,
    -- 6: guid
    NEWID() AS ColGuid,
    -- 7: random datetime within ~10 years
    DATEADD(SECOND, ABS(CHECKSUM(NEWID())) % (60*60*24*3650), '2000-01-01') AS ColDate,
    -- 8: short varchar-like value
    CONCAT('Name_', (ABS(CHECKSUM(NEWID())) % 1000000)) AS ColVarchar,
    -- 9: longer text blob (~200 chars)
    REPLICATE(CHAR(65 + ABS(CHECKSUM(NEWID())) % 26), 200) AS ColText,
    -- 10: a semi-structured JSON-ish string to simulate varied content
    CONCAT('{"k":', (ABS(CHECKSUM(NEWID())) % 10000), ',"s":"', LEFT(CONVERT(varchar(36), NEWID()), 8), '"}') AS ColJson
  FROM nums
  ORDER BY n
  OFFSET @Offset ROWS
  FETCH NEXT @PageSize ROWS ONLY;
END
RETURN 0
