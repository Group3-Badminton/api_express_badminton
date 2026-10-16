# Testing Standards & TDD Protocol

## Test-Driven Development (TDD)
1. **Red**: Write a minimal failing test before writing functional code.
2. **Verify Red**: Execute test to ensure it fails cleanly due to missing implementation.
3. **Green**: Write the minimal code required to pass the test.
4. **Refactor**: Clean up and optimize while preserving passing tests.

## Backend Testing (`api_express_badminton`)
- Test all HTTP response codes explicitly (200, 201, 400, 401, 403, 404, 500).
- Test validation boundaries (empty body, missing required fields, invalid email format, SQL injection payloads).
- Test authentication and RBAC middleware:
  - Without token -> 401 Unauthorized.
  - With valid user token accessing admin route -> 403 Forbidden.
  - With valid admin token -> 200 OK.
- Run tests: `npm test` or `npx jest --watch`.

## Frontend Testing (`web_react_badmintion`)
- Unit test reusable components in isolation (Buttons, Form inputs, Badges).
- Integration test page workflows using React Testing Library:
  - Form submit triggers API service.
  - Loading spinner displays during network requests.
  - Error alert renders on API failure.
  - Empty table state renders when data array is empty.
- Avoid testing internal implementation details (e.g. state variables directly); test user-visible behavior.
