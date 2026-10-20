const fastify = require('fastify')({
  logger: true,
  requestTimeout: 15000,
  http2: false,
});
const listenMock = require('../mock-server');
const { CircuitBreaker } = require('../utils/circuitBreaker');

const eventApiBreaker = new CircuitBreaker({
  failureThreshold: 3,
  windowMs: 30000,
  openDurationMs: 5000,
  maxHalfOpenRequests: 1,
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message = payload?.message || payload?.error || 'External service request failed';
    const error = new Error(message);
    error.statusCode = response.status;
    throw error;
  }

  return response.json();
}

async function fetchWithCircuitBreaker(url, options = {}) {
  if (!eventApiBreaker.canAttempt()) {
    const retryAfter = eventApiBreaker.getRetryAfterSeconds();
    const error = new Error('Event service is temporarily unavailable');
    error.statusCode = 503;
    error.retryAfter = retryAfter;
    throw error;
  }

  try {
    const response = await fetchJson(url, options);
    eventApiBreaker.onSuccess();
    return response;
  } catch (error) {
    eventApiBreaker.onFailure();

    if (error.statusCode === 503 || error.statusCode === 429) {
      const retryAfter = eventApiBreaker.getRetryAfterSeconds();
      error.retryAfter = retryAfter;
    }

    throw error;
  }
}

async function fetchWithRetry(url, options = {}, retries = 3, baseDelayMs = 250) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetchWithCircuitBreaker(url, options);
    } catch (error) {
      lastError = error;

      if (attempt === retries) {
        throw error;
      }

      const delayMs = baseDelayMs * 2 ** attempt;
      await wait(delayMs);
    }
  }

  throw lastError;
}

fastify.get('/getUsers', async () => {
  return fetchWithRetry('http://event.com/getUsers');
});

fastify.post('/addEvent', async (request, reply) => {
  const payload = {
    id: Date.now(),
    ...request.body,
  };

  try {
    const result = await fetchWithRetry('http://event.com/addEvent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    return result;
  } catch (error) {
    const retryAfter = error.retryAfter || 0;

    if (error.statusCode === 503 || retryAfter > 0 || error.message.includes('temporarily unavailable')) {
      reply.code(503);
      return {
        success: false,
        error: 'Event service unavailable',
        message: 'The external event service is currently overloaded. Please retry later.',
        retryAfterSeconds: retryAfter,
      };
    }

    reply.code(502);
    return {
      success: false,
      error: 'Bad gateway',
      message: 'The upstream event service could not be reached.',
    };
  }
});

fastify.get('/getEvents', async () => {
  return fetchWithRetry('http://event.com/getEvents');
});

fastify.get('/getEventsByUserId/:id', async (request) => {
  const { id } = request.params;

  const userResponse = await fetchWithRetry(`http://event.com/getUserById/${id}`);
  const userEvents = userResponse?.events || [];

  const eventPromises = userEvents.map((eventId) => fetchWithRetry(`http://event.com/getEventById/${eventId}`));
  const eventArray = await Promise.all(eventPromises);

  return eventArray;
});

fastify.setErrorHandler((error, request, reply) => {
  const statusCode = error.statusCode || 500;

  if (statusCode === 503) {
    reply.code(503);
    return {
      success: false,
      error: 'Service unavailable',
      message: error.message || 'The event service is temporarily unavailable.',
      retryAfterSeconds: error.retryAfter || 0,
    };
  }

  reply.code(statusCode);
  return {
    success: false,
    error: 'Internal server error',
    message: error.message || 'An unexpected error occurred',
  };
});

fastify.listen({ port: 3000 }, (err) => {
  listenMock();
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
});
