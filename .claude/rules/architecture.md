# Workspace Architecture & Multi-Repo Standards

## Dual-Repository Layout
This workspace (`d:\PJ`) manages a full-stack Badminton Court Management platform comprised of two distinct Git repositories:

1. **`api_express_badminton` (Backend)**:
   - Framework: Express.js (Node.js).
   - Core directories:
     - `src/routes/`: Express API route definitions (e.g. authRoutes, staffRoutes, bookingRoutes, courtRoutes).
     - `src/controllers/`: Request handling, validation orchestration, response formatting.
     - `src/services/` or `src/models/`: Business logic, database queries, transactions.
     - `src/middleware/`: Authentication verification, role-based access control, error handling, rate limiting.
     - `src/config/`: Environment configurations, DB connection pool.
   - API Conventions:
     - RESTful endpoints: `GET /api/v1/...`, `POST /api/v1/...`, `PUT /api/v1/...`, `DELETE /api/v1/...`.
     - Standard JSON response format:
       ```json
       {
         "success": true,
         "data": { ... },
         "message": "Optional message"
       }
       ```
     - Standard error format:
       ```json
       {
         "success": false,
         "error": {
           "code": "BAD_REQUEST",
           "message": "Descriptive message"
         }
       }
       ```

2. **`web_react_badmintion` (Frontend)**:
   - Framework: React.js (Single Page Application).
   - Core directories:
     - `src/pages/`: Top-level route pages (Login, Dashboard, StaffManagement, CourtSchedule, Booking).
     - `src/components/`: Reusable UI components (Navbar, Sidebar, Modal, Table, Badge, Button).
     - `src/services/` or `src/api/`: Axios/Fetch API client functions pointing to the backend.
     - `src/context/` or `src/hooks/`: Global state (AuthContext, ThemeContext), custom hooks.
     - `src/styles/` or `src/assets/`: Global CSS, design tokens, icons, assets.

## Inter-Repo Communication
- Frontend communicates with Backend over HTTP REST APIs.
- Auth token passing: `Authorization: Bearer <jwt-token>`.
- CORS must allow frontend development origin (e.g., `http://localhost:5173` or `http://localhost:3000`).
- Environment variables must never be committed; use `.env.example`.
