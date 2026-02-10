import DataTable from 'datatables.net-bs5';

// Mock data
const mockData = [
  { id: 1, name: 'John Doe', email: 'john@example.com', department: 'Engineering', salary: 95000 },
  { id: 2, name: 'Jane Smith', email: 'jane@example.com', department: 'Marketing', salary: 75000 },
  { id: 3, name: 'Bob Johnson', email: 'bob@example.com', department: 'Sales', salary: 80000 },
  { id: 4, name: 'Alice Williams', email: 'alice@example.com', department: 'Engineering', salary: 98000 },
  { id: 5, name: 'Charlie Brown', email: 'charlie@example.com', department: 'HR', salary: 70000 },
  { id: 6, name: 'Diana Garcia', email: 'diana@example.com', department: 'Finance', salary: 85000 },
  { id: 7, name: 'Eve Martinez', email: 'eve@example.com', department: 'Engineering', salary: 92000 },
  { id: 8, name: 'Frank Davis', email: 'frank@example.com', department: 'Operations', salary: 78000 },
];

// Initialize DataTable — module scripts are deferred, so DOM is ready
const table = new DataTable('#dataTable', {
  data: mockData,
  columns: [
    { data: 'id' },
    { data: 'name' },
    { data: 'email' },
    { data: 'department' },
    {
      data: 'salary',
      render: (data) => '$' + data.toLocaleString(),
    },
  ],
  pageLength: 5,
  lengthChange: true,
  searching: true,
  responsive: true,
});