# Badminton Management System — Project Instructions

## Workspace Architecture
This workspace (`d:\PJ`) manages a multi-tier Badminton Court Management Platform consisting of two Git repositories:

- **`api_express_badminton`**: Node.js & Express REST API server.
  - Port default: 5000 (or specified in `.env`).
  - Auth: JWT-based authentication with role-based access control (`Admin`, `Staff`, `Customer`).
  - Database: MySQL / PostgreSQL / MongoDB.
- **`web_react_badmintion`**: React.js Single Page Application.
  - Port default: 5173 / 3000.
  - Pages: Court Schedule, Booking Management, Staff Management (`UC-8.1 View Staff List`), Customer Portal.

---

## Coding Standards & Behavioral Guidelines
1. **Think Before Coding**: State assumptions explicitly. Surface tradeoffs before choosing implementations. Push back against overcomplicated designs.
2. **Simplicity First**: Write the minimum code required to solve the problem. Avoid speculative features or premature abstractions.
3. **Surgical Changes**: Touch only files and lines strictly needed for the task. Preserve existing stylistic conventions. Clean up only your own orphans.
4. **Impeccable UI/UX**: Enforce modern aesthetics, responsive layouts, consistent color tokens, accessible states, and subtle transitions on the React frontend.

---

## Quick Commands
- **Backend (`api_express_badminton`)**:
  - Run dev server: `npm run dev`
  - Start production: `npm start`
  - Run tests: `npm test`
- **Frontend (`web_react_badmintion`)**:
  - Run dev server: `npm run dev`
  - Build bundle: `npm run build`
  - Run tests: `npm test`

---

## Subagents & Workflows
The project includes specialized agents in `.claude/agents/`:
- `code-reviewer`: Spec compliance & code quality review.
- `test-writer`: TDD & unit/integration test coverage.
- `security-reviewer`: Vulnerability, JWT, and RBAC auditing.
- `implementer`: Surgical task execution from plans.
- `task-reviewer`: Single-task gate validation.
- `systematic-debugger`: Root-cause defect isolation.
- `ui-ux-designer`: High-fidelity UI design & token architecture.
- `impeccable-manual-edit-applier` & `impeccable-asset-producer`: Impeccable live craft tooling.

---

## Verification Steps
Before declaring any task or feature complete:
1. Verify backend APIs respond correctly with valid status codes and structured payloads.
2. Verify frontend renders cleanly without console errors or layout shifting.
3. Run existing tests to ensure zero regressions.
4. Review changes against Karpathy guidelines and security checklists.
