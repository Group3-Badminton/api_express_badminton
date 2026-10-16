# Security Rules & Best Practices

## 1. Authentication & Session
- Use strong hashing (bcrypt with at least 10 salt rounds) for passwords.
- JWT tokens must have reasonable expiration times (e.g., 15m - 1h access tokens, refresh token rotation).
- Never store JWT secrets, database credentials, or API keys in git. Always use `.env`.

## 2. Role-Based Access Control (RBAC)
- Enforce roles strictly: `Admin`, `Staff`, `Customer`.
- Never rely on frontend-only permission checks. Backend routes MUST independently verify user identity and role from the JWT payload.

## 3. Input Validation & Data Sanitation
- Validate all incoming request bodies, query parameters, and URL params before passing to services.
- Prevent SQL/NoSQL Injection: Never concatenate untrusted strings into database queries. Use parameterized queries or ORM bindings.
- Prevent Cross-Site Scripting (XSS): Sanitize rich text inputs; React auto-escapes JSX, so never use `dangerouslySetInnerHTML` without DOMPurify.

## 4. Error Handling
- Never leak database stack traces, SQL syntax errors, or server file paths in production HTTP responses.
- Log full errors securely on the server; return friendly error messages to the client.
