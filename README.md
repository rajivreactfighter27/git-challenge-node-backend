# Event Management System

This service is a small Fastify-based backend for viewing and creating events. It relies on mocked external APIs through MSW so the backend can be tested in a realistic way without external infrastructure.

## Why this project is structured this way

- Fastify was chosen because it is lightweight, fast, and well-suited for Node.js APIs.
- MSW is used to mock downstream HTTP services so we can simulate failures, retries, slow responses, and recovery behavior locally.
- The app has a custom resilience layer instead of a third-party circuit-breaker library so the logic stays explicit, small, and easy to reason about.

## Repository setup

### Install dependencies

```bash
npm install
```

### Start the app

```bash
npm start
```

The service exposes the following endpoints:

- `GET /getUsers`
- `GET /getEvents`
- `GET /getEventsByUserId/:id`
- `POST /addEvent`

## Performance fix

The main performance bottleneck was the `/getEventsByUserId/:id` endpoint. It was previously fetching each event one by one in a loop, which made latency grow linearly with the number of events for a user.

The fix was to:

- fetch the user and their event ids in a single round trip,
- run the event lookups concurrently with `Promise.all(...)`,
- keep the external fetches independent so a slow dependency no longer blocks the rest of the list.

This dramatically reduces response time when users have many scheduled events.

## Resilience fix

The external event API is intentionally unstable in the mock server. The service now protects itself with a custom circuit breaker and retry policy.

### Behavior

- After 3 failures in a 30-second window, the circuit opens.
- While the circuit is open, requests are short-circuited and clients receive a 503 response with a retry recommendation.
- After the cooldown window expires, the breaker moves into a half-open state and allows a probe request.
- If the probe succeeds, the circuit closes and normal traffic resumes.
- Failed requests are retried with exponential backoff to avoid hammering an already overloaded dependency.

This pattern reduces load during outage periods and helps the service recover gracefully without relying on a dedicated third-party resilience library.

## Error handling

The API now returns meaningful responses when the upstream service becomes unavailable:

- `503 Service Unavailable` when the circuit is open or the dependency is overloaded.
- `502 Bad Gateway` when the upstream service cannot be reached or responds unexpectedly.

## Manual verification

You can verify the service behavior by starting the app and exercising the endpoints with curl or a client tool:

```bash
npm start
```

Then call the supported API routes and confirm that the circuit breaker responds with a 503 when the external service is failing repeatedly.

## Recommended production hardening

If the service were going to production, I would also add:

- environment-based configuration for ports and upstream URLs,
- structured logs and request IDs,
- health checks and metrics for upstream dependency failures,
- a queue or asynchronous worker for event creation under high load,
- rate limits and timeouts for external requests.

Those are the next practical steps after the fixes in this challenge.
