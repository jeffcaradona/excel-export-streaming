USE DB
GO

DECLARE @RC int;
DECLARE @RowCount int;


SET @RowCount = 10000;

EXECUTE @RC = [dbo].[spGenerateData] 
   @RowCount

/*
Test ID: 1514cd6d-8b12-4790-bb44-2baef137388e
Test TimeStamp: 2/7/2026 9:48:58 AM
Elapsed Time: 00:00:00.0720
Number of Iterations: 5
Number of Threads: 10
Delay Between Queries (ms): 0
CPU Seconds/Iteration (Avg): ---
Actual Seconds/Iteration (Avg): ---
Iterations Completed: 50
Client Seconds/Iteration (Avg): 0.0027
Logical Reads/Iteration (Avg): ---

*/
PRINT CONCAT(N'Return Code: ', CAST(@RC AS NVARCHAR(10)));
GO


DECLARE @RC int;
DECLARE @RowCount int;

-- Test spPagedData with pagination
PRINT N'Testing spPagedData...';
DECLARE @PageNumber int = 1;
DECLARE @PageSize int = 100;

SET @RowCount = 10000;

EXECUTE @RC = [dbo].[spPagedData]
   @PageNumber = @PageNumber,
   @PageSize = @PageSize,
   @RowCount = @RowCount;

PRINT CONCAT(N'Return Code: ', CAST(@RC AS NVARCHAR(10)));
PRINT CONCAT(N'Page: ', @PageNumber, N', Page Size: ', @PageSize);
GO


