import { timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

export function requireGateway(request: Request, response: Response, next: NextFunction): void {
  const expected = process.env.GATEWAY_INTERNAL_SECRET;
  if (!expected) {
    console.error('Scraper gateway authorization is not configured.');
    response.status(503).json({ error: 'Gateway authorization is not configured.' });
    return;
  }
  const supplied = request.get('x-gateway-secret');
  const valid = typeof supplied === 'string' &&
    Buffer.byteLength(supplied) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
  if (!valid || request.get('x-gateway-caller') !== 'team-2-gateway') {
    console.warn('Direct scraper API access denied.');
    response.status(403).json({ error: 'Use the main gateway to access the scraper.' });
    return;
  }
  next();
}
