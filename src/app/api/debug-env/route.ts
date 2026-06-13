import { NextResponse } from 'next/server';

export async function GET() {
  const required = [
    'arm-erp-project',
    '-----BEGIN PRIVATE KEY-----\nMIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCteWL9b3P5eqDK\nym5RKNrWRXnToQR5iqC/Yxi2WndwbK87+xJ5NoX8/WaiT39gSyvTpshsk0NAuf5y\nu3An0PCot7QkTR1U0PhXORua77yBbOTHRC2gE8zOV4Iy2ZEIRvlWTwUS9G8WxfBp\nBGPuAI5J9dasqF0f/E59B8oMdWinMOxavYmHLZ/oa1Zk+tjsqhJ3Pz0PQfRu6+yA\noQZ4QKy8Wdj6TIqItF9ebvfZfEjuWSTv0KSw74zU6LOBGwElf2hQjW9PxAwssnHu\nVtLfhJx77aucd9P3/mIC0W2T/SgOwXXeJMqSoBpciUpAK8jRtP7QNRY6H/CTin89\nIvyaJdm5AgMBAAECggEAExm6fI05B88oxStk2irVbaJYt6STCY7qBCi1H972J7rP\n0JrkfdQzDJgaJOT78W5VdQh4KPxN+2J/UcKxprCqzujrPNQA1sXrki8Hixe6ecWz\nqv0myOllM5MPEupBvdeSvJ4WwO+JC8jfn7CMEDifciVPbdNb7ZmqSroA1T5YN5BN\nBCQGTLbK3xs0Ds5HVoCIoF9ZPwu0Xhuu2qU+ZKMYsZoojEktp8rd8/jORh93kSRN\nIJibHnEW7QYP4OlhMtvvyyvdGdy4hvh5isHqk6ZepY+zxIkobbrddQVlpxMYpwfh\nup4pc6U8x0DyFBmiGw7P6VZYd/bMv3DBc7PCd5oNwQKBgQDbYGfrTDrN0M3M+3O0\ncz+my0nyMVevHpw/n5tDoJ0aoFR4nZnBE1RYmcga7QzzCCveR9hhJbizFELgSO7O\n6exGlP8iPkFryAzltFSifdlqlIyauaCjv+0Y1HH2zg0hY3Utm500kTs+9CvLtW1A\nDio+a5SwqodwkC22fiPheJoVzwKBgQDKbzqRt1yyqdkGgLe9kGi/pf+8cwaH8hVR\nRDZBo+6XnnlhRMv6PXH8l5HH9Zjas8352kkE2tEOCovS+NZo279QBqMCgY1Toeo2\nZnHShofrqZD7u8iJqOiWYez9/mPU7R+yUUq0l9ychoe8O/8GCwfO3L3ZarnSqlVf\nk6wDdIsB9wKBgG+eOKGm0pCfueae1fstXGiALKqW4ndOis9wZO5ezTCb/P61qWJs\ndFD0RbU1gY4yTSe2xGiBad1r5K77TM5ohPhQnROOO3kceztwqlNW1wV8eaHL6ukG\nIRuuFCIwKswfL6K5952ke1GHqLToJaMe0e2ajTfqPClQooGk4pq44yVPAoGAUwHC\n+Wc/mn8s346+SPvDB/rQX3ynC+2HMjiPKuFGf2NbEDh+j5DMga/A9kZNtDgQWMha\nMqRrHp/Sb+LbQEoDK5RdGTT4N3foKwBc4d+KMmbobWC1vUTGgouK+ydp1jCZU6wj\nvuOacZB0bgoH63lwbTF0o4cwxSJVOYi6+vu52EcCgYB0lQyr607jAOj1IljOzolV\nKavs5qmsDwsHqIgfbm76O04rVlDr9QYPEkl09ImpNDKNQMK86R9Q0A44WUuKGYs/\n3WJuDjm3OBOFFX5c9gbuFfOd5Prz9GkE4o3BQcFYVruo6r4KpLXUZoC8dfSXPLY0\nfoA3wyTye7m4+C3QK+QcIw==\n-----END PRIVATE KEY-----\n',
    'firebase-adminsdk-fbsvc@arm-erp-project.iam.gserviceaccount.com',
    'https://arm-erp-project-default-rtdb.firebaseio.com',
    'arm-erp-project.firebasestorage.app',
    '6627c12642cd6deda1e28ae5b71618e2f8fe827be43905d042f62ef8b50ba9ed',
    'https://arm-erp-project.vercel.app',
  ];

  const status: Record<string, { exists: boolean; preview: string }> = {};

  for (const key of required) {
    const val = process.env[key];
    status[key] = {
      exists: !!val,
      preview: val ? `${val.substring(0, 10)}...(${val.length}chars)` : 'MISSING',
    };
  }

  return NextResponse.json({ envStatus: status });
}